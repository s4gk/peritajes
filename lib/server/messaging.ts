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
 *   - "twilio" → Twilio WhatsApp (lib/server/whatsapp-twilio.ts)
 *   - cualquier otro / no seteada → Meta WhatsApp Cloud API (default)
 *
 * Toda la capa de notificaciones (whatsapp-notifications.ts) habla SOLO con
 * este dispatcher, así cambiar de proveedor es flippear una env var sin tocar
 * la lógica de negocio.
 */

export type MessagingProvider = "meta" | "twilio";

export function activeProvider(): MessagingProvider {
  return process.env.MESSAGING_PROVIDER?.trim().toLowerCase() === "twilio"
    ? "twilio"
    : "meta";
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
  if (activeProvider() === "twilio") {
    return sendTwilioDocumentTemplate(
      to,
      templateName,
      { publicUrl: doc.publicUrl, filename: doc.filename },
      bodyParams,
    );
  }
  if (!doc.pdfBuffer) {
    throw new Error("Meta requiere los bytes del PDF (pdfBuffer).");
  }
  return sendMetaDocumentTemplate(
    to,
    templateName,
    doc.pdfBuffer,
    doc.filename,
    bodyParams,
  );
}

/** Texto libre (solo dentro de la ventana de sesión de 24h). Para pruebas. */
export async function sendFreeText(to: string, text: string): Promise<void> {
  if (activeProvider() === "twilio") {
    return sendTwilioFreeText(to, text);
  }
  return sendMetaFreeText(to, text);
}
