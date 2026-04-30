import { NextResponse } from "next/server";

import { buildDocumentNumber, getCompanyBranding } from "@/lib/company";
import { requireUser } from "@/lib/server/auth";
import { getCompanyConfig } from "@/lib/server/company";
import { analyze, type RiskReport } from "@/lib/rules-engine";
import { renderReportHtml, type PdfMode } from "@/lib/pdf-template";
import type { InspectionData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = {
  data: InspectionData;
  report?: RiskReport;
  mode?: PdfMode;
};

function escapeHtmlForTemplate(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(req: Request) {
  try {
    await requireUser();
  } catch {
    return new NextResponse("No autenticado", { status: 401 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return new NextResponse("Cuerpo inválido", { status: 400 });
  }

  if (!body?.data?.vehicle) {
    return new NextResponse("Datos de inspección faltantes", { status: 400 });
  }

  const report = body.report ?? analyze(body.data);
  const mode: PdfMode = body.mode === "detailed" ? "detailed" : "executive";
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
  const html = renderReportHtml(body.data, report, { mode, branding });

  const docNumber = buildDocumentNumber(body.data.vehicle.plate, body.data.vehicle.date);
  const plateLabel = body.data.vehicle.plate || "Sin placa";

  const headerTemplate = `
    <div style="font-size:8pt; color:#475569; width:100%; padding:0 14mm; display:flex; align-items:center; justify-content:space-between;">
      <div style="display:flex; align-items:center; gap:6pt;">
        <span style="font-weight:700; color:#0f172a;">${escapeHtmlForTemplate(plateLabel)}</span>
        <span style="color:#94a3b8;">·</span>
        <span style="font-family:ui-monospace,Menlo,Consolas,monospace; font-size:7.5pt;">${escapeHtmlForTemplate(docNumber)}</span>
      </div>
      <div>Pág. <span class="pageNumber"></span> / <span class="totalPages"></span></div>
    </div>
  `;

  const footerTemplate = `<div></div>`;

  let browser: import("puppeteer").Browser | undefined;
  try {
    const puppeteer = (await import("puppeteer")).default;
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: "22mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });

    const plate = (body.data.vehicle.plate || "inspeccion").replace(/[^A-Z0-9]/gi, "");
    const pdfBuffer = Buffer.from(pdf);
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="peritaje-${plate}.pdf"`,
        "cache-control": "no-store",
        "content-length": String(pdfBuffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return new NextResponse(`Error al generar PDF: ${message}`, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
