"use client";

import { analyze } from "./rules-engine";
import type { InspectionData } from "./types";

export type PdfDownloadMode = "executive" | "detailed";

/**
 * Browser-only helper: POSTs the inspection to /api/pdf and triggers a
 * download of the resulting PDF. Defaults to "executive" mode (concise,
 * findings-only). Pass "detailed" for the full audit-trail format.
 */
export async function downloadInspectionPdf(
  data: InspectionData,
  mode: PdfDownloadMode = "executive",
): Promise<void> {
  const report = analyze(data);
  const res = await fetch("/api/pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, report, mode }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Error al generar PDF");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const plate = (data.vehicle.plate || "inspeccion").replace(/[^A-Z0-9]/gi, "");
  a.download = `peritaje-${plate}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
