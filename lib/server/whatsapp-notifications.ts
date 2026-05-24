import "server-only";

/**
 * Templates de mensajes WhatsApp para los 4 casos de uso del proyecto:
 *
 *  1. Equipo: aviso de intake nuevo
 *  2. Equipo: aviso de firma completada
 *  3. Cliente: link de firma (con QR/URL)
 *  4. Cliente: PDF final del peritaje
 *
 * Cada función:
 *   - Encola sus mensajes en la cola con delay del módulo `whatsapp`
 *   - Hace catch interno y loggea a stderr — los errores de notificación NUNCA
 *     deben romper el flow principal (intake, firma, pdf). Si WA no está
 *     conectado, los mensajes quedan en la cola hasta que reconecte.
 */

import { getUserById, listTeamWhatsAppPhones } from "./auth";
import { query } from "./db";
import { sendPushToOrg, sendPushToUser } from "./push";
import {
  getWhatsAppStatus,
  sendDocument,
  sendText,
} from "./whatsapp";

/**
 * Registra un evento de entrega de WhatsApp en `audit_log` para que el panel
 * pueda mostrar al perito si el mensaje al cliente salió o falló. Se persiste
 * con action `wa.delivery` y detalle JSON: `{type, inspectionId, phone, status,
 * error?}`. El user_id queda null porque el envío es disparado por el sistema,
 * no por un usuario en sesión.
 *
 * Falla silenciosa: si la DB no responde, logueamos a stderr pero no
 * propagamos — un fallo de auditoría no debe romper el envío real.
 */
type WaDeliveryEvent = {
  type: string;
  inspectionId: string | null;
  phone: string;
  status: "sent" | "failed" | "dedup";
  error?: string;
};

async function recordWaDelivery(
  orgId: string | null,
  event: WaDeliveryEvent,
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (user_id, org_id, action, detail)
       VALUES (NULL, $1, 'wa.delivery', $2)`,
      [orgId, JSON.stringify(event)],
    );
  } catch (err) {
    console.error(
      `[wa-notify] no se pudo persistir delivery ${event.type}/${event.status}:`,
      (err as Error).message,
    );
  }
}

// Formato de fecha/hora colombiano para mensajes al cliente y al perito.
// Bogotá no tiene horario de verano, así que la TZ fija evita confusiones.
const FMT_DATE_TIME = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function fmtScheduledAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return FMT_DATE_TIME.format(d);
}

function isReady(orgId: string | null): boolean {
  // No es bloqueante: aunque WA no esté listo, encolar es válido (se procesa
  // cuando reconecte). Esta función sirve solo para skip rápido cuando ni
  // siquiera vale la pena hacer la query de teléfonos del equipo. Sin orgId
  // (admin) no hay socket — devolvemos false para skip total.
  if (!orgId) return false;
  const s = getWhatsAppStatus(orgId);
  return s.status === "connected" || s.queueSize < 50; // cap defensivo de cola
}

function appUrl(): string {
  // Si falta la env var caemos a un placeholder que avisa al admin. Mandar un
  // link roto es mejor que callarse — al menos el cliente puede preguntar.
  return process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "") || "https://app.local";
}

function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[wa-notify] ${label} falló:`, (err as Error).message);
  }
}

/**
 * Wrapper de `listTeamWhatsAppPhones` que NO traga errores. Si la consulta
 * falla (DB caída, permisos rotos), el admin se entera por log explícito en
 * vez de "nadie recibió y nadie sabe por qué". Devolvemos array vacío en
 * cualquiera de los dos casos (error o legítimamente sin teléfonos) para que
 * los callers tengan un único camino, pero la diferencia queda en logs.
 *
 * Multi-tenant: cada org tiene su propio "equipo" — solo le mandamos avisos
 * internos a usuarios de la misma org que el peritaje/cita. Si orgId es
 * null (cross-org, owner del peritaje borrado, admin sin org), no notificamos
 * a nadie — el admin se entera por log y puede investigar.
 */
