import { test } from "vitest";
import { writeFileSync } from "node:fs";

import { renderReportHtml } from "@/lib/pdf-template";
import { analyze } from "@/lib/rules-engine";
import type { InspectionData } from "@/lib/types";
import { pristineInspection, setBodywork, setChassis } from "./fixtures";

/**
 * Generador de preview del CONCEPTO DE ASEGURABILIDAD (no es un test con
 * asserts — por eso `.gen.test.ts`, excluido de `npm run test`).
 *
 * Saca los dos PDFs de la portada tal como los vería un cliente institucional:
 * un vehículo sano dictaminado ASEGURABLE SÍ y uno con daño estructural
 * dictaminado ASEGURABLE NO. Corre con:
 *
 *   npx vitest run tests/_insurability-preview.gen.test.ts
 */
function baseInspection(): InspectionData {
  const data = pristineInspection();
  data.vehicle.owner = "Juan Pérez Gómez";
  data.vehicle.ownerDocument = "1.234.567.890";
  return data;
}

/** Vehículo sano → el perito dictamina ASEGURABLE SÍ. */
function approvedInspection(): InspectionData {
  const data = baseInspection();
  data.conclusion.generalCondition = "ESTÁNDAR";
  data.conclusion.insurability = "yes";
  data.conclusion.observations =
    "Vehículo en excelente estado general. Sin evidencia de reparaciones estructurales ni alteraciones de identificación.";
  data.conclusion.recommendation = "Apto para uso particular sin reservas.";
  return data;
}

/** Daño estructural confirmado → el perito dictamina ASEGURABLE NO. */
function rejectedInspection(): InspectionData {
  let data = baseInspection();
  data.vehicle.plate = "XYZ789";
  data = setChassis(data, "front_corner_l", "struct_deform_severe");
  data = setBodywork(data, "bumper_front", "repair_poor");
  data.conclusion.generalCondition = "ASEGURABILIDAD SUJETA A POLÍTICAS";
  data.conclusion.insurability = "no";
  data.conclusion.observations =
    "Se evidencia deformación estructural severa en punta de chasis delantera izquierda, compatible con colisión frontal de alta energía.";
  data.conclusion.recommendation =
    "No se recomienda para aseguramiento hasta enderezado en banco con certificación de medidas.";
  return data;
}

async function htmlToPdf(html: string, out: string) {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "22mm", bottom: "18mm", left: "14mm", right: "14mm" },
      timeout: 25_000,
    });
    writeFileSync(out, pdf);
    // eslint-disable-next-line no-console
    console.log(`PDF escrito en ${out} (${Math.round(pdf.length / 1024)} KB)`);
  } finally {
    await browser.close().catch(() => {});
  }
}

const OUT_DIR = process.env.PREVIEW_DIR || "/tmp";

test("preview ASEGURABLE SI", async () => {
  const data = approvedInspection();
  const html = renderReportHtml(data, analyze(data), { mode: "detailed" });
  await htmlToPdf(html, `${OUT_DIR}/asegurable-si.pdf`);
}, 120_000);

test("preview ASEGURABLE NO", async () => {
  const data = rejectedInspection();
  const html = renderReportHtml(data, analyze(data), { mode: "detailed" });
  await htmlToPdf(html, `${OUT_DIR}/asegurable-no.pdf`);
}, 120_000);
