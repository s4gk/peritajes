"use client";

import { apiFetch } from "@/lib/client/api-client";
import type { ExtractedFields } from "@/components/wizard/ownership-card-scanner";
import type { CardSide } from "@/lib/licenciaTransitoParser";

/**
 * Reconocimiento de la tarjeta de propiedad vía el servidor (proveedor de
 * visión, p.ej. GPT-4o), en contraste con `recognizeOwnershipCard` que corre
 * Tesseract 100% en el navegador.
 *
 * Sube el data URL de la foto (a COLOR — el modelo de visión rinde mucho mejor
 * con la imagen natural que con la versión grayscale/umbralizada que se le da a
 * Tesseract) al endpoint POST /api/ocr/ownership-card, que devuelve los campos
 * ya con la forma del formulario + la cara detectada.
 *
 * No corre nada localmente: cero wasm, cero lang pack. Requiere conexión. El
 * caller (scanner) cae a Tesseract local si esta llamada falla, para no dejar
 * sin OCR a un perito sin señal.
 */
export async function recognizeOwnershipCardRemote(
  imageDataUrl: string,
  opts?: { signal?: AbortSignal },
): Promise<{ fields: ExtractedFields; side: CardSide }> {
  // apiFetch inyecta el header x-csrf-token (double-submit cookie). Con fetch
  // crudo el server respondía 403 csrf_invalid y el OCR caía siempre a Tesseract.
  const res = await apiFetch("/api/ocr/ownership-card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl }),
    signal: opts?.signal,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      detail = body.detail || body.error || "";
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    throw new Error(`OCR servidor ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const data = (await res.json()) as {
    fields?: ExtractedFields;
    side?: CardSide;
  };
  return {
    fields: (data.fields ?? {}) as ExtractedFields,
    side: data.side ?? "unknown",
  };
}