async function loadTeamPhones(
  context: string,
  orgId: string | null,
): Promise<Awaited<ReturnType<typeof listTeamWhatsAppPhones>>> {
  if (!orgId) {
    console.warn(
      `[wa-notify] ${context}: sin orgId, no se mandan avisos internos.`,
    );
    return [];
  }
  try {
    return await listTeamWhatsAppPhones(orgId);
  } catch (err) {
    console.error(
      `[wa-notify] ${context}: listTeamWhatsAppPhones falló:`,
      (err as Error).message,
    );
    return [];
  }
}

/**
 * Caso 1: aviso al equipo cuando se crea un peritaje nuevo desde intake.
 * Fan-out a todos los usuarios con `wa_phone` configurado.
 */
export async function notifyTeamNewIntake(input: {
  inspectionId: string;
  plate: string;
  vehicle: string; // "Toyota Corolla 2018"
  owner: string;
  inspectorName: string;
  /** Org del peritaje. El fan-out solo va a usuarios de esta org. */
  orgId: string | null;
}): Promise<void> {
  if (!isReady(input.orgId)) return;
  const team = await loadTeamPhones("team-intake", input.orgId);
  if (team.length === 0) return;
  const lines = [
    "🚗 *Nuevo peritaje*",
    `Placa: ${input.plate || "—"}`,
    `Vehículo: ${input.vehicle || "—"}`,
    `Cliente: ${input.owner || "—"}`,
    `Perito: ${input.inspectorName}`,
    "",
    `Ver: ${appUrl()}/inspection/${input.inspectionId}`,
  ];
  const text = lines.join("\n");
  const orgId = input.orgId!; // isReady() ya descartó null
  for (const member of team) {
    // dedupKey por miembro + evento + peritaje: si el intake se procesa dos
    // veces (reintento del cliente, doble click), cada perito del equipo
    // recibe el aviso una sola vez.
    safe(`team-intake to ${member.fullName}`, () =>
      sendText(orgId, member.waPhone, text, {
        dedupKey: `team-intake:${input.inspectionId}:${member.waPhone}`,
        label: `team-intake to ${member.fullName}`,
      }),
    );
  }
}

/**
 * Caso 2: aviso al equipo cuando el cliente firma y el peritaje queda listo.
 */
export async function notifyTeamSignatureCompleted(input: {
  inspectionId: string;
  plate: string;
  owner: string;
  orgId: string | null;
}): Promise<void> {
  // Push notifications van INDEPENDIENTE de WhatsApp — si el socket WA está
  // caído pero el equipo tiene la PWA instalada, igual les llega el aviso.
  if (input.orgId) {
    void sendPushToOrg(input.orgId, {
      title: "Peritaje firmado",
      body: `${input.plate || "Sin placa"} · ${input.owner || "—"}`,
      url: `/inspection/${input.inspectionId}`,
      tag: `signed-${input.inspectionId}`,
    }).catch(() => {});
  }
  if (!isReady(input.orgId)) return;
  const team = await loadTeamPhones("team-signed", input.orgId);
  if (team.length === 0) return;
  const text = [
    "✅ *Peritaje firmado*",
    `Placa: ${input.plate || "—"}`,
    `Cliente: ${input.owner || "—"}`,
    "",
    `Ver: ${appUrl()}/inspection/${input.inspectionId}`,
  ].join("\n");
  const orgId = input.orgId!;
  for (const member of team) {
    safe(`team-signed to ${member.fullName}`, () =>
      sendText(orgId, member.waPhone, text, {
        dedupKey: `team-signed:${input.inspectionId}:${member.waPhone}`,
        label: `team-signed to ${member.fullName}`,
      }),
    );
  }
}

/**
 * Caso 3: mensaje al cliente con el link de firma.
 *
 * El link apunta a la ruta pública /sign/[token] que el cliente abre en su
 * propio celular. Si no hay teléfono del cliente, la función no hace nada
 * (silencioso — el perito puede igual mostrar el QR en su pantalla).
 */
