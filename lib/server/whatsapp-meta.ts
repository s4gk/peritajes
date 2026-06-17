import "server-only";

import crypto from "node:crypto";

/**
 * Cliente oficial de WhatsApp Cloud API de Meta — ÚNICO proveedor de WhatsApp.
 *
 * Activo cuando META_WA_TOKEN y META_WA_PHONE_NUMBER_ID están en el entorno.
 * TODO el envío de mensajes de la plataforma va por aquí. La plataforma usa
 * un solo número empresarial de Meta para todas las orgs (el `orgId` solo
 * sirve para auditar y deduplicar, no para enrutar el envío).
 *
 * Los mensajes business-initiated requieren templates pre-aprobados por Meta.
 * Ver el objeto TEMPLATES al final de este archivo para los nombres exactos
 * y parámetros de cada template que hay que crear en Meta Business Manager.
 */

const GRAPH_API = "https://graph.facebook.com/v20.0";

function token(): string {
  return process.env.META_WA_TOKEN ?? "";
}

function phoneNumberId(): string {
  return process.env.META_WA_PHONE_NUMBER_ID ?? "";
}

export function isMetaConfigured(): boolean {
  return !!(token().trim() && phoneNumberId().trim());
}

/**
 * Tenant sentinel para el admin (Vestel/soporte) cuando no tiene `org_id`.
 * En el modelo Meta-only no hay sockets por org — este valor solo etiqueta
 * la auditoría y las llaves de dedup de envíos disparados por un admin que
 * opera sobre peritajes huérfanos (creados antes del multi-tenant).
 */
export const ADMIN_WA_ORG = "__admin__";

/**
 * Devuelve el orgId que debe etiquetar una operación WA, dado un actor y
 * opcionalmente el peritaje involucrado. Prioridad:
 *   1. orgId del peritaje (peritajes nuevos lo traen).
 *   2. orgId del actor (owner/employee sobre un peritaje legacy sin org).
 *   3. Sentinel del admin si el actor es admin (peritaje huérfano + admin).
 *   4. null — el caller decide si omite o registra sin org.
 */
export function resolveWaOrgId(
  actor: { role: string; orgId: string | null },
  inspectionOrgId?: string | null,
): string | null {
  if (inspectionOrgId) return inspectionOrgId;
  if (actor.orgId) return actor.orgId;
  if (actor.role === "admin") return ADMIN_WA_ORG;
  return null;
}

/**
 * Secreto de la app de Meta — usado para validar la firma de los webhooks.
 * Se configura en Meta Business Manager → Configuración de la app → Clave
 * secreta de la app, y se expone como META_WA_APP_SECRET en el entorno.
 */
function appSecret(): string {
  return process.env.META_WA_APP_SECRET?.trim() ?? "";
}

/**
 * Valida la firma `X-Hub-Signature-256` que Meta envía en cada webhook POST.
 * El header tiene la forma `sha256=<hex>` donde el hex es el HMAC-SHA256 del
 * cuerpo crudo (bytes exactos) usando el app secret como clave.
 *
 * Devuelve el veredicto + un motivo legible para logs:
 *   - { ok: true }                          → firma válida.
 *   - { ok: false, reason }                 → rechazar el webhook (401).
 *   - { ok: null, reason: "unconfigured" }  → no hay app secret; el caller
 *     decide (en dev dejamos pasar con warning; en prod hay que configurarlo).
 *
 * Usamos `timingSafeEqual` para no filtrar información por timing.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
): { ok: boolean | null; reason?: string } {
  const secret = appSecret();
  if (!secret) return { ok: null, reason: "unconfigured" };
  if (!signatureHeader) return { ok: false, reason: "missing-signature" };

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "length-mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/** Normaliza teléfono colombiano a E.164 sin + (ej: "573001234567"). */
export function normalizeMetaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("573")) return digits;
  throw new Error(
    `Teléfono inválido "${phone}": se espera celular colombiano de 10 dígitos empezando en 3.`,
  );
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    detail = await res.text();
  } catch { /* noop */ }
  throw new Error(`Meta WA ${res.status}: ${detail}`);
}

/**
 * Envía un template de texto. Los bodyParams se mapean a {{1}}, {{2}}, etc.
 */
export async function sendMetaTemplate(
  to: string,
  templateName: string,
  bodyParams: string[],
): Promise<void> {
  const components =
    bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ]
      : [];

  const res = await fetch(`${GRAPH_API}/${phoneNumberId()}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizeMetaPhone(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: "es" },
        components,
      },
    }),
  });
  await assertOk(res);
}

/**
 * Sube un PDF a la Media API de Meta y devuelve el media_id.
 * El id tiene una vida útil de 30 días desde la subida.
 */
async function uploadPdf(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append(
    "file",
    new Blob([buffer as unknown as ArrayBuffer], { type: "application/pdf" }),
    filename,
  );

  const res = await fetch(`${GRAPH_API}/${phoneNumberId()}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}` },
    body: form,
  });
  await assertOk(res);
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Envía un template cuyo HEADER es un DOCUMENT (PDF).
 * El template en Meta Business Manager debe tener HEADER de tipo Document.
 */
export async function sendMetaDocumentTemplate(
  to: string,
  templateName: string,
  pdfBuffer: Buffer,
  filename: string,
  bodyParams: string[],
): Promise<void> {
  const mediaId = await uploadPdf(pdfBuffer, filename);

  const components: unknown[] = [
    {
      type: "header",
      parameters: [
        { type: "document", document: { id: mediaId, filename } },
      ],
    },
  ];
  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    });
  }

  const res = await fetch(`${GRAPH_API}/${phoneNumberId()}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizeMetaPhone(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: "es" },
        components,
      },
    }),
  });
  await assertOk(res);
}

