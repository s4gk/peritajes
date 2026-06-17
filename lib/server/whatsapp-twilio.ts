import "server-only";

import crypto from "node:crypto";

/**
 * Adaptador de Twilio WhatsApp — proveedor alternativo a Meta, seleccionable
 * vía `MESSAGING_PROVIDER=twilio`. La selección de proveedor la hace el
 * dispatcher en `./messaging`; este módulo solo habla con la API de Twilio.
 *
 * Diferencias clave vs Meta (importantes para entender el código):
 *  - Auth: Account SID + Auth Token (Basic Auth), no un bearer token.
 *  - Plantillas: Twilio usa "Content Templates" identificadas por un Content
 *    SID (HX...). Cada plantilla de la plataforma (nuevo_peritaje, peritaje_pdf,
 *    etc.) se mapea a su Content SID por variable de entorno
 *    `TWILIO_CONTENT_SID_<NOMBRE_EN_MAYUS>`.
 *  - Variables: los {{1}},{{2}}... se mandan como `ContentVariables` (JSON
 *    `{"1":"...","2":"..."}`).
 *  - PDF: Twilio NO recibe los bytes (como Meta). Busca el archivo en una URL
 *    pública. Usamos el link público del peritaje (`/r/{token}`) como `MediaUrl`.
 *
 * Variables de entorno:
 *   TWILIO_ACCOUNT_SID          (obligatoria)
 *   TWILIO_AUTH_TOKEN           (obligatoria)
 *   TWILIO_WHATSAPP_FROM        número WhatsApp del sender, formato "+57..."
 *                               (o usar TWILIO_MESSAGING_SERVICE_SID)
 *   TWILIO_MESSAGING_SERVICE_SID (opcional, alternativa a FROM)
 *   TWILIO_CONTENT_SID_<NOMBRE> Content SID por cada plantilla
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01";

function accountSid(): string {
  return process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
}

function authToken(): string {
  return process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
}

function fromNumber(): string {
  return process.env.TWILIO_WHATSAPP_FROM?.trim() ?? "";
}

function messagingServiceSid(): string {
  return process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? "";
}

export function isTwilioConfigured(): boolean {
  return !!(
    accountSid() &&
    authToken() &&
    (fromNumber() || messagingServiceSid())
  );
}

/**
 * Content SID de una plantilla. Cada plantilla creada en Twilio Console se
 * expone por env como `TWILIO_CONTENT_SID_<NOMBRE_EN_MAYUS>`. Ej:
 *   peritaje_pdf  →  TWILIO_CONTENT_SID_PERITAJE_PDF=HX....
 */
function contentSidFor(templateName: string): string {
  const key = `TWILIO_CONTENT_SID_${templateName.toUpperCase()}`;
  const sid = process.env[key]?.trim();
  if (!sid) {
    throw new Error(
      `Falta ${key}: cada plantilla de Twilio necesita su Content SID. ` +
        `Créala en Twilio Console y agrega ${key}=HX... al entorno.`,
    );
  }
  return sid;
}

/** Normaliza teléfono colombiano a E.164 con "+" (ej: "+573001234567"). */
export function normalizeTwilioPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `+57${digits}`;
  if (digits.length === 12 && digits.startsWith("573")) return `+${digits}`;
  throw new Error(
    `Teléfono inválido "${phone}": se espera celular colombiano de 10 dígitos empezando en 3.`,
  );
}

function waAddress(phone: string): string {
  return `whatsapp:${normalizeTwilioPhone(phone)}`;
}

function basicAuthHeader(): string {
  const creds = `${accountSid()}:${authToken()}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

async function postMessage(params: Record<string, string>): Promise<void> {
  const body = new URLSearchParams(params);
  // Sender: Messaging Service tiene prioridad si está configurado.
  if (messagingServiceSid()) {
    body.set("MessagingServiceSid", messagingServiceSid());
  } else {
    body.set("From", waAddress(fromNumber().replace(/^whatsapp:/, "")));
  }

  const res = await fetch(
    `${TWILIO_API}/Accounts/${accountSid()}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* noop */
    }
    throw new Error(`Twilio ${res.status}: ${detail}`);
  }
}