export function notifyClientSignLink(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  signToken: string;
  /** Org del peritaje. El mensaje sale del socket WA de esta org — el
   *  cliente recibe la firma desde el número del perito. */
  orgId: string | null;
  /** ID del peritaje (para auditar el envío y poder mostrarlo en el wizard).
   *  El link en sí sigue dependiendo del signToken. */
  inspectionId?: string | null;
}): void {
  if (!isReady(input.orgId)) return;
  if (!input.clientPhone?.trim()) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const text = [
    greeting,
    `Te enviamos el link para firmar el peritaje de la placa ${input.plate || "—"}:`,
    "",
    `${appUrl()}/sign/${input.signToken}`,
    "",
    "El link expira en 10 minutos. Si no alcanzas, el perito puede generarte uno nuevo.",
  ].join("\n");
  const orgId = input.orgId!;
  const phone = input.clientPhone!;
  const inspectionId = input.inspectionId ?? null;
  safe(`client-sign to ${phone}`, () =>
    sendText(orgId, phone, text, {
      dedupKey: `client-sign:${input.signToken}`,
      label: `client-sign to ${phone}`,
      onResult: ({ ok, error }) =>
        recordWaDelivery(orgId, {
          type: "client-sign",
          inspectionId,
          phone,
          status: ok ? "sent" : "failed",
          error,
        }),
    }),
  );
}

/**
 * Variante remota del caso 3: link de firma con TTL extendido (72h) para
 * cuando el cliente no está presente. El mensaje incluye contexto (qué
 * vehículo, ventana de validez) para que el cliente entienda que es legítimo
 * y no spam — un link seco le da menos confianza.
 */
export function notifyClientRemoteSignLink(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  vehicleLabel: string;
  inspectorName: string;
  signToken: string;
  orgId: string | null;
  inspectionId?: string | null;
}): void {
  if (!isReady(input.orgId)) return;
  if (!input.clientPhone?.trim()) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const vehicle = input.vehicleLabel
    ? `${input.vehicleLabel} de placa ${input.plate || "—"}`
    : `vehículo placa ${input.plate || "—"}`;
  const text = [
    greeting,
    `El perito ${input.inspectorName} terminó la inspección de tu ${vehicle}.`,
    "Antes de cerrar el informe necesitamos tu firma de aprobación.",
    "",
    "Firma desde tu celular en este link:",
    `${appUrl()}/sign/${input.signToken}`,
    "",
    "Tienes 72 horas para firmar. Si dejas vencer el link, podemos generarte otro.",
  ].join("\n");
  const orgId = input.orgId!;
  const phone = input.clientPhone!;
  const inspectionId = input.inspectionId ?? null;
  safe(`client-sign-remote to ${phone}`, () =>
    sendText(orgId, phone, text, {
      // Dedup por token: el token cambia si el perito regenera la sesión, así
      // que un reenvío "real" pasa pero un retry interno se colapsa.
      dedupKey: `client-sign-remote:${input.signToken}`,
      label: `client-sign-remote to ${phone}`,
      onResult: ({ ok, error }) =>
        recordWaDelivery(orgId, {
          type: "client-sign-remote",
          inspectionId,
          phone,
          status: ok ? "sent" : "failed",
          error,
        }),
    }),
  );
}

/**
 * Aviso al perito cuando un cliente firma vía flow REMOTO. En el presencial
 * el perito está al lado del cliente; en remoto puede pasar mucho tiempo
 * entre envío del link y firma, así que esta notificación destapa la novedad
 * para que el perito entre a finalizar el peritaje.
 */
export async function notifyPeritoSignatureReceived(input: {
  peritoUserId: string | null;
  inspectionId: string;
  plate: string;
  ownerName: string;
  orgId: string | null;
}): Promise<void> {
  if (!isReady(input.orgId)) return;
  if (!input.peritoUserId) return;
  const perito = await getUserById(input.peritoUserId).catch(() => null);
  if (!perito?.waPhone?.trim()) return;
  const text = [
    "✍️ *Firma del cliente recibida*",
    `Placa: ${input.plate || "—"}`,
    `Cliente: ${input.ownerName || "—"}`,
    "",
    "El cliente firmó remotamente. Puedes finalizar el peritaje:",
    `${appUrl()}/inspection/${input.inspectionId}`,
  ].join("\n");
  const orgId = input.orgId!;
  safe(`perito-signed to ${perito.fullName}`, () =>
    sendText(orgId, perito.waPhone!, text, {
      dedupKey: `perito-signed:${input.inspectionId}`,
      label: `perito-signed to ${perito.fullName}`,
    }),
  );
}

