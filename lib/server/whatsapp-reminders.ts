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
  // Ventana relativa a `now()` expresada SIEMPRE en minutos para poder usar
  // `make_interval(mins => int)`. La variante `hours =>` solo acepta int (no
  // double precision), así que 1.5h se expresa como 90 min.
  //   24h  → [22h, 25h]    = [1320, 1500] min
  //   2h   → [1.5h, 2.5h]  = [90, 150]    min
  const [lowerMin, upperMin] = key === "24h" ? [22 * 60, 25 * 60] : [90, 150];

  const r = await query<DueRow>(
    `SELECT id, owner_name, owner_phone, plate, location, scheduled_at, org_id
       FROM appointments
      WHERE status = 'scheduled'
        AND owner_phone <> ''
        AND scheduled_at BETWEEN now() + make_interval(mins => $1::int)
                             AND now() + make_interval(mins => $2::int)
        AND NOT (reminders_sent ? $3)
      ORDER BY scheduled_at ASC
      LIMIT 50`,
    [lowerMin, upperMin, key],
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
  const scheduledAtISO =
    typeof row.scheduled_at === "string"
      ? row.scheduled_at
      : row.scheduled_at.toISOString();

  notifyClientAppointmentReminder({
    clientPhone: row.owner_phone,
    ownerName: row.owner_name,
    plate: row.plate,
    location: row.location,
    scheduledAtISO,
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
    for (const key of ["24h", "2h"] as const) {
      const due = await pickDue(key);
      for (const row of due) {
        try {
          await processOne(row, key);
          if (key === "24h") sent24h++;
          else sent2h++;
        } catch (err) {
          console.error(
            `[wa-reminders] ${key} appt=${row.id} falló:`,
            (err as Error).message,
          );
        }
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
  // Asignamos el setTimeout al timer global ANTES de esperar los 30s, no
  // después. Si no, varias llamadas dentro de la ventana de boot pasaban el
  // guard y armaban N timers (y N logs).
  globalScope.__peritoReminderTimer = setTimeout(() => {
    void processDueReminders();
    globalScope.__peritoReminderTimer = setInterval(() => {
      void processDueReminders();
    }, INTERVAL_MS);
  }, 30 * 1000);
  console.log(
    `[wa-reminders] loop programado (cada ${INTERVAL_MS / 1000}s)`,
  );
}