/**
 * Devuelve el estado de la integración Meta para el panel /whatsapp.
 */
export function getMetaStatus() {
  const configured = isMetaConfigured();
  return {
    provider: "meta" as const,
    status: configured ? ("connected" as const) : ("disconnected" as const),
    phone: configured ? (process.env.META_WA_DISPLAY_PHONE ?? null) : null,
    qrDataUrl: null,
    connectedAt: configured ? Date.now() : null,
    lastError: configured ? null : "META_WA_TOKEN y META_WA_PHONE_NUMBER_ID no configurados",
    queueSize: 0,
  };
}

/**
 * Envía un mensaje de texto libre al número dado (solo para pruebas).
 * Meta solo permite mensajes libres dentro de una ventana de sesión activa
 * (el cliente nos escribió en las últimas 24h). Para producción, usar templates.
 */
export async function sendMetaFreeText(to: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH_API}/${phoneNumberId()}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizeMetaPhone(to),
      type: "text",
      text: { body: text },
    }),
  });
  await assertOk(res);
}

// ---------------------------------------------------------------------------
//  PLANTILLAS DE META — crear estas plantillas en Meta Business Manager
//  antes de activar la integración. Categoría: UTILITY. Idioma: es.
// ---------------------------------------------------------------------------
//
//  1. nuevo_peritaje (equipo — intake nuevo)
//     Body: "Nuevo peritaje ingresado.\nVehículo: {{1}} ({{2}})\nCliente: {{3}}\nPerito: {{4}}\nVer: {{5}}"
//
//  2. peritaje_firmado (equipo — firma completada)
//     Body: "Peritaje firmado y listo.\nPlaca: {{1}}\nCliente: {{2}}\nVer: {{3}}"
//
//  3. firma_link (cliente — link presencial, 10 min)
//     Body: "Hola {{1}}, el peritaje de tu vehículo placa *{{2}}* está listo para tu firma.\n\nFirma aquí (válido 10 min):\n{{3}}\n\nSi el link vence, pídele al perito que genere uno nuevo."
//
//  4. firma_remota (cliente — link remoto, 72h)
//     Body: "Hola {{1}}, el perito {{2}} terminó la inspección de tu vehículo placa *{{3}}*.\n\nFirma desde tu celular (válido 72 h):\n{{4}}\n\nSi el link vence, podemos generarte otro."
//
//  5. firma_recibida (perito — firma del cliente recibida)
//     Body: "Firma del cliente recibida.\nPlaca: {{1}}\nCliente: {{2}}\nFinaliza el peritaje: {{3}}"
//
//  6. peritaje_pdf (cliente — PDF adjunto)
//     Header: DOCUMENT  ← obligatorio para adjuntar el PDF
//     Body: "Hola {{1}}, tu peritaje de la placa *{{2}}* está listo. {{3}}"
//
//  7. peritaje_link (cliente — link público del peritaje)
//     Body: "Hola {{1}}, tu peritaje de la placa *{{2}}* está listo.\n\n📄 Ver y descargar (válido 90 días):\n{{3}}\n\nTambién te enviamos el PDF en el siguiente mensaje."
//
//  8. cita_asignada (perito — nueva cita asignada)
//     Body: "Cita asignada.\nCuándo: {{1}}\nPlaca: {{2}}\nVehículo: {{3}}\nCliente: {{4}}\nTel: {{5}}\nUbicación: {{6}}"
//
//  9. cita_confirmada (cliente — cita agendada)
//     Body: "Hola {{1}}, tu peritaje quedó agendado para *{{2}}*.\nPlaca: {{3}}\nUbicación: {{4}}\nSi necesitas cancelar o reprogramar, responde este chat."
//
//  10. recordatorio_24h (cliente — recordatorio 24h antes)
//      Body: "Hola {{1}}, te recordamos que mañana tienes tu peritaje.\n\nCuándo: {{2}}\nPlaca: {{3}}\nUbicación: {{4}}\n\nSi no puedes asistir, responde este chat para reprogramar."
//
//  11. recordatorio_2h (cliente — recordatorio 2h antes)
//      Body: "Hola {{1}}, en aproximadamente 2 horas tienes tu peritaje.\n\nCuándo: {{2}}\nPlaca: {{3}}\nUbicación: {{4}}\n\nSi no puedes asistir, responde este chat para reprogramar."
//
//  12. no_asistio (cliente — no-show)
//      Body: "Hola {{1}}, notamos que no pudiste llegar a tu cita de peritaje{{2}}.\n\n¿Te gustaría reagendar? Escríbenos y buscamos un nuevo horario."