/**
 * Caso 4: PDF final al cliente cuando el peritaje queda firmado y completado.
 * El PDF llega como adjunto en el mismo mensaje (Baileys empaqueta el
 * Buffer como documento).
 */
export function notifyClientFinalPdf(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  reportNumber: string | null;
  pdfBuffer: Buffer;
  orgId: string | null;
  /** Si es true, se omite el dedupKey y se mete un sufijo único — usado por
   *  el endpoint de reenvío manual cuando el perito decide volver a mandar el
   *  PDF (p.ej. cliente reportó que no le llegó). */
  manualResend?: boolean;
  /** ID del peritaje, sólo para auditar (no se manda por WA). */
  inspectionId?: string | null;
}): void {
  if (!isReady(input.orgId)) return;
  if (!input.clientPhone?.trim()) return;
  const filename = input.reportNumber
    ? `Peritaje-${input.reportNumber}.pdf`
    : `Peritaje-${input.plate || "vehiculo"}.pdf`;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const caption = [
    greeting,
    `Adjunto el peritaje finalizado de la placa ${input.plate || "—"}.`,
    input.reportNumber ? `Informe N° ${input.reportNumber}.` : "",
    "Cualquier duda, escríbenos por este mismo medio.",
  ]
    .filter(Boolean)
    .join("\n");
  const baseDedupKey = input.reportNumber
    ? `client-pdf:${input.reportNumber}`
    : `client-pdf:${input.clientPhone}:${input.plate || "x"}`;
  const dedupKey = input.manualResend
    ? `${baseDedupKey}:resend:${Date.now()}`
    : baseDedupKey;
  const orgId = input.orgId!;
  const inspectionId = input.inspectionId ?? null;
  const phone = input.clientPhone!;
  safe(`client-pdf to ${phone}`, () =>
    sendDocument(orgId, phone, input.pdfBuffer, filename, {
      caption,
      dedupKey,
      label: `client-pdf to ${phone}`,
      onResult: ({ ok, error }) =>
        recordWaDelivery(orgId, {
          type: "client-pdf",
          inspectionId,
          phone,
          status: ok ? "sent" : "failed",
          error,
        }),
    }),
  );
}

/**
 * Aviso al perito asignado cuando se le asigna una cita. Si el perito no tiene
 * `wa_phone` configurado, la función no hace nada (silencioso — el admin igual
 * ve la cita en /agenda).
 */
