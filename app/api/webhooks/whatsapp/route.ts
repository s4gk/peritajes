import { type NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/server/db";
import { verifyMetaSignature } from "@/lib/server/whatsapp-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — Meta llama este endpoint una sola vez al registrar el webhook en el
 * panel de Meta Business Manager. Devuelve el hub.challenge si el
 * hub.verify_token coincide con META_WA_VERIFY_TOKEN en el entorno.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.META_WA_VERIFY_TOKEN?.trim() ?? "";

  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * POST — Meta envía aquí todos los eventos: delivery status (sent, delivered,
 * read, failed) y mensajes entrantes. Respondemos 200 inmediatamente y
 * procesamos en fire-and-forget para no hacer esperar a Meta (tienen un
 * timeout de ~20 s y reintentarían si no responde a tiempo).
 *
 * Seguridad: validamos la firma `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo
 * crudo con META_WA_APP_SECRET) ANTES de procesar nada. Sin esto, cualquiera
 * que conozca la URL podría inyectar eventos falsos en `audit_log`. Si el
 * secreto no está configurado, dejamos pasar con un warning (dev/setup) — en
 * producción META_WA_APP_SECRET debe estar siempre presente.
 */
export async function POST(req: NextRequest) {
  // Leemos el cuerpo CRUDO (no req.json()) porque el HMAC se calcula sobre los
  // bytes exactos que envió Meta; re-serializar el JSON cambiaría el hash.
  const raw = await req.text();

  const verdict = verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"));
  if (verdict.ok === false) {
    console.warn(`[wa-webhook] firma inválida (${verdict.reason}) — rechazado.`);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  if (verdict.ok === null) {
    // Sin secreto no hay forma de saber si esto viene de Meta. En dev es una
    // molestia aceptable durante el setup; en producción sería un endpoint
    // público que cualquiera puede alimentar (y que escribe en audit_log).
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[wa-webhook] META_WA_APP_SECRET no configurado en producción — webhook rechazado.",
      );
      return NextResponse.json(
        { error: "webhook not configured" },
        { status: 503 },
      );
    }
    console.warn(
      "[wa-webhook] META_WA_APP_SECRET no configurado — webhook sin validar firma. Configúralo en producción.",
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  void handleWebhookPayload(body).catch((err) =>
    console.error("[wa-webhook]", (err as Error).message),
  );

  return NextResponse.json({ ok: true });
}

async function handleWebhookPayload(payload: unknown): Promise<void> {
  const p = payload as Record<string, unknown>;
  if (p.object !== "whatsapp_business_account") return;

  const entries = (p.entry ?? []) as Array<Record<string, unknown>>;
  for (const entry of entries) {
    const changes = (entry.changes ?? []) as Array<Record<string, unknown>>;
    for (const change of changes) {
      if (change.field !== "messages") continue;
      const value = change.value as Record<string, unknown> | undefined;
      if (!value) continue;

      // Status de entrega: sent → delivered → read / failed
      const statuses = (value.statuses ?? []) as Array<Record<string, unknown>>;
      for (const status of statuses) {
        await query(
          `INSERT INTO audit_log (user_id, org_id, action, detail)
           VALUES (NULL, NULL, 'wa.webhook.status', $1)`,
          [
            JSON.stringify({
              msg_id: status.id,
              to: status.recipient_id,
              status: status.status,
              timestamp: status.timestamp,
              errors: (status.errors as unknown[] | undefined) ?? [],
            }),
          ],
        ).catch(() => {});
      }

      // Mensajes entrantes — solo los registramos; no hay bot de respuesta.
      const messages = (value.messages ?? []) as Array<Record<string, unknown>>;
      for (const msg of messages) {
        await query(
          `INSERT INTO audit_log (user_id, org_id, action, detail)
           VALUES (NULL, NULL, 'wa.webhook.inbound', $1)`,
          [
            JSON.stringify({
              from: msg.from,
              type: msg.type,
              timestamp: msg.timestamp,
            }),
          ],
        ).catch(() => {});
      }
    }
  }
}
