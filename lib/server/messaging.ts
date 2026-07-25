import "server-only";

import {
  getMetaStatus,
  isMetaConfigured,
  normalizeMetaPhone,
  sendMetaDocumentTemplate,
  sendMetaFreeText,
  sendMetaTemplate,
} from "./whatsapp-meta";
import {
  getTwilioStatus,
  isTwilioConfigured,
  normalizeTwilioPhone,
  sendTwilioDocumentTemplate,
  sendTwilioFreeText,
  sendTwilioTemplate,
} from "./whatsapp-twilio";
/**
 * Dispatcher de mensajería WhatsApp. Selecciona el proveedor según la variable
 * de entorno `MESSAGING_PROVIDER`:
 *   - "twilio"  → Twilio WhatsApp (lib/server/whatsapp-twilio.ts)
 *   - "kapso"   → Kapso, proxy de la API oficial de Meta (mismo protocolo Meta;
 *                 lo maneja whatsapp-meta.ts con base URL + auth distintas)
 *   - cualquier otro / no seteada → Meta WhatsApp Cloud API directo (default)
 *
 * Nota: "meta" y "kapso" comparten el módulo whatsapp-meta.ts (Kapso es un
 * proxy del MISMO protocolo de Meta), así que ambos caen en las funciones
 * sendMeta*. El módulo Meta detecta el modo Kapso por env.
 *
 * Toda la capa de notificaciones (whatsapp-notifications.ts) habla SOLO con
 * este dispatcher, así cambiar de proveedor es flippear una env var sin tocar
 * la lógica de negocio.
 */

export type MessagingProvider = "meta" | "twilio" | "kapso";

/**
 * Modo prueba: si `WA_TEST_ALLOWLIST` está seteada (números separados por
 * coma, en cualquier formato), SOLO se envía a esos destinos; cualquier otro
 * se rechaza con error claro (queda como "failed" en la auditoría, no como
 * enviado). Protege a los clientes reales de recibir mensajes del número de
 * pruebas mientras no esté aprobado el número definitivo. Para desactivar el
 * modo prueba basta quitar la variable del entorno y reiniciar.
 */
/** Últimos 10 dígitos — así "3001234567" y "573001234567" casan igual. */
function allowKey(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function testAllowlist(): Set<string> | null {
  const raw = process.env.WA_TEST_ALLOWLIST?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map(allowKey).filter(Boolean));
}

function assertAllowedRecipient(to: string): void {
  const list = testAllowlist();
  if (!list) return;
  if (list.has(allowKey(to))) return;
  console.warn(
    `[wa] modo prueba: destino ${to} fuera de WA_TEST_ALLOWLIST — envío bloqueado.`,
  );
  throw new Error(
    "Modo prueba de WhatsApp: destinatario fuera de WA_TEST_ALLOWLIST",
  );
}

export function activeProvider(): MessagingProvider {
  const p = process.env.MESSAGING_PROVIDER?.trim().toLowerCase();
  if (p === "twilio") return "twilio";
  if (p === "kapso") return "kapso";
  return "meta";
}

export function isMessagingConfigured(): boolean {
  return activeProvider() === "twilio"
    ? isTwilioConfigured()
    : isMetaConfigured();
}

export function getMessagingStatus() {
  return activeProvider() === "twilio" ? getTwilioStatus() : getMetaStatus();
}

export function normalizePhone(phone: string): string {
  return activeProvider() === "twilio"
    ? normalizeTwilioPhone(phone)
    : normalizeMetaPhone(phone);
}

/** Envía una plantilla de texto. Los bodyParams mapean a {{1}},{{2}},... */
export async function sendTemplate(
  to: string,
  templateName: string,
  bodyParams: string[],
): Promise<void> {
  assertAllowedRecipient(to);
  if (activeProvider() === "twilio") {
    return sendTwilioTemplate(to, templateName, bodyParams);
  }
  return sendMetaTemplate(to, templateName, bodyParams);
}

/**
 * Envía una plantilla con PDF adjunto.
 *  - Meta usa los bytes (`pdfBuffer`) → los sube a su Media API.
 *  - Twilio usa una URL pública (`publicUrl`) → busca el archivo ahí.
 * El caller debe proveer ambos cuando sea posible para que funcione con
 * cualquier proveedor.
 */
export async function sendDocumentTemplate(
  to: string,
  templateName: string,
  doc: { pdfBuffer?: Buffer; filename: string; publicUrl?: string },
  bodyParams: string[],
): Promise<void> {
  assertAllowedRecipient(to);
  if (activeProvider() === "twilio") {
    return sendTwilioDocumentTemplate(
      to,
      templateName,
      { publicUrl: doc.publicUrl, filename: doc.filename },
      bodyParams,
    );
  }
  // meta o kapso: sendMetaDocumentTemplate valida según el modo
  // (Meta exige pdfBuffer; Kapso exige publicUrl).
  return sendMetaDocumentTemplate(
    to,
    templateName,
    doc.pdfBuffer,
    doc.filename,
    bodyParams,
    doc.publicUrl,
  );
}

/** Texto libre (solo dentro de la ventana de sesión de 24h). Para pruebas. */
export async function sendFreeText(to: string, text: string): Promise<void> {
  assertAllowedRecipient(to);
  if (activeProvider() === "twilio") {
    return sendTwilioFreeText(to, text);
  }
  return sendMetaFreeText(to, text);
}
