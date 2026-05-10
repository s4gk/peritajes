import "server-only";

import QRCode from "qrcode";

/**
 * Genera un QR como data URL (PNG) para embeber en el PDF. Margen 0 y nivel
 * de corrección "M" porque el QR va impreso/escaneado en patios — los códigos
 * sucios necesitan algo de redundancia pero no tanta como "H" (que reduce
 * densidad útil).
 */
export async function generateQrDataUrl(text: string, opts?: { size?: number }): Promise<string> {
  const size = opts?.size ?? 220;
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: size,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}

/**
 * Arma la URL pública base del request entrante mirando los headers que
 * setean los reverse-proxies (x-forwarded-host/proto). Si nada está set,
 * cae al header host con https. Permite override por env PUBLIC_BASE_URL.
 */
export function buildPublicBaseUrl(req: Request): string {
  const fromEnv = process.env.PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const headers = req.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return "";
  const proto = headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