export async function notifyAssignedPerito(input: {
  peritoUserId: string;
  ownerName: string;
  ownerPhone: string;
  plate: string;
  vehicleLabel: string;
  scheduledAtISO: string;
  location: string;
  /** Org de la cita. El aviso sale del socket WA de la org. Si el perito
   *  está en otra org (no debería), igual usamos el de la cita — la cita
   *  manda. */
  orgId: string | null;
}): Promise<void> {
  // Push notification al perito independiente de WhatsApp: si tiene la PWA
  // instalada y permisos otorgados, le llega aunque el socket WA esté caído
  // o aunque el perito no tenga `wa_phone` cargado.
  void sendPushToUser(input.peritoUserId, {
    title: "Cita asignada",
    body: `${fmtScheduledAt(input.scheduledAtISO)} · ${input.plate || "Sin placa"} · ${input.ownerName || "—"}`,
    url: "/agenda",
    tag: `appt-${input.peritoUserId}-${input.scheduledAtISO}`,
  }).catch(() => {});
  if (!isReady(input.orgId)) return;
  const perito = await getUserById(input.peritoUserId).catch(() => null);
  if (!perito?.waPhone?.trim()) return;
  const text = [
    "📅 *Cita asignada*",
    `Cuándo: ${fmtScheduledAt(input.scheduledAtISO)}`,
    `Placa: ${input.plate || "—"}`,
    input.vehicleLabel ? `Vehículo: ${input.vehicleLabel}` : "",
    `Cliente: ${input.ownerName || "—"}`,
    input.ownerPhone ? `Tel cliente: ${input.ownerPhone}` : "",
    input.location ? `Ubicación: ${input.location}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const orgId = input.orgId!;
  safe(`perito-assigned to ${perito.fullName}`, () =>
    sendText(orgId, perito.waPhone!, text, {
      // Una asignación cambia si se reasigna a otro perito o se reprograma —
      // por eso incluimos peritoUserId + scheduledAt en la key.
      dedupKey: `perito-assigned:${input.peritoUserId}:${input.scheduledAtISO}`,
      label: `perito-assigned to ${perito.fullName}`,
    }),
  );
}

/**
 * Confirmación al cliente cuando se agenda su cita. Le manda hora, ubicación y
 * el teléfono del negocio por si necesita reprogramar/cancelar (no creamos un
 * portal de cancelación — el cliente responde por WhatsApp y el equipo lo
 * ajusta manualmente desde /agenda).
 */
export function notifyClientAppointmentConfirmed(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  vehicleLabel: string;
  scheduledAtISO: string;
  location: string;
  orgId: string | null;
}): void {
  if (!isReady(input.orgId)) return;
  if (!input.clientPhone?.trim()) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const text = [
    greeting,
    `Tu peritaje quedó agendado para *${fmtScheduledAt(input.scheduledAtISO)}*.`,
    "",
    `Placa: ${input.plate || "—"}`,
    input.vehicleLabel ? `Vehículo: ${input.vehicleLabel}` : "",
    input.location ? `Ubicación: ${input.location}` : "",
    "",
    "Si necesitas cancelar o reprogramar, responde por este mismo chat.",
  ]
    .filter(Boolean)
    .join("\n");
  const orgId = input.orgId!;
  safe(`client-appt-confirm to ${input.clientPhone}`, () =>
    sendText(orgId, input.clientPhone!, text, {
      dedupKey: `client-appt-confirm:${input.clientPhone}:${input.scheduledAtISO}`,
      label: `client-appt-confirm to ${input.clientPhone}`,
    }),
  );
}

/**
 * Recordatorio de cita al cliente. Disparado por el loop de reminders, una vez
 * 24h antes y otra 2h antes. La idempotencia (no repetir) la maneja el
 * llamador vía la columna `appointments.reminders_sent`.
 */
export function notifyClientAppointmentReminder(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  scheduledAtISO: string;
  location: string;
  when: "24h" | "2h";
  orgId: string | null;
}): void {
  if (!isReady(input.orgId)) return;
  if (!input.clientPhone?.trim()) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const lead =
    input.when === "24h"
      ? "Te recordamos que mañana tienes tu peritaje:"
      : "Te recordamos que en aproximadamente 2 horas tienes tu peritaje:";
  const text = [
    greeting,
    lead,
    "",
    `Cuándo: ${fmtScheduledAt(input.scheduledAtISO)}`,
    `Placa: ${input.plate || "—"}`,
    input.location ? `Ubicación: ${input.location}` : "",
    "",
    "Si no puedes asistir, responde este chat para reprogramar.",
  ]
    .filter(Boolean)
    .join("\n");
  const orgId = input.orgId!;
  safe(`client-appt-reminder-${input.when} to ${input.clientPhone}`, () =>
    sendText(orgId, input.clientPhone!, text, {
      // Un cliente solo debe recibir un único reminder 24h y un único 2h por
      // cita; si el loop se dispara más veces (restart, race) la dedup key
      // colapsa el duplicado.
      dedupKey: `client-appt-reminder:${input.when}:${input.clientPhone}:${input.scheduledAtISO}`,
      label: `client-appt-reminder-${input.when} to ${input.clientPhone}`,
    }),
  );
}

