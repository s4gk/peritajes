import { NextResponse } from "next/server";

import { analyze, type RiskReport } from "@/lib/rules-engine";
import { renderReportHtml } from "@/lib/pdf-template";
import type { InspectionData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = {
  data: InspectionData;
  report?: RiskReport;
};

export async function POST(req: Request) {
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
  const html = renderReportHtml(body.data, report);

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
      margin: { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" },
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
