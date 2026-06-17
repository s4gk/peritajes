import "server-only";

import { spawn as childProcessSpawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import path, { join as pathJoin } from "node:path";

import { buildDocumentNumber, getCompanyBranding } from "@/lib/company";
import { getCompanyConfig } from "@/lib/server/company";
import {
  buildWatermarkLogo,
  shrinkImageForPdf,
  shrinkImageList,
  shrinkSectionImages,
} from "@/lib/server/pdf-image-shrink";
import { generateQrDataUrl } from "@/lib/server/qr";
import { analyze, type RiskReport } from "@/lib/rules-engine";
import { renderReportHtml, type PdfMode } from "@/lib/pdf-template";
import type { InspectionData } from "@/lib/types";

/**
 * Recorre toda la data del peritaje y re-comprime cada foto a 200KB max
 * antes de meterla al HTML del PDF. Es la única optimización de peso que
 * realmente mueve la aguja: sin esto un peritaje con 30 fotos genera un
 * PDF de 9MB, con esto baja a 2-3MB.
 */
async function shrinkInspectionImages(data: InspectionData): Promise<InspectionData> {
  const [
    bodywork,
    chassis,
    suspension,
    engine,
    electrical,
    leaks,
    comfort,
    roadTest,
    tiresFindings,
    tiresImages,
    extraPhotos,
    mp_dfl,
    mp_drr,
    mp_ic,
    mp_cn,
    mp_en,
    mp_id,
    engineCompression,
    inspectorSig,
    clientSig,
  ] = await Promise.all([
    shrinkSectionImages(data.bodywork),
    shrinkSectionImages(data.chassis),
    shrinkSectionImages(data.suspension),
    shrinkSectionImages(data.engine),
    shrinkSectionImages(data.electrical),
    shrinkSectionImages(data.leaks),
    shrinkSectionImages(data.comfort),
    shrinkSectionImages(data.roadTest),
    shrinkSectionImages(data.tires.findings ?? {}),
    shrinkImageList(data.tires.images),
    shrinkImageList(data.extraPhotos),
    shrinkImageList(data.mandatoryPhotos.diagonalFrontLeft),
    shrinkImageList(data.mandatoryPhotos.diagonalRearRight),
    shrinkImageList(data.mandatoryPhotos.innerCabin),
    shrinkImageList(data.mandatoryPhotos.chassisNumber),
    shrinkImageList(data.mandatoryPhotos.engineNumber),
    shrinkImageList(data.mandatoryPhotos.idPlate),
    Promise.all(
      (data.engineCompression ?? []).map(async (c) => ({
        ...c,
        images: await shrinkImageList(c.images),
      })),
    ),
    data.conclusion?.inspectorSignature
      ? shrinkImageForPdf(data.conclusion.inspectorSignature)
      : Promise.resolve(data.conclusion?.inspectorSignature),
    data.conclusion?.clientSignature
      ? shrinkImageForPdf(data.conclusion.clientSignature)
      : Promise.resolve(data.conclusion?.clientSignature),
  ]);

  return {
    ...data,
    bodywork,
    chassis,
    suspension,
    engine,
    electrical,
    leaks,
    comfort,
    roadTest,
    engineCompression,
    tires: {
      ...data.tires,
      images: tiresImages,
      findings: tiresFindings,
    },
    extraPhotos,
    mandatoryPhotos: {
      diagonalFrontLeft: mp_dfl,
      diagonalRearRight: mp_drr,
      innerCabin: mp_ic,
      chassisNumber: mp_cn,
      engineNumber: mp_en,
      idPlate: mp_id,
    },
    conclusion: {
      ...data.conclusion,
      inspectorSignature: inspectorSig,
      clientSignature: clientSig,
    },
  };
}

/**
 * Genera el PDF del peritaje. Centraliza el flujo (puppeteer + branding +
 * firma estática + header) para que tanto /api/pdf (auth) como /r/[token]
 * (público con token) usen exactamente la misma salida.
 */

/**
 * Firma del perito en orden de preferencia:
 *   1. La que capturó el perito en este peritaje (`data.conclusion.inspectorSignature`).
 *   2. Firma genérica en disco `public/firma-perito.{png,jpg,jpeg}` — solo
 *      fallback para peritajes legacy que se finalizaron antes de que el
 *      wizard pidiera firma por inspección.
 */
let cachedFallbackSignature: string | null | undefined;
async function loadFallbackInspectorSignature(): Promise<string | null> {
  if (cachedFallbackSignature !== undefined) return cachedFallbackSignature;
  const dir = path.join(process.cwd(), "public");
  const candidates: { file: string; mime: string }[] = [
    { file: "firma-perito.png", mime: "image/png" },
    { file: "firma-perito.jpg", mime: "image/jpeg" },
    { file: "firma-perito.jpeg", mime: "image/jpeg" },
  ];
  for (const { file, mime } of candidates) {
    try {
      const buf = await fs.readFile(path.join(dir, file));
      cachedFallbackSignature = `data:${mime};base64,${buf.toString("base64")}`;
      return cachedFallbackSignature;
    } catch {
      // try next
    }
  }
  cachedFallbackSignature = null;
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
  /** Consecutivo oficial del peritaje (`PER-2026-0001`). Si viene, el PDF lo
   *  muestra en portada y en el header de cada página. Si no, cae a
   *  `buildDocumentNumber(placa, fecha)` — útil para previews de borradores. */
  reportNumber?: string | null;
  /** Org del peritaje. El branding (NIT, logo, teléfono) se toma de la
   *  config de esta org. Si es null, sale con defaults del platform. */
  orgId?: string | null;
  /** Previsualización de borrador (peritaje no finalizado). Estampa la marca
   *  de agua "PREVISUALIZACIÓN" para diferenciarlo del documento oficial. */
  preview?: boolean;
};

export type RenderedPdf = {
  buffer: Buffer;
  plateSlug: string;
  docNumber: string;
};

export async function renderInspectionPdf(
  opts: RenderInspectionPdfOptions,
): Promise<RenderedPdf> {
  // Antes de cualquier otro trabajo, re-comprimimos las fotos del peritaje
  // a JPEG 200KB max. Esto es lo que más impacta el peso del PDF — sin esto
  // un peritaje con 30 fotos llega a 9MB+; con esto baja a 2-3MB.
  const data = await shrinkInspectionImages(opts.data);
  const report = opts.report ?? analyze(data);
  const mode: PdfMode = opts.mode === "detailed" ? "detailed" : "executive";

  // Branding del PDF.
  //
  // Si el peritaje tiene orgId (caso normal multi-tenant), usamos SOLO los
  // datos de esa org — los campos vacíos quedan vacíos, NO caen al fallback
  // de Vestel. Sin esta regla, un cliente nuevo que aún no subió logo veía
  // el logo bundled de Peritajes del Llano en su PDF (rebranding accidental).
  //
  // El fallback (getCompanyBranding, que lee env COMPANY_* + public/logo.jpg)
  // solo aplica cuando NO hay orgId: previews de admin sin tenant, scripts,
  // peritajes legacy huérfanos.
  let branding;
  try {
    if (opts.orgId) {
      const cfg = await getCompanyConfig(opts.orgId);
      branding = {
        name: cfg.name?.trim() || "",
        tagline: cfg.tagline?.trim() || "",
        nit: cfg.nit?.trim() || "",
        address: cfg.address?.trim() || "",
        phone: cfg.phone?.trim() || "",
        email: cfg.email?.trim() || "",
        website: cfg.website?.trim() || "",
        logoDataUrl: cfg.logoDataUrl?.trim() || "",
      };
    } else {
      branding = getCompanyBranding();
    }
  } catch {
    branding = getCompanyBranding();
  }

  const inspectorSignatureDataUrl =
    data.conclusion?.inspectorSignature?.trim() ||
    (await loadFallbackInspectorSignature());
  // 2026-05: AI vehicle render desactivado por costo (Gemini Image es pago)
  // y por peso del PDF — agregaba 200-500KB sin valor proporcional. El
  // template tolera null y simplemente omite el bloque del render.
  const vehicleRenderDataUrl: string | null = null;
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
  // Logo de la org pre-padeado para la marca de agua de fondo (mosaico que
  // intercala herramientas + logo). Null si la org no tiene logo → cae al
  // mosaico de solo herramientas.
  const watermarkLogoDataUrl = await buildWatermarkLogo(branding.logoDataUrl);

  const html = renderReportHtml(data, report, {
    mode,
    branding,
    inspectorSignatureDataUrl,
    vehicleRenderDataUrl,
    verificationUrl,
    verificationQrDataUrl,
    reportNumber: opts.reportNumber ?? null,
    preview: opts.preview ?? false,
    watermarkLogoDataUrl,
  });

  const docNumber =
    opts.reportNumber ||
    buildDocumentNumber(data.vehicle.plate, data.vehicle.date);
  const plateLabel = data.vehicle.plate || "Sin placa";
  const plateSlug = (data.vehicle.plate || "inspeccion").replace(/[^A-Z0-9]/gi, "");

  const brandName = branding.name?.trim() || "Peritajes del Llano";
  // Datos de contacto para el footer: solo los campos que existan, separados
  // por "·". Vacío si la org no configuró ninguno (no dejamos separadores sueltos).
  const footerContact = [branding.address, branding.phone, branding.email]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join("  ·  ");
  const footerRight = branding.website?.trim() || branding.tagline?.trim() || "";

  const headerTemplate = `
    <div style="font-size:8pt; color:#475569; width:100%; padding:0 14mm; box-sizing:border-box;">
      <div style="border-bottom:0.75pt solid #e2e8f0; padding-bottom:4pt; display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:6pt;">
          <span style="font-weight:700; color:#0f172a;">${escapeHtmlForTemplate(brandName)}</span>
          <span style="color:#cbd5e1;">|</span>
          <span style="font-weight:600; color:#0f172a;">${escapeHtmlForTemplate(plateLabel)}</span>
          <span style="color:#94a3b8;">·</span>
          <span style="font-size:7.5pt;">${escapeHtmlForTemplate(docNumber)}</span>
        </div>
        <div>Pág. <span class="pageNumber"></span> / <span class="totalPages"></span></div>
      </div>
    </div>
  `;
  const footerTemplate = `
    <div style="font-size:7pt; color:#94a3b8; width:100%; padding:0 14mm; box-sizing:border-box;">
      <div style="border-top:0.75pt solid #e2e8f0; padding-top:4pt; display:flex; align-items:center; justify-content:space-between; gap:8pt;">
        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          <span style="font-weight:700; color:#475569;">${escapeHtmlForTemplate(brandName)}</span>${footerContact ? `<span style="color:#cbd5e1;">  ·  </span>${escapeHtmlForTemplate(footerContact)}` : ""}
        </span>
        ${footerRight ? `<span style="white-space:nowrap;">${escapeHtmlForTemplate(footerRight)}</span>` : ""}
      </div>
    </div>
  `;

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
      margin: { top: "22mm", bottom: "18mm", left: "14mm", right: "14mm" },
      timeout: PDF_TIMEOUT_MS,
    });
    const compressed = await compressPdfWithGhostscript(Buffer.from(pdf));
    return { buffer: compressed, plateSlug, docNumber };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Post-procesa el PDF de Puppeteer con Ghostscript para bajar el peso
 * drásticamente. Puppeteer rasteriza las imágenes JPEG embebidas (al
 * recorrerlas por Chrome para componer la página), entonces el PDF
 * resultante pesa 5-10x el peso de los JPG originales. Ghostscript con
 * `/ebook` (150 dpi, calidad media) re-comprime esas mismas imágenes
 * preservando legibilidad — en pruebas un peritaje de 8.7MB cayó a 354KB.
 *
 * Si Ghostscript no está instalado o el binario falla por cualquier razón,
 * devolvemos el PDF original sin tocar (graceful fallback). Mejor un PDF
 * pesado que ningún PDF.
 */
