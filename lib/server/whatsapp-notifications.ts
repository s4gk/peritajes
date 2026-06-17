import "server-only";

import { getUserById, listTeamWhatsAppPhones } from "./auth";
import { query } from "./db";
import {
  isMessagingConfigured,
  sendDocumentTemplate,
  sendTemplate,
} from "./messaging";
import { sendPushToOrg, sendPushToUser } from "./push";

// ---------------------------------------------------------------------------
//  Tipos y helpers internos
//
//  Todas las notificaciones salen por el dispatcher de mensajería (./messaging),
//  que enruta a Meta WhatsApp Cloud API o a Twilio según MESSAGING_PROVIDER.
//  Si el proveedor activo no está configurado, las funciones son no-ops.
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

// Dedup en memoria para envíos Meta: si dos disparos llegan con la misma key
// dentro de la ventana, el segundo se descarta (evita duplicados por
// reintentos de UI o doble submit del wizard).
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
 * y callback de resultado (para auditoría). Meta responde en <1s y tiene su
 * propio rate-limit a nivel de API, así que no necesitamos cola manual.
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
//  Notificaciones — cada función envía un template de Meta
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
  if (!isMessagingConfigured()) return;
  const team = await loadTeamPhones("team-intake", input.orgId);
  for (const member of team) {
    safeMeta(
      `team-intake to ${member.fullName}`,
      `team-intake:${input.inspectionId}:${member.waPhone}`,
      () =>
        sendTemplate(member.waPhone, "nuevo_peritaje", [
          input.vehicle || "—",
          input.plate || "—",
          input.owner || "—",
          input.inspectorName,
          `${appUrl()}/inspection/${input.inspectionId}`,
        ]),
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
  if (!isMessagingConfigured()) return;
  const team = await loadTeamPhones("team-signed", input.orgId);
  for (const member of team) {
    safeMeta(
      `team-signed to ${member.fullName}`,
      `team-signed:${input.inspectionId}:${member.waPhone}`,
      () =>
        sendTemplate(member.waPhone, "peritaje_firmado", [
          input.plate || "—",
          input.owner || "—",
          `${appUrl()}/inspection/${input.inspectionId}`,
        ]),
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
  if (!isMessagingConfigured()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;

  safeMeta(
    `client-sign to ${phone}`,
    `client-sign:${input.signToken}`,
    () =>
      sendTemplate(phone, "firma_link", [
        input.ownerName?.trim() || "cliente",
        input.plate || "—",
        `${appUrl()}/sign/${input.signToken}`,
      ]),
    (r) => recordWaDelivery(orgId, { type: "client-sign", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
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
  if (!isMessagingConfigured()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;

  safeMeta(
    `client-sign-remote to ${phone}`,
    `client-sign-remote:${input.signToken}`,
    () =>
      sendTemplate(phone, "firma_remota", [
        input.ownerName?.trim() || "cliente",
        input.inspectorName,
        input.plate || "—",
        `${appUrl()}/sign/${input.signToken}`,
      ]),
    (r) => recordWaDelivery(orgId, { type: "client-sign-remote", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
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
  if (!isMessagingConfigured()) return;
  const perito = await getUserById(input.peritoUserId).catch(() => null);
  if (!perito?.waPhone?.trim()) return;
  const phone = perito.waPhone;

  safeMeta(
    `perito-signed to ${perito.fullName}`,
    `perito-signed:${input.inspectionId}`,
    () =>
      sendTemplate(phone, "firma_recibida", [
        input.plate || "—",
        input.ownerName || "—",
        `${appUrl()}/inspection/${input.inspectionId}`,
      ]),
  );
}

/** Caso 4: PDF final al cliente. */
export function notifyClientFinalPdf(input: {
  clientPhone: string | null | undefined;
  ownerName: string;
  plate: string;
  reportNumber: string | null;
  pdfBuffer: Buffer;
  /** URL pública que devuelve el PDF (ej. el link `/r/{token}`). La usa Twilio,
   *  que no acepta los bytes del archivo. Meta la ignora (sube el buffer). */
  pdfPublicUrl?: string | null;
  orgId: string | null;
  manualResend?: boolean;
  inspectionId?: string | null;
}): void {
  if (!input.clientPhone?.trim()) return;
  if (!isMessagingConfigured()) return;
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

  safeMeta(
    `client-pdf to ${phone}`,
    dedupKey,
    () =>
      sendDocumentTemplate(
        phone,
        "peritaje_pdf",
        {
          pdfBuffer: input.pdfBuffer,
          filename,
          publicUrl: input.pdfPublicUrl ?? undefined,
        },
        [
          input.ownerName?.trim() || "cliente",
          input.plate || "—",
          input.reportNumber ? `Informe N° ${input.reportNumber}.` : "Cualquier duda, escríbenos.",
        ],
      ),
    (r) => recordWaDelivery(orgId, { type: "client-pdf", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
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
  if (!isMessagingConfigured()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;
  const dedupKey = input.reportNumber
    ? `client-link:${input.reportNumber}`
    : `client-link:${phone}:${input.plate || "x"}`;

  safeMeta(
    `client-link to ${phone}`,
    dedupKey,
    () =>
      sendTemplate(phone, "peritaje_link", [
        input.ownerName?.trim() || "cliente",
        input.plate || "—",
        input.reportNumber ? `Informe N° ${input.reportNumber}.` : "",
        input.shareUrl,
      ]),
    (r) => recordWaDelivery(orgId, { type: "client-link", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
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

  if (!isMessagingConfigured()) return;
  const perito = await getUserById(input.peritoUserId).catch(() => null);
  if (!perito?.waPhone?.trim()) return;
  const phone = perito.waPhone;

  safeMeta(
    `perito-assigned to ${perito.fullName}`,
    `perito-assigned:${input.peritoUserId}:${input.scheduledAtISO}`,
    () =>
      sendTemplate(phone, "cita_asignada", [
        fmtScheduledAt(input.scheduledAtISO),
        input.plate || "—",
        input.vehicleLabel || "—",
        input.ownerName || "—",
        input.ownerPhone || "—",
        input.location || "—",
      ]),
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
  if (!isMessagingConfigured()) return;
  const phone = input.clientPhone;

  safeMeta(
    `client-appt-confirm to ${phone}`,
    `client-appt-confirm:${phone}:${input.scheduledAtISO}`,
    () =>
      sendTemplate(phone, "cita_confirmada", [
        input.ownerName?.trim() || "cliente",
        fmtScheduledAt(input.scheduledAtISO),
        input.plate || "—",
        input.location || "—",
      ]),
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
  if (!isMessagingConfigured()) return;
  const phone = input.clientPhone;
  const templateName = input.when === "24h" ? "recordatorio_24h" : "recordatorio_2h";

  safeMeta(
    `client-appt-reminder-${input.when} to ${phone}`,
    `client-appt-reminder:${input.when}:${phone}:${input.scheduledAtISO}`,
    () =>
      sendTemplate(phone, templateName, [
        input.ownerName?.trim() || "cliente",
        fmtScheduledAt(input.scheduledAtISO),
        input.plate || "—",
        input.location || "—",
      ]),
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
  if (!isMessagingConfigured()) return;
  const phone = input.clientPhone;
  const inspectionId = input.inspectionId ?? null;
  const orgId = input.orgId;

  safeMeta(
    `client-noshow to ${phone}`,
    `noshow:${phone}:${input.plate || "x"}:${Date.now()}`,
    () =>
      sendTemplate(phone, "no_asistio", [
        input.ownerName?.trim() || "cliente",
        input.plate ? ` para la placa *${input.plate}*` : "",
      ]),
    (r) => recordWaDelivery(orgId, { type: "client-noshow", inspectionId, phone, status: r.ok ? "sent" : "failed", error: r.error }),
  );
}