/** Convierte ["a","b"] → {"1":"a","2":"b"} para ContentVariables. */
function toContentVariables(params: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  params.forEach((value, i) => {
    out[String(i + 1)] = value;
  });
  return out;
}

/**
 * Envía una plantilla (Content Template) por Content SID. Los bodyParams se
 * mapean a {{1}},{{2}}... vía ContentVariables.
 */
export async function sendTwilioTemplate(
  to: string,
  templateName: string,
  bodyParams: string[],
): Promise<void> {
  await postMessage({
    To: waAddress(to),
    ContentSid: contentSidFor(templateName),
    ContentVariables: JSON.stringify(toContentVariables(bodyParams)),
  });
}

/**
 * Envía una plantilla con PDF adjunto. Twilio busca el PDF en `publicUrl`
 * (URL pública que devuelve el archivo, ej. el link `/r/{token}`).
 *
 * La URL pública se inyecta como la SIGUIENTE variable después de los
 * bodyParams. Es decir, si la plantilla tiene 3 variables de cuerpo
 * ({{1}},{{2}},{{3}}), la URL del media va en {{4}} — y en el Content Template
 * de Twilio Console el "media URL" del header debe apuntar a esa variable.
 */
export async function sendTwilioDocumentTemplate(
  to: string,
  templateName: string,
  opts: { publicUrl?: string; filename?: string },
  bodyParams: string[],
): Promise<void> {
  if (!opts.publicUrl?.trim()) {
    throw new Error(
      "Twilio requiere una URL pública del PDF (publicUrl). " +
        "Twilio no acepta los bytes del archivo como Meta.",
    );
  }
  const vars = toContentVariables(bodyParams);
  // La URL del media va en la variable inmediatamente posterior a los bodyParams.
  vars[String(bodyParams.length + 1)] = opts.publicUrl.trim();

  await postMessage({
    To: waAddress(to),
    ContentSid: contentSidFor(templateName),
    ContentVariables: JSON.stringify(vars),
  });
}

/**
 * Mensaje de texto libre (solo dentro de la ventana de sesión de 24h, igual
 * que Meta). Para pruebas desde el panel admin.
 */
export async function sendTwilioFreeText(
  to: string,
  text: string,
): Promise<void> {
  await postMessage({ To: waAddress(to), Body: text });
}

/**
 * Valida la firma `X-Twilio-Signature` de un webhook de Twilio.
 *
 * Twilio firma con HMAC-SHA1 (base64) la URL completa del webhook concatenada
 * con los pares clave/valor del POST ordenados alfabéticamente por clave, usando
 * el Auth Token como clave. Ver:
 * https://www.twilio.com/docs/usage/security#validating-requests
 *
 *   - { ok: true }                         → firma válida.
 *   - { ok: false, reason }                → rechazar (403).
 *   - { ok: null, reason: "unconfigured" } → sin auth token; el caller decide.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
): { ok: boolean | null; reason?: string } {
  const secret = authToken();
  if (!secret) return { ok: null, reason: "unconfigured" };
  if (!signatureHeader) return { ok: false, reason: "missing-signature" };

  // Concatenar URL + cada par clave/valor (claves ordenadas), sin separadores.
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];

  const expected = crypto
    .createHmac("sha1", secret)
    .update(Buffer.from(data, "utf8"))
    .digest("base64");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "length-mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/** Estado de la integración Twilio para el panel /whatsapp. */
export function getTwilioStatus() {
  const configured = isTwilioConfigured();
  return {
    provider: "twilio" as const,
    status: configured ? ("connected" as const) : ("disconnected" as const),
    phone: configured ? fromNumber() || messagingServiceSid() || null : null,
    qrDataUrl: null,
    connectedAt: configured ? Date.now() : null,
    lastError: configured
      ? null
      : "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y un sender (TWILIO_WHATSAPP_FROM o TWILIO_MESSAGING_SERVICE_SID) no configurados",
    queueSize: 0,
  };
}
