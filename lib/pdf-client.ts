"use client";

import { apiFetch } from "./client/api-client";
import { analyze } from "./rules-engine";
import type { InspectionData } from "./types";

export type PdfDownloadMode = "executive" | "detailed";

/** Un render de PDF puede tardar (Puppeteer + shrink de imágenes), pero sin
 *  tope el spinner se queda colgado para siempre cuando la red se cae a mitad
 *  de camino — que es justo lo que pasa en celular con mala señal. */
const PDF_TIMEOUT_MS = 90_000;

/** El POST a /api/pdf sube la inspección completa con las fotos en base64.
 *  Por encima de esto el server lo rechaza, así que avisamos antes de gastar
 *  varios minutos de subida en 4G para terminar en un error. */
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function plateSlug(data: InspectionData): string {
  return (data.vehicle.plate || "inspeccion").replace(/[^A-Z0-9]/gi, "");
}

async function errorFrom(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  // Los endpoints nuevos responden JSON {error}, los viejos texto plano.
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "string") {
      return new Error(parsed.error);
    }
  } catch {
    /* no era JSON: usamos el texto tal cual */
  }
  return new Error(text || `Error al generar PDF (${res.status})`);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PDF_TIMEOUT_MS);
  try {
    return await apiFetch(input, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "La generación del PDF tardó demasiado. Revisa tu conexión e inténtalo de nuevo.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Descarga el PDF oficial de un peritaje YA FINALIZADO.
 *
 * Usa GET y no manda cuerpo: los bytes ya están en el server (data/pdfs/) y
 * son el documento entregable, idéntico al sha256 registrado en DB. Este es el
 * camino que hay que usar siempre que el peritaje esté cerrado — el POST a
 * /api/pdf subiría la inspección entera con las fotos en base64 (20-40 MB)
 * para que el server la ignore y devuelva estos mismos bytes.
 */
export async function downloadStoredPdf(
  inspectionId: string,
  data: InspectionData,
): Promise<void> {
  const res = await fetchWithTimeout(
    `/api/inspections/${inspectionId}/pdf`,
    { method: "GET" },
  );
  if (!res.ok) throw await errorFrom(res);
  triggerDownload(await res.blob(), `peritaje-${plateSlug(data)}.pdf`);
}

/**
 * Genera un PDF on-the-fly mandando la inspección al server.
 *
 * Reservado para PREVISUALIZACIONES de borradores, que por definición no
 * existen en disco. Para peritajes finalizados usá `downloadStoredPdf`.
 */
export async function downloadInspectionPdf(
  data: InspectionData,
  mode: PdfDownloadMode = "executive",
  inspectionId?: string,
  opts?: { preview?: boolean },
): Promise<void> {
  const report = analyze(data);
  const preview = opts?.preview ?? false;
  const payload = JSON.stringify({
    data,
    report,
    mode,
    inspectionId,
    preview,
  });

  if (payload.length > MAX_UPLOAD_BYTES) {
    const mb = Math.round(payload.length / (1024 * 1024));
    throw new Error(
      `El peritaje pesa ${mb} MB y es demasiado grande para previsualizar. Finalízalo para generar el PDF oficial en el servidor.`,
    );
  }

  const res = await fetchWithTimeout("/api/pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });
  if (!res.ok) throw await errorFrom(res);

  const slug = plateSlug(data);
  triggerDownload(
    await res.blob(),
    preview ? `peritaje-${slug}-PREVISUALIZACION.pdf` : `peritaje-${slug}.pdf`,
  );
}
