import "server-only";

import { getUserById, listTeamWhatsAppPhones } from "./auth";
import { query } from "./db";
import { sendPushToOrg, sendPushToUser } from "./push";
import {
  isMetaConfigured,
  sendMetaDocumentTemplate,
  sendMetaTemplate,
} from "./whatsapp-meta";
import {
  getWhatsAppStatus,
  sendDocument,
  sendText,
} from "./whatsapp";

// ---------------------------------------------------------------------------
//  Tipos y helpers internos
// ---------------------------------------------------------------------------

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

function appUrl(): string {
  return process.env.APP_PUBLIC_URL?.trim().replace(/\/$/, "") || "https://app.local";
}

function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[wa-notify] ${label} falló:`, (err as Error).message);
  }
}

// Dedup en memoria para envíos Meta (equivalente al dedup de la cola Baileys).
const META_DEDUP_TTL_MS = 10 * 60_000;
const metaDedup = new Map<string, number>(); // key → expiry epoch ms

function isMetaDeduped(key: string): boolean {
  const exp = metaDedup.get(key);
  if (!exp) return false;
  if (exp <= Date.now()) {
    metaDedup.delete(key);
    return false;
  }
  return true;
}

function markMetaDedup(key: string): void {
  metaDedup.set(key, Date.now() + META_DEDUP_TTL_MS);
}

type OnResult = (r: { ok: boolean; error?: string }) => void | Promise<void>;

/**
 * Dispara una llamada a la Meta API en fire-and-forget con dedup, logging
 * y callback de resultado (para auditoría). Mismo patrón que el enqueue
 * de Baileys pero sin cola: Meta responde en <1s y no necesita rate-limit
 * manual porque tiene el suyo propio a nivel de API.
 */
function safeMeta(
  label: string,
  dedupKey: string | null,
  fn: () => Promise<void>,
  onResult?: OnResult,
): void {
  if (dedupKey) {
    if (isMetaDeduped(dedupKey)) {
      console.warn(`[wa-meta] descartado por dedup: ${label} (key=${dedupKey})`);
      return;
    }
    markMetaDedup(dedupKey);
  }
  fn().then(
    () => {
      void onResult?.({ ok: true });
    },
    (err: Error) => {
      console.error(`[wa-meta] ${label} falló:`, err.message);
      void onResult?.({ ok: false, error: err.message });
    },
  );
}

/** Verifica si el canal WA (Baileys) está operativo para una org. */
function isBaileysReady(orgId: string | null): boolean {
  if (!orgId) return false;
  const s = getWhatsAppStatus(orgId);
  return s.status === "connected" || s.queueSize < 50;
}

async function loadTeamPhones(
  context: string,
  orgId: string | null,
): Promise<Awaited<ReturnType<typeof listTeamWhatsAppPhones>>> {
  if (!orgId) {
    console.warn(`[wa-notify] ${context}: sin orgId, no se mandan avisos internos.`);
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

// ---------------------------------------------------------------------------
//  Notificaciones — cada función tiene un bloque Meta y un fallback Baileys
// ---------------------------------------------------------------------------

/** Caso 1: aviso al equipo cuando se crea un peritaje nuevo desde intake. */
export async function notifyTeamNewIntake(input: {
  inspectionId: string;
  plate: string;
  vehicle: string;
  owner: string;
  inspectorName: string;
  orgId: string | null;
}): Promise<void> {
  if (isMetaConfigured()) {
    const team = await loadTeamPhones("team-intake", input.orgId);
    for (const member of team) {
      safeMeta(
        `team-intake to ${member.fullName}`,
        `team-intake:${input.inspectionId}:${member.waPhone}`,
        () =>
          sendMetaTemplate(member.waPhone, "nuevo_peritaje", [
            input.vehicle || "—",
            input.plate || "—",
            input.owner || "—",
            input.inspectorName,
            `${appUrl()}/inspection/${input.inspectionId}`,
          ]),
      );
    }
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(input.orgId)) return;
  const team = await loadTeamPhones("team-intake", input.orgId);
  if (team.length === 0) return;
  const text = [
    "🚗 *Nuevo peritaje*",
    `Placa: ${input.plate || "—"}`,
    `Vehículo: ${input.vehicle || "—"}`,
    `Cliente: ${input.owner || "—"}`,
    `Perito: ${input.inspectorName}`,
    "",
    `Ver: ${appUrl()}/inspection/${input.inspectionId}`,
  ].join("\n");
  const orgId = input.orgId!;
  for (const member of team) {
    safe(`team-intake to ${member.fullName}`, () =>
      sendText(orgId, member.waPhone, text, {
        dedupKey: `team-intake:${input.inspectionId}:${member.waPhone}`,
        label: `team-intake to ${member.fullName}`,
      }),
    );
  }
}

/** Caso 2: aviso al equipo cuando el cliente firma. */
export async function notifyTeamSignatureCompleted(input: {
  inspectionId: string;
  plate: string;
  owner: string;
  orgId: string | null;
}): Promise<void> {
  if (input.orgId) {
    void sendPushToOrg(input.orgId, {
      title: "Peritaje firmado",
      body: `${input.plate || "Sin placa"} · ${input.owner || "—"}`,
      url: `/inspection/${input.inspectionId}`,
      tag: `signed-${input.inspectionId}`,
    }).catch(() => {});
  }
  if (isMetaConfigured()) {
    const team = await loadTeamPhones("team-signed", input.orgId);
    for (const member of team) {
      safeMeta(
        `team-signed to ${member.fullName}`,
        `team-signed:${input.inspectionId}:${member.waPhone}`,
        () =>
          sendMetaTemplate(member.waPhone, "peritaje_firmado", [
            input.plate || "—",
            input.owner || "—",
            `${appUrl()}/inspection/${input.inspectionId}`,
          ]),
      );
    }
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(input.orgId)) return;
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

/** Caso 3: link de firma presencial al cliente (TTL 10 min). */
export function notifyClientSignLink(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  signToken: string;
  orgId: string | null;
  inspectionId?: string | null;
}): void {
  if (!input.clientPhone?.trim()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;

  if (isMetaConfigured()) {
    safeMeta(
      `client-sign to ${phone}`,
      `client-sign:${input.signToken}`,
      () =>
        sendMetaTemplate(phone, "firma_link", [
          input.ownerName?.trim() || "cliente",
          input.plate || "—",
          `${appUrl()}/sign/${input.signToken}`,
        ]),
      (r) => recordWaDelivery(orgId, { type: "client-sign", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const text = [
    greeting,
    `Te enviamos el link para firmar el peritaje de la placa ${input.plate || "—"}:`,
    "",
    `${appUrl()}/sign/${input.signToken}`,
    "",
    "El link expira en 10 minutos. Si no alcanzas, el perito puede generarte uno nuevo.",
  ].join("\n");
  safe(`client-sign to ${phone}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey: `client-sign:${input.signToken}`,
      label: `client-sign to ${phone}`,
      onResult: (r) =>
        recordWaDelivery(orgId, { type: "client-sign", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    }),
  );
}

