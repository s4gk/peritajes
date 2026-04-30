/**
 * Company-level branding used on the PDF header. The active source of truth
 * is the Postgres `company_config` table (see lib/server/company.ts), which
 * is read from the API route and passed into renderReportHtml as `branding`.
 *
 * The `getCompanyBranding()` helper here is a *fallback*: it reads env vars
 * (or a placeholder) for callers that can't reach the DB (e.g. unit tests
 * that render the template directly).
 */

export type CompanyBranding = {
  name: string;
  tagline: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** PNG/SVG embedded as data URL — must be self-contained for puppeteer headers. */
  logoDataUrl: string;
};

const PLACEHOLDER_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" rx="14" fill="#0f172a"/>
  <text x="50" y="62" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="800" fill="#ffffff" text-anchor="middle">V</text>
</svg>`;

const PLACEHOLDER_LOGO_DATA_URL =
  "data:image/svg+xml;base64," +
  Buffer.from(PLACEHOLDER_LOGO_SVG, "utf8").toString("base64");

export function getCompanyBranding(): CompanyBranding {
  return {
    name: process.env.COMPANY_NAME || "Peritaje del Llano",
    tagline: process.env.COMPANY_TAGLINE || "Peritaje vehicular profesional",
    nit: process.env.COMPANY_NIT || "NIT pendiente",
    address: process.env.COMPANY_ADDRESS || "Colombia",
    phone: process.env.COMPANY_PHONE || "Teléfono pendiente",
    email: process.env.COMPANY_EMAIL || "contacto pendiente",
    website: process.env.COMPANY_WEBSITE || "",
    logoDataUrl: process.env.COMPANY_LOGO_DATA_URL || PLACEHOLDER_LOGO_DATA_URL,
  };
}

/**
 * Stable document number derived from plate + date, so two peritajes for the
 * same plate on the same day collide intentionally (acts as an idempotency
 * hint). Format: `PER-YYYYMMDD-PLATE`.
 */
export function buildDocumentNumber(plate: string, date: string): string {
  const cleanPlate = (plate || "INSP").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const cleanDate = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  return `PER-${cleanDate}-${cleanPlate}`;
}
