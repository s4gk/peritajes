import "server-only";

import webpush from "web-push";

import { query } from "./db";

/**
 * Web Push (PWA push notifications).
 *
 * Suscripción: el cliente llama `/api/push/subscribe` con el objeto
 * PushSubscription (endpoint + keys). Lo persistimos por user. Para enviar
 * un push usamos `sendPushToUser(userId, payload)` que itera todas las
 * suscripciones del user (un user puede tener varios devices). Si una
 * suscripción está expirada (410 Gone), la borramos automáticamente.
 *
 * Sin VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY en env, las funciones loguean y
 * son no-op — útil en dev local sin keys generadas.
 */

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:noreply@perito.local";

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    vapidReady = true;
    return true;
  } catch (err) {
    console.error("[push] setVapidDetails falló:", (err as Error).message);
    return false;
  }
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC;
}

export type PushPayload = {
  title: string;
  body: string;
  /** URL a abrir cuando el user tappea la notificación. Default: /dashboard. */
  url?: string;
  /** Tag para dedup en el sistema: si llega otra notificación con el mismo
   *  tag, reemplaza la anterior en la sombra (no apila). */
  tag?: string;
  /** Icono custom. Por default usamos el icon-192 de la PWA. */
  icon?: string;
};

export async function saveSubscription(args: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       last_used_at = now()`,
    [args.endpoint, args.userId, args.p256dh, args.auth, args.userAgent ?? null],
  );
}

/**
 * Borra una suscripción push. Si se pasa `userId`, el borrado se limita a las
 * suscripciones de esa persona — necesario en el endpoint público, donde de lo
 * contrario cualquier usuario autenticado podría desuscribir el dispositivo de
 * otro mandando su endpoint. El envío interno (410/404 de push) llama sin
 * userId porque ahí el endpoint ya viene de la fila que se está purgando.
 */
export async function deleteSubscription(
  endpoint: string,
  userId?: string,
): Promise<void> {
  if (userId) {
    await query(
      "DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2",
      [endpoint, userId],
    );
    return;
  }
  await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

type SubRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

async function listSubsForUser(userId: string): Promise<SubRow[]> {
  const r = await query<SubRow>(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId],
  );
  return r.rows;
}

/** Envía un push a TODAS las suscripciones de un user. Limpia las que el
 *  service del browser declaró inválidas (410/404). Devuelve cuántos envíos
 *  llegaron OK. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; dropped: number }> {
  if (!ensureVapid()) {
    console.warn("[push] VAPID no configurado — push descartado");
    return { sent: 0, dropped: 0 };
  }
  const subs = await listSubsForUser(userId);
  if (subs.length === 0) return { sent: 0, dropped: 0 };
  const payloadStr = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/dashboard",
    tag: payload.tag,
    icon: payload.icon ?? "/icons/icon-192.png",
  });
  let sent = 0;
  let dropped = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payloadStr,
          { TTL: 60 * 60 * 24 }, // 24h: si el device está offline más que esto, el push se descarta
        );
        sent++;
        // No actualizamos last_used_at en cada send para evitar write-amp.
      } catch (err) {
        const e = err as { statusCode?: number; body?: string };
        // 404/410 = el endpoint ya no es válido (user desinstaló la PWA o
        // revocó permisos). Limpiamos la sub para no reintentar.
        if (e.statusCode === 404 || e.statusCode === 410) {
          await deleteSubscription(sub.endpoint).catch(() => {});
          dropped++;
        } else {
          console.error(
            "[push] sendNotification falló:",
            e.statusCode,
            e.body?.slice(0, 200),
          );
        }
      }
    }),
  );
  return { sent, dropped };
}

/** Envía un push a todos los users de una org (fan-out). Útil para "nuevo
 *  intake" o "WA desconectado" donde quieres avisar a todo el equipo. */
export async function sendPushToOrg(
  orgId: string,
  payload: PushPayload,
): Promise<{ sent: number }> {
  const r = await query<{ user_id: string }>(
    `SELECT DISTINCT ps.user_id
       FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
      WHERE u.org_id = $1 AND u.active = TRUE`,
    [orgId],
  );
  let total = 0;
  for (const row of r.rows) {
    const res = await sendPushToUser(row.user_id, payload);
    total += res.sent;
  }
  return { sent: total };
}
