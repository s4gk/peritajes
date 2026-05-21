/**
 * Company-level branding used on the PDF header. The active source of truth
 * is the Postgres `company_config` table (see lib/server/company.ts), which
 * is read from the API route and passed into renderReportHtml as `branding`.
 *
 * The `getCompanyBranding()` helper here is a *fallback*: it reads env vars
 * (or el logo bundled en public/logo.jpg) para callers que no tocan la DB.
 */

import fs from "node:fs";
import path from "node:path";

export type CompanyBranding = {
  name: string;
  tagline: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** PNG/SVG/JPG embedded as data URL — must be self-contained for puppeteer headers. */
  logoDataUrl: string;
};

const PLACEHOLDER_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" rx="14" fill="#0f172a"/>
  <text x="50" y="62" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="800" fill="#ffffff" text-anchor="middle">V</text>
</svg>`;

const PLACEHOLDER_LOGO_DATA_URL =
  "data:image/svg+xml;base64," +
  Buffer.from(PLACEHOLDER_LOGO_SVG, "utf8").toString("base64");

/** Lee public/logo.jpg del disco y lo convierte a data URL base64. Se cachea
 *  al primer uso para evitar leer el archivo en cada PDF. Si el archivo no
 *  existe (o falla la lectura) caemos al placeholder SVG. */
let cachedBundledLogo: string | null = null;
function bundledLogoDataUrl(): string {
  if (cachedBundledLogo !== null) return cachedBundledLogo;
  try {
    const filePath = path.join(process.cwd(), "public", "logo.jpg");
    const buf = fs.readFileSync(filePath);
    cachedBundledLogo = `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    cachedBundledLogo = PLACEHOLDER_LOGO_DATA_URL;
  }
  return cachedBundledLogo;
}

export function getCompanyBranding(): CompanyBranding {
  return {
    name: process.env.COMPANY_NAME || "Peritajes del Llano",
    tagline: process.env.COMPANY_TAGLINE || "Peritaje vehicular profesional",
    nit: process.env.COMPANY_NIT || "NIT pendiente",
    address: process.env.COMPANY_ADDRESS || "Colombia",
    phone: process.env.COMPANY_PHONE || "Teléfono pendiente",
    email: process.env.COMPANY_EMAIL || "contacto pendiente",
    website: process.env.COMPANY_WEBSITE || "",
    logoDataUrl: process.env.COMPANY_LOGO_DATA_URL || bundledLogoDataUrl(),
  };
}

/**
 * Document number derived from plate + date. Es el *fallback* para borradores
 * y peritajes legacy que no tienen consecutivo oficial asignado todavía.
 * Formato: `PER-YYYYMMDD-PLATE`.
 *
 * Los peritajes finalizados llevan un consecutivo real (`PER-YYYY-####`)
 * asignado en `inspections.report_number`. Ver `formatReportNumber`.
 */
export function buildDocumentNumber(plate: string, date: string): string {
  const cleanPlate = (plate || "INSP").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const cleanDate = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  return `PER-${cleanDate}-${cleanPlate}`;
}

/**
 * Formato oficial del consecutivo: `PER-2026-0001`. Lo emite el server al
 * finalizar el peritaje, tomando el siguiente número del counter anual.
 */
export function formatReportNumber(year: number, sequence: number): string {
  return `PER-${year}-${String(sequence).padStart(4, "0")}`;
}
