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

import { listTeamWhatsAppPhones } from "./auth";
import {
  getWhatsAppStatus,
  sendDocument,
  sendText,
} from "./whatsapp";

function isReady(): boolean {
  // No es bloqueante: aunque WA no esté listo, encolar es válido (se procesa
  // cuando reconecte). Esta función sirve solo para skip rápido cuando ni
  // siquiera vale la pena hacer la query de teléfonos del equipo.
  const s = getWhatsAppStatus();
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
 * Caso 1: aviso al equipo cuando se crea un peritaje nuevo desde intake.
 * Fan-out a todos los usuarios con `wa_phone` configurado.
 */
export async function notifyTeamNewIntake(input: {
  inspectionId: string;
  plate: string;
  vehicle: string; // "Toyota Corolla 2018"
  owner: string;
  inspectorName: string;
}): Promise<void> {
  if (!isReady()) return;
  const team = await listTeamWhatsAppPhones().catch(() => []);
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
  for (const member of team) {
    safe(`team-intake to ${member.fullName}`, () => sendText(member.waPhone, text));
  }
}

/**
 * Caso 2: aviso al equipo cuando el cliente firma y el peritaje queda listo.
 */
export async function notifyTeamSignatureCompleted(input: {
  inspectionId: string;
  plate: string;
  owner: string;
}): Promise<void> {
  if (!isReady()) return;
  const team = await listTeamWhatsAppPhones().catch(() => []);
  if (team.length === 0) return;
  const text = [
    "✅ *Peritaje firmado*",
    `Placa: ${input.plate || "—"}`,
    `Cliente: ${input.owner || "—"}`,
    "",
    `Ver: ${appUrl()}/inspection/${input.inspectionId}`,
  ].join("\n");
  for (const member of team) {
    safe(`team-signed to ${member.fullName}`, () => sendText(member.waPhone, text));
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
}): void {
  if (!isReady()) return;
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
  safe(`client-sign to ${input.clientPhone}`, () => sendText(input.clientPhone!, text));
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
}): void {
  if (!isReady()) return;
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
  safe(`client-pdf to ${input.clientPhone}`, () =>
    sendDocument(input.clientPhone!, input.pdfBuffer, filename, { caption }),
  );
}
