import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { buildDocumentNumber, getCompanyBranding } from "@/lib/company";
import { getCompanyConfig } from "@/lib/server/company";
import { getOrGenerateVehicleRender } from "@/lib/server/gemini-image";
import { generateQrDataUrl } from "@/lib/server/qr";
import { analyze, type RiskReport } from "@/lib/rules-engine";
import { renderReportHtml, type PdfMode } from "@/lib/pdf-template";
import type { InspectionData } from "@/lib/types";

/**
 * Genera el PDF del peritaje. Centraliza el flujo (puppeteer + branding +
 * firma estática + header) para que tanto /api/pdf (auth) como /r/[token]
 * (público con token) usen exactamente la misma salida.
 */

let cachedSignatureDataUrl: string | null | undefined;
async function loadInspectorSignature(): Promise<string | null> {
  if (cachedSignatureDataUrl !== undefined) return cachedSignatureDataUrl;
  const dir = path.join(process.cwd(), "public");
  const candidates: { file: string; mime: string }[] = [
    { file: "firma-perito.png", mime: "image/png" },
    { file: "firma-perito.jpg", mime: "image/jpeg" },
    { file: "firma-perito.jpeg", mime: "image/jpeg" },
  ];
  for (const { file, mime } of candidates) {
    try {
      const buf = await fs.readFile(path.join(dir, file));
      cachedSignatureDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      return cachedSignatureDataUrl;
    } catch {
      // try next
    }
  }
  cachedSignatureDataUrl = null;
  return null;
}

function escapeHtmlForTemplate(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type RenderInspectionPdfOptions = {
  data: InspectionData;
  report?: RiskReport;
  mode?: PdfMode;
  /** URL pública del peritaje (e.g. https://app/r/xyz). Si está set, el PDF
   *  embebe un QR + watermark de verificación. */
  verificationUrl?: string | null;
};

export type RenderedPdf = {
  buffer: Buffer;
  plateSlug: string;
  docNumber: string;
};

export async function renderInspectionPdf(
  opts: RenderInspectionPdfOptions,
): Promise<RenderedPdf> {
  const { data } = opts;
  const report = opts.report ?? analyze(data);
  const mode: PdfMode = opts.mode === "detailed" ? "detailed" : "executive";

  const fallback = getCompanyBranding();
  let branding = fallback;
  try {
    const cfg = await getCompanyConfig();
    branding = {
      name: cfg.name?.trim() || fallback.name,
      tagline: cfg.tagline?.trim() || fallback.tagline,
      nit: cfg.nit?.trim() || fallback.nit,
      address: cfg.address?.trim() || fallback.address,
      phone: cfg.phone?.trim() || fallback.phone,
      email: cfg.email?.trim() || fallback.email,
      website: cfg.website?.trim() || fallback.website,
      logoDataUrl: cfg.logoDataUrl?.trim() || fallback.logoDataUrl,
    };
  } catch {
    // DB unavailable — fallback already set.
  }

  const inspectorSignatureDataUrl = await loadInspectorSignature();
  const vehicleRenderDataUrl = await getOrGenerateVehicleRender({
    make: data.vehicle.make,
    model: data.vehicle.model,
    year: data.vehicle.year,
    bodyType: data.vehicle.bodyType,
  });
  const verificationUrl = opts.verificationUrl ?? null;
  let verificationQrDataUrl: string | null = null;
  if (verificationUrl) {
    try {
      verificationQrDataUrl = await generateQrDataUrl(verificationUrl);
    } catch {
      // Si falla la generación del QR no abortamos el PDF — sale sin watermark.
      verificationQrDataUrl = null;
    }
  }
  const html = renderReportHtml(data, report, {
    mode,
    branding,
    inspectorSignatureDataUrl,
    vehicleRenderDataUrl,
    verificationUrl,
    verificationQrDataUrl,
  });

  const docNumber = buildDocumentNumber(data.vehicle.plate, data.vehicle.date);
  const plateLabel = data.vehicle.plate || "Sin placa";
  const plateSlug = (data.vehicle.plate || "inspeccion").replace(/[^A-Z0-9]/gi, "");

  const headerTemplate = `
    <div style="font-size:8pt; color:#475569; width:100%; padding:0 14mm; display:flex; align-items:center; justify-content:space-between;">
      <div style="display:flex; align-items:center; gap:6pt;">
        <span style="font-weight:700; color:#0f172a;">${escapeHtmlForTemplate(plateLabel)}</span>
        <span style="color:#94a3b8;">·</span>
        <span style="font-size:7.5pt;">${escapeHtmlForTemplate(docNumber)}</span>
      </div>
      <div>Pág. <span class="pageNumber"></span> / <span class="totalPages"></span></div>
    </div>
  `;
  const footerTemplate = `<div></div>`;

  // Topes para que un recurso lento (Gemini, fuente remota) no cuelgue el
  // request hasta el `maxDuration: 60` y devuelva 504 sin contexto. Mejor
  // fallar rápido y mostrar mensaje claro arriba.
  const SET_CONTENT_TIMEOUT_MS = 30_000;
  const PDF_TIMEOUT_MS = 25_000;

  let browser: import("puppeteer").Browser | undefined;
  try {
    const puppeteer = (await import("puppeteer")).default;
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(SET_CONTENT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(SET_CONTENT_TIMEOUT_MS);
    try {
      await page.setContent(html, {
        waitUntil: "networkidle0",
        timeout: SET_CONTENT_TIMEOUT_MS,
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "TimeoutError") {
        // Reintento con criterio más laxo: si los recursos remotos no resuelven
        // a tiempo, igual queremos un PDF con lo que cargó el DOM principal.
        await page.setContent(html, {
          waitUntil: "domcontentloaded",
          timeout: SET_CONTENT_TIMEOUT_MS,
        });
      } else {
        throw err;
      }
    }
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: "22mm", bottom: "16mm", left: "14mm", right: "14mm" },
      timeout: PDF_TIMEOUT_MS,
    });
    return { buffer: Buffer.from(pdf), plateSlug, docNumber };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
