import "server-only";

/**
 * Loop de recordatorios de cita por WhatsApp.
 *
 * Cada `INTERVAL_MS` el loop:
 *  1. Busca citas `scheduled` con `owner_phone` y `scheduled_at` dentro de la
 *     ventana de 24h o 2h antes.
 *  2. Filtra por `reminders_sent` (JSONB) para no duplicar el mismo aviso.
 *  3. Encola el mensaje vía `notifyClientAppointmentReminder` y marca la cita.
 *
 * El loop es idempotente — vive en `globalThis` para sobrevivir hot-reloads de
 * Next dev. En prod se arranca una sola vez desde `server.js`.
 *
 * Ventanas amplias a propósito: si el loop se cae unos minutos seguimos
 * dentro de la ventana y el siguiente tick alcanza el aviso. La marca en
 * `reminders_sent` garantiza que no se duplique.
 */

import { query } from "./db";
import { notifyClientAppointmentReminder } from "./whatsapp-notifications";

const INTERVAL_MS = 10 * 60 * 1000; // 10 min

type ReminderKey = "24h" | "2h";

type DueRow = {
  id: string;
  owner_name: string;
  owner_phone: string;
  plate: string;
  location: string;
  scheduled_at: Date | string;
  org_id: string | null;
};

const globalScope = globalThis as unknown as {
  __peritoReminderTimer?: NodeJS.Timeout;
};

async function pickDue(key: ReminderKey): Promise<DueRow[]> {
  // Ventana relativa a `now()`:
  //   24h → [+22h, +25h]   (3h de tolerancia: si scheduled_at es exactamente
  //                          en 24h, cae al tick que va de 22h..25h)
  //   2h  → [+1.5h, +2.5h] (1h de tolerancia)
  const [lowerHours, upperHours] = key === "24h" ? [22, 25] : [1.5, 2.5];
  const r = await query<DueRow>(
    `SELECT id, owner_name, owner_phone, plate, location, scheduled_at, org_id
       FROM appointments
      WHERE status = 'scheduled'
        AND owner_phone <> ''
        AND scheduled_at BETWEEN now() + ($1 || ' hours')::interval
                             AND now() + ($2 || ' hours')::interval
        AND NOT (reminders_sent ? $3)
      ORDER BY scheduled_at ASC
      LIMIT 50`,
    [String(lowerHours), String(upperHours), key],
  );
  return r.rows;
}

async function markSent(id: string, key: ReminderKey): Promise<void> {
  // jsonb_set crea la clave si no existe; el `||` con un objeto literal sirve
  // pero `jsonb_set` deja explícito el camino. Usamos `||` por concisión:
  await query(
    `UPDATE appointments
        SET reminders_sent = reminders_sent || jsonb_build_object($2::text, now()::text)
      WHERE id = $1`,
    [id, key],
  );
}

async function processOne(row: DueRow, key: ReminderKey): Promise<void> {
  notifyClientAppointmentReminder({
    clientPhone: row.owner_phone,
    ownerName: row.owner_name,
    plate: row.plate,
    location: row.location,
    scheduledAtISO:
      typeof row.scheduled_at === "string"
        ? row.scheduled_at
        : row.scheduled_at.toISOString(),
    when: key,
    orgId: row.org_id,
  });
  await markSent(row.id, key);
}

export async function processDueReminders(): Promise<{
  sent24h: number;
  sent2h: number;
}> {
  let sent24h = 0;
  let sent2h = 0;
  try {
    const due24 = await pickDue("24h");
    for (const row of due24) {
      try {
        await processOne(row, "24h");
        sent24h++;
      } catch (err) {
        console.error(`[wa-reminders] 24h appt=${row.id} falló:`, (err as Error).message);
      }
    }
    const due2 = await pickDue("2h");
    for (const row of due2) {
      try {
        await processOne(row, "2h");
        sent2h++;
      } catch (err) {
        console.error(`[wa-reminders] 2h appt=${row.id} falló:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[wa-reminders] tick falló:", (err as Error).message);
  }
  return { sent24h, sent2h };
}

/**
 * Arranca el loop. Idempotente: si ya hay timer, no hace nada. Llamar desde
 * server.js después de `app.prepare()`. En dev se llama bajo demanda desde
 * un endpoint para no spammear.
 */
export function startReminderLoop(): void {
  if (globalScope.__peritoReminderTimer) return;
  // Primer tick a los 30s del boot (para no chocar con la auto-reconexión de
  // WA, que también arranca en boot), después cada INTERVAL_MS.
  setTimeout(() => {
    void processDueReminders();
    globalScope.__peritoReminderTimer = setInterval(() => {
      void processDueReminders();
    }, INTERVAL_MS);
  }, 30 * 1000);
  console.log("[wa-reminders] loop programado (cada 10 min)");
}