async function compressPdfWithGhostscript(input: Buffer): Promise<Buffer> {
  const tmpDir = osTmpdir();
  const stamp = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inPath = pathJoin(tmpDir, `perito-pdf-in-${stamp}.pdf`);
  const outPath = pathJoin(tmpDir, `perito-pdf-out-${stamp}.pdf`);
  try {
    await fs.writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const proc = childProcessSpawn(
        "gs",
        [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.5",
          // /ebook = 150 dpi, calidad media-alta. Más balanceado que /screen
          // (72dpi, demasiado bajo para zoom en fotos de daño) y mucho más
          // chico que /printer (300dpi, ya no aporta vs el rasterizado de
          // Chrome).
          "-dPDFSETTINGS=/ebook",
          "-dNOPAUSE",
          "-dQUIET",
          "-dBATCH",
          `-sOutputFile=${outPath}`,
          inPath,
        ],
        { stdio: "ignore" },
      );
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ghostscript exit ${code}`));
      });
    });
    const out = await fs.readFile(outPath);
    // Sanidad: si por algún motivo gs devuelve más grande, mejor el original.
    if (out.byteLength >= input.byteLength) return input;
    return out;
  } catch (err) {
    console.warn(
      "[pdf] ghostscript compress falló, usando PDF original:",
      (err as Error).message,
    );
    return input;
  } finally {
    await Promise.all([
      fs.unlink(inPath).catch(() => {}),
      fs.unlink(outPath).catch(() => {}),
    ]);
  }
}