/** Variante remota: link de firma con TTL 72h. */
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
  if (!input.clientPhone?.trim()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;

  if (isMetaConfigured()) {
    safeMeta(
      `client-sign-remote to ${phone}`,
      `client-sign-remote:${input.signToken}`,
      () =>
        sendMetaTemplate(phone, "firma_remota", [
          input.ownerName?.trim() || "cliente",
          input.inspectorName,
          input.plate || "—",
          `${appUrl()}/sign/${input.signToken}`,
        ]),
      (r) => recordWaDelivery(orgId, { type: "client-sign-remote", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
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
  safe(`client-sign-remote to ${phone}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey: `client-sign-remote:${input.signToken}`,
      label: `client-sign-remote to ${phone}`,
      onResult: (r) =>
        recordWaDelivery(orgId, { type: "client-sign-remote", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    }),
  );
}

/** Aviso al perito cuando el cliente firma remotamente. */
export async function notifyPeritoSignatureReceived(input: {
  peritoUserId: string | null;
  inspectionId: string;
  plate: string;
  ownerName: string;
  orgId: string | null;
}): Promise<void> {
  if (!input.peritoUserId) return;
  const perito = await getUserById(input.peritoUserId).catch(() => null);
  if (!perito?.waPhone?.trim()) return;
  const phone = perito.waPhone;
  const orgId = input.orgId;

  if (isMetaConfigured()) {
    safeMeta(
      `perito-signed to ${perito.fullName}`,
      `perito-signed:${input.inspectionId}`,
      () =>
        sendMetaTemplate(phone, "firma_recibida", [
          input.plate || "—",
          input.ownerName || "—",
          `${appUrl()}/inspection/${input.inspectionId}`,
        ]),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
  const text = [
    "✍️ *Firma del cliente recibida*",
    `Placa: ${input.plate || "—"}`,
    `Cliente: ${input.ownerName || "—"}`,
    "",
    "El cliente firmó remotamente. Puedes finalizar el peritaje:",
    `${appUrl()}/inspection/${input.inspectionId}`,
  ].join("\n");
  safe(`perito-signed to ${perito.fullName}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey: `perito-signed:${input.inspectionId}`,
      label: `perito-signed to ${perito.fullName}`,
    }),
  );
}

/** Caso 4: PDF final al cliente. */
export function notifyClientFinalPdf(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  reportNumber: string | null;
  pdfBuffer: Buffer;
  orgId: string | null;
  manualResend?: boolean;
  inspectionId?: string | null;
}): void {
  if (!input.clientPhone?.trim()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;
  const filename = input.reportNumber
    ? `Peritaje-${input.reportNumber}.pdf`
    : `Peritaje-${input.plate || "vehiculo"}.pdf`;
  const baseDedupKey = input.reportNumber
    ? `client-pdf:${input.reportNumber}`
    : `client-pdf:${phone}:${input.plate || "x"}`;
  const dedupKey = input.manualResend
    ? `${baseDedupKey}:resend:${Date.now()}`
    : baseDedupKey;

  if (isMetaConfigured()) {
    safeMeta(
      `client-pdf to ${phone}`,
      dedupKey,
      () =>
        sendMetaDocumentTemplate(
          phone,
          "peritaje_pdf",
          input.pdfBuffer,
          filename,
          [
            input.ownerName?.trim() || "cliente",
            input.plate || "—",
            input.reportNumber ? `Informe N° ${input.reportNumber}.` : "Cualquier duda, escríbenos.",
          ],
        ),
      (r) => recordWaDelivery(orgId, { type: "client-pdf", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const caption = [
    greeting,
    `Adjunto el peritaje finalizado de la placa ${input.plate || "—"}.`,
    input.reportNumber ? `Informe N° ${input.reportNumber}.` : "",
    "Cualquier duda, escríbenos por este mismo medio.",
  ]
    .filter(Boolean)
    .join("\n");
  safe(`client-pdf to ${phone}`, () =>
    sendDocument(orgId!, phone, input.pdfBuffer, filename, {
      caption,
      dedupKey,
      label: `client-pdf to ${phone}`,
      onResult: (r) =>
        recordWaDelivery(orgId, { type: "client-pdf", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    }),
  );
}

/** Caso 4b: link público del peritaje al cliente. */
export function notifyClientShareLink(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  reportNumber: string | null;
  shareUrl: string;
  orgId: string | null;
  inspectionId?: string | null;
}): void {
  if (!input.clientPhone?.trim()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;
  const dedupKey = input.reportNumber
    ? `client-link:${input.reportNumber}`
    : `client-link:${phone}:${input.plate || "x"}`;

  if (isMetaConfigured()) {
    safeMeta(
      `client-link to ${phone}`,
      dedupKey,
      () =>
        sendMetaTemplate(phone, "peritaje_link", [
          input.ownerName?.trim() || "cliente",
          input.plate || "—",
          input.reportNumber ? `Informe N° ${input.reportNumber}.` : "",
          input.shareUrl,
        ]),
      (r) => recordWaDelivery(orgId, { type: "client-link", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const text = [
    greeting,
    `Tu peritaje de la placa *${input.plate || "—"}* está listo.`,
    ...(input.reportNumber ? [`Informe N° ${input.reportNumber}.`] : []),
    "",
    "📄 Ver y descargar tu peritaje:",
    input.shareUrl,
    "",
    "El enlace es válido por 90 días. También te enviamos el PDF adjunto en el siguiente mensaje.",
  ].join("\n");
  safe(`client-link to ${phone}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey,
      label: `client-link to ${phone}`,
      onResult: (r) =>
        recordWaDelivery(orgId, { type: "client-link", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    }),
  );
}

/** Aviso al perito cuando se le asigna una cita. */
export async function notifyAssignedPerito(input: {
  peritoUserId: string;
  ownerName: string;
  ownerPhone: string;
  plate: string;
  vehicleLabel: string;
  scheduledAtISO: string;
  location: string;
  orgId: string | null;
}): Promise<void> {
  void sendPushToUser(input.peritoUserId, {
    title: "Cita asignada",
    body: `${fmtScheduledAt(input.scheduledAtISO)} · ${input.plate || "Sin placa"} · ${input.ownerName || "—"}`,
    url: "/agenda",
    tag: `appt-${input.peritoUserId}-${input.scheduledAtISO}`,
  }).catch(() => {});

  const perito = await getUserById(input.peritoUserId).catch(() => null);
  if (!perito?.waPhone?.trim()) return;
  const phone = perito.waPhone;
  const orgId = input.orgId;

  if (isMetaConfigured()) {
    safeMeta(
      `perito-assigned to ${perito.fullName}`,
      `perito-assigned:${input.peritoUserId}:${input.scheduledAtISO}`,
      () =>
        sendMetaTemplate(phone, "cita_asignada", [
          fmtScheduledAt(input.scheduledAtISO),
          input.plate || "—",
          input.vehicleLabel || "—",
          input.ownerName || "—",
          input.ownerPhone || "—",
          input.location || "—",
        ]),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
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
  safe(`perito-assigned to ${perito.fullName}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey: `perito-assigned:${input.peritoUserId}:${input.scheduledAtISO}`,
      label: `perito-assigned to ${perito.fullName}`,
    }),
  );
}

/** Confirmación de cita al cliente. */
export function notifyClientAppointmentConfirmed(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  vehicleLabel: string;
  scheduledAtISO: string;
  location: string;
  orgId: string | null;
}): void {
  if (!input.clientPhone?.trim()) return;
  const phone = input.clientPhone;
  const orgId = input.orgId;

  if (isMetaConfigured()) {
    safeMeta(
      `client-appt-confirm to ${phone}`,
      `client-appt-confirm:${phone}:${input.scheduledAtISO}`,
      () =>
        sendMetaTemplate(phone, "cita_confirmada", [
          input.ownerName?.trim() || "cliente",
          fmtScheduledAt(input.scheduledAtISO),
          input.plate || "—",
          input.location || "—",
        ]),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
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
  safe(`client-appt-confirm to ${phone}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey: `client-appt-confirm:${phone}:${input.scheduledAtISO}`,
      label: `client-appt-confirm to ${phone}`,
    }),
  );
}

/** Recordatorio de cita al cliente (24h o 2h antes). */
export function notifyClientAppointmentReminder(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  scheduledAtISO: string;
  location: string;
  when: "24h" | "2h";
  orgId: string | null;
}): void {
  if (!input.clientPhone?.trim()) return;
  const phone = input.clientPhone;
  const orgId = input.orgId;
  const templateName = input.when === "24h" ? "recordatorio_24h" : "recordatorio_2h";

  if (isMetaConfigured()) {
    safeMeta(
      `client-appt-reminder-${input.when} to ${phone}`,
      `client-appt-reminder:${input.when}:${phone}:${input.scheduledAtISO}`,
      () =>
        sendMetaTemplate(phone, templateName, [
          input.ownerName?.trim() || "cliente",
          fmtScheduledAt(input.scheduledAtISO),
          input.plate || "—",
          input.location || "—",
        ]),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
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
  safe(`client-appt-reminder-${input.when} to ${phone}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey: `client-appt-reminder:${input.when}:${phone}:${input.scheduledAtISO}`,
      label: `client-appt-reminder-${input.when} to ${phone}`,
    }),
  );
}

/** Mensaje de no-show al cliente. */
export function notifyClientNoShow(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  orgId: string | null;
  inspectionId?: string | null;
}): void {
  if (!input.clientPhone?.trim()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;

  if (isMetaConfigured()) {
    safeMeta(
      `client-noshow to ${phone}`,
      `noshow:${phone}:${input.plate || "x"}:${Date.now()}`,
      () =>
        sendMetaTemplate(phone, "no_asistio", [
          input.ownerName?.trim() || "cliente",
          input.plate ? ` para la placa *${input.plate}*` : "",
        ]),
      (r) => recordWaDelivery(orgId, { type: "client-noshow", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    );
    return;
  }
  // Baileys fallback
  if (!isBaileysReady(orgId)) return;
  const greeting = input.ownerName?.trim() ? `Hola ${input.ownerName},` : "Hola,";
  const text = [
    greeting,
    `Notamos que no pudiste llegar a tu cita de peritaje${input.plate ? ` para la placa *${input.plate}*` : ""}.`,
    "",
    "¿Te gustaría reagendar? Escríbenos y buscamos un nuevo horario que te quede bien.",
  ].join("\n");
  safe(`client-noshow to ${phone}`, () =>
    sendText(orgId!, phone, text, {
      dedupKey: `noshow:${phone}:${input.plate || "x"}:${Date.now()}`,
      label: `client-noshow to ${phone}`,
      onResult: (r) =>
        recordWaDelivery(orgId, { type: "client-noshow", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
    }),
  );
}
