import "server-only";

/**
 * Cliente oficial de WhatsApp Cloud API de Meta.
 *
 * Activo cuando META_WA_TOKEN y META_WA_PHONE_NUMBER_ID están en el entorno.
 * En ese caso, TODO el envío de mensajes va por aquí — Baileys queda inactivo.
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
