import { buildDocumentNumber, getCompanyBranding, type CompanyBranding } from "./company";
import {
  BODYWORK_SECTION,
  CHASSIS_SECTION,
  COMFORT_SECTION,
  ELECTRICAL_SECTION,
  ENGINE_SECTION,
  LEAKS_SECTION,
  ROAD_TEST_SECTION,
  SUSPENSION_SECTION,
} from "./constants";
import { findOption } from "./findings-catalog";
import type { RiskReport } from "./rules-engine";
import type {
  InspectionData,
  InspectionEntry,
  InspectionSectionDef,
} from "./types";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function esc(v: string | number | undefined | null): string {
  if (v === undefined || v === null || v === "") return "—";
  return escapeHtml(String(v));
}

function fmtDate(date: string): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return date;
  }
}

function findingDisplay(value: string | undefined): { label: string; tone: string } {
  if (!value) return { label: "—", tone: "neutral" };
  const opt = findOption(value);
  return opt ? { label: opt.label, tone: opt.tone } : { label: value, tone: "neutral" };
}

function fuelLabel(v: string): string {
  const map: Record<string, string> = {
    gasoline: "Gasolina",
    diesel: "Diésel",
    hybrid: "Híbrido",
    electric: "Eléctrico",
    gas: "GNV",
  };
  return map[v] ?? "—";
}
function transmissionLabel(v: string): string {
  const map: Record<string, string> = {
    manual: "Manual",
    automatic: "Automática",
    cvt: "CVT",
    dct: "DCT",
  };
  return map[v] ?? "—";
}

function renderSectionTable(
  section: InspectionSectionDef,
  data: Record<string, InspectionEntry>,
): string {
  const rows = section.groups
    .flatMap((group) =>
      group.items.map((item) => {
        const entry = data?.[item.id];
        const { label, tone } = findingDisplay(entry?.status);
        const notes = entry?.notes ? escapeHtml(entry.notes) : "";
        const imgCount = entry?.images?.length ?? 0;
        return `
          <tr>
            <td class="group">${escapeHtml(group.label)}</td>
            <td class="item">${escapeHtml(item.label)}</td>
            <td><span class="pill pill-${tone}">${escapeHtml(label)}</span></td>
            <td class="notes">${notes}${imgCount > 0 ? ` <span class="imgcount">(${imgCount} 📷)</span>` : ""}</td>
          </tr>
        `;
      }),
    )
    .join("");

  return `
    <table class="section-table">
      <thead>
        <tr>
          <th style="width:22%">Grupo</th>
          <th style="width:30%">Ítem</th>
          <th style="width:22%">Hallazgo</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderSectionTableCompact(
  section: InspectionSectionDef,
  data: Record<string, InspectionEntry>,
): string {
  const showGroupHeader = section.groups.length > 1;
  const body = section.groups
    .map((group) => {
      const header = showGroupHeader
        ? `<tr class="grouprow"><td colspan="3">${escapeHtml(group.label)}</td></tr>`
        : "";
      const rows = group.items
        .map((item) => {
          const entry = data?.[item.id];
          const { label, tone } = findingDisplay(entry?.status);
          const notes = entry?.notes ? escapeHtml(entry.notes) : "";
          const imgCount = entry?.images?.length ?? 0;
          return `
            <tr>
              <td class="item">${escapeHtml(item.label)}</td>
              <td><span class="pill pill-${tone}">${escapeHtml(label)}</span></td>
              <td class="notes">${notes}${imgCount > 0 ? ` <span class="imgcount">${imgCount}📷</span>` : ""}</td>
            </tr>
          `;
        })
        .join("");
      return header + rows;
    })
    .join("");

  return `
    <table class="section-table compact">
      <thead>
        <tr>
          <th>Ítem</th>
          <th style="width:30%">Hallazgo</th>
          <th style="width:30%">Notas</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

/**
 * Executive section render: only items with hallazgos (warning/danger), each
 * with their photos inline. OK items are summarized in a single muted line so
 * the perito's audit trail stays visible without bloating the page.
 */
function renderSectionExecutive(
  title: string,
  section: InspectionSectionDef,
  data: Record<string, InspectionEntry>,
): string {
  const findings: {
    label: string;
    groupLabel: string;
    findingLabel: string;
    tone: "warning" | "danger";
    notes: string;
    images: { dataUrl: string }[];
  }[] = [];
  const okItems: string[] = [];

  for (const group of section.groups) {
    for (const item of group.items) {
      const entry = data?.[item.id];
      const opt = findOption(entry?.status);
      if (!opt) continue;
      if (opt.tone === "warning" || opt.tone === "danger") {
        findings.push({
          label: item.label,
          groupLabel: group.label,
          findingLabel: opt.label,
          tone: opt.tone,
          notes: entry?.notes ?? "",
          images: entry?.images ?? [],
        });
      } else {
        okItems.push(item.label);
      }
    }
  }

  if (findings.length === 0 && okItems.length === 0) {
    return `
      <section class="exec-section">
        <h2>${escapeHtml(title)}</h2>
        <p class="muted">Sin datos registrados.</p>
      </section>
    `;
  }

  const findingBlocks = findings
    .map((f) => {
      const photos = f.images.length
        ? `<div class="exec-finding-photos">${f.images
            .map(
              (img) =>
                `<img src="${img.dataUrl}" alt="${escapeHtml(f.label)}" />`,
            )
            .join("")}</div>`
        : "";
      const notes = f.notes
        ? `<div class="exec-finding-notes">${escapeHtml(f.notes)}</div>`
        : "";
      return `
        <div class="exec-finding ${f.tone}">
          <div class="exec-finding-head">
            <strong>${escapeHtml(f.label)}</strong>
            <span class="muted" style="font-size:8.5pt;">${escapeHtml(f.groupLabel)}</span>
            <span class="pill pill-${f.tone}">${escapeHtml(f.findingLabel)}</span>
          </div>
          ${notes}
          ${photos}
        </div>`;
    })
    .join("");

  let okBlock = "";
  if (okItems.length > 0) {
    okBlock = `
      <div class="exec-ok-summary">
        ✓ ${okItems.length} ${okItems.length === 1 ? "ítem" : "ítems"} en condición original
      </div>`;
  }

  return `
    <section class="exec-section">
      <h2>${escapeHtml(title)}</h2>
      ${findingBlocks}
      ${okBlock}
    </section>
  `;
}

function renderEvidence(
  title: string,
  section: InspectionSectionDef,
  data: Record<string, InspectionEntry>,
): string {
  const items: { label: string; dataUrl: string }[] = [];
  for (const group of section.groups) {
    for (const item of group.items) {
      const entry = data?.[item.id];
      if (!entry?.images || entry.images.length === 0) continue;
      for (const img of entry.images) {
        items.push({ label: `${group.label} — ${item.label}`, dataUrl: img.dataUrl });
      }
    }
  }
  if (items.length === 0) return "";
  return `
    <section class="evidence avoid-break">
      <h3>${escapeHtml(title)}</h3>
      <div class="image-grid">
        ${items
          .map(
            (i) => `
          <figure>
            <img src="${i.dataUrl}" alt="${escapeHtml(i.label)}" />
            <figcaption>${escapeHtml(i.label)}</figcaption>
          </figure>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderTires(data: InspectionData): string {
  const t = data.tires;
  const row = (k: string, v: number) => {
    const tone = v <= 25 ? "danger" : v <= 50 ? "warning" : "success";
    return `
      <tr>
        <td>${escapeHtml(k)}</td>
        <td class="num"><span class="pill pill-${tone}">${v}%</span></td>
      </tr>`;
  };
  const imagesBlock =
    t.images.length > 0
      ? `<div class="image-grid">${t.images
          .map(
            (img) =>
              `<figure><img src="${img.dataUrl}" alt="Llanta" /><figcaption>Llanta</figcaption></figure>`,
          )
          .join("")}</div>`
      : "";
  return `
    <table class="section-table small">
      <thead><tr><th>Posición</th><th class="num">Banda restante</th></tr></thead>
      <tbody>
        ${row("Delantera izquierda", t.frontLeft)}
        ${row("Delantera derecha", t.frontRight)}
        ${row("Trasera izquierda", t.rearLeft)}
        ${row("Trasera derecha", t.rearRight)}
        ${row("Repuesto", t.spare)}
      </tbody>
    </table>
    ${t.notes ? `<p class="muted">${escapeHtml(t.notes)}</p>` : ""}
    ${imagesBlock}
  `;
}

function renderAccessories(data: InspectionData): string {
  if (data.accessories.length === 0) {
    return `<p class="muted">Sin accesorios registrados.</p>`;
  }
  const rows = data.accessories
    .map((a) => {
      const { label, tone } = findingDisplay(a.status);
      return `
        <tr>
          <td>${escapeHtml(a.name)}</td>
          <td><span class="pill pill-${tone}">${escapeHtml(label)}</span></td>
          <td>${a.notes ? escapeHtml(a.notes) : ""}</td>
        </tr>`;
    })
    .join("");
  return `
    <table class="section-table">
      <thead>
        <tr><th>Accesorio</th><th>Estado</th><th>Notas</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function riskLabel(level: "low" | "medium" | "high"): string {
  return level === "low" ? "Bajo" : level === "medium" ? "Medio" : "Alto";
}
function riskTone(level: "low" | "medium" | "high"): string {
  return level === "low" ? "success" : level === "medium" ? "warning" : "danger";
}

export type PdfMode = "executive" | "detailed";

export function renderReportHtml(
  data: InspectionData,
  report: RiskReport,
  options?: { mode?: PdfMode; branding?: CompanyBranding },
): string {
  const mode: PdfMode = options?.mode ?? "executive";
  const v = data.vehicle;
  const brand = options?.branding ?? getCompanyBranding();
  const docNumber = buildDocumentNumber(v.plate, v.date);
  const sections: { title: string; def: InspectionSectionDef; data: Record<string, InspectionEntry> }[] = [
    { title: "Carrocería", def: BODYWORK_SECTION, data: data.bodywork },
    { title: "Chasis y estructura", def: CHASSIS_SECTION, data: data.chassis },
    { title: "Suspensión y dirección", def: SUSPENSION_SECTION, data: data.suspension },
    { title: "Motor", def: ENGINE_SECTION, data: data.engine },
    { title: "Sistema eléctrico", def: ELECTRICAL_SECTION, data: data.electrical },
    { title: "Fugas de fluidos", def: LEAKS_SECTION, data: data.leaks },
    { title: "Confort e interior", def: COMFORT_SECTION, data: data.comfort },
    { title: "Prueba de ruta", def: ROAD_TEST_SECTION, data: data.roadTest },
  ];

  const counters = report.counters;
  const findingsByLevel = {
    critical: report.findings.filter((f) => f.level === "critical"),
    warning: report.findings.filter((f) => f.level === "warning"),
    info: report.findings.filter((f) => f.level === "info"),
  };

  const rLevel = riskLabel(report.level);
  const rTone = riskTone(report.level);
  const conditionLabel = findingDisplay(data.conclusion.generalCondition).label;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Peritaje ${esc(v.plate)} — ${esc(v.make)} ${esc(v.model)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm 18mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Inter, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a;
    font-size: 10.5pt;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, h4 { margin: 0 0 6pt 0; color: #0f172a; }
  h1 { font-size: 22pt; letter-spacing: -0.3px; }
  h2 { font-size: 14pt; margin-top: 16pt; padding-bottom: 4pt; border-bottom: 1px solid #e2e8f0; }
  h3 { font-size: 11.5pt; margin-top: 10pt; }
  p { margin: 0 0 6pt 0; }
  .muted { color: #475569; font-size: 9.5pt; }

  .cover { page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; min-height: 245mm; padding-top: 0; }
  .cover .brand { font-size: 10pt; letter-spacing: 3px; text-transform: uppercase; color: #64748b; margin-top: 12mm; }
  .cover .title { font-size: 30pt; font-weight: 700; letter-spacing: -0.5px; margin-top: 8pt; }
  .cover .subtitle { color: #475569; font-size: 12pt; margin-top: 4pt; }
  .cover .ribbon { display: inline-block; padding: 6pt 10pt; border-radius: 6pt; font-weight: 600; margin-top: 10mm; }
  .vehicle-specs {
    margin-top: 12mm;
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 5mm 0;
  }
  .vehicle-specs .spec-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6mm;
    padding: 2.5mm 0;
  }
  .vehicle-specs .spec-row.full {
    grid-template-columns: 1fr;
  }
  .vehicle-specs .spec-cell {
    display: flex;
    flex-direction: column;
    gap: 1pt;
  }
  .vehicle-specs .label {
    font-size: 7.5pt;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 500;
  }
  .vehicle-specs .value {
    font-size: 10.5pt;
    font-weight: 500;
    color: #0f172a;
  }
  .vehicle-specs .value.mono {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 9.5pt;
    letter-spacing: 0.2px;
  }
  .cover .footer { border-top: 1px solid #e2e8f0; padding-top: 6mm; color: #64748b; font-size: 9pt; display: flex; justify-content: space-between; }

  /* Branded header on the cover page */
  .brand-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10pt;
    padding: 8pt 0;
    border-bottom: 2pt solid #0f172a;
    page-break-inside: avoid;
  }
  .brand-header .logo img { display: block; width: 48pt; height: 48pt; }
  .brand-header .company-name { font-size: 16pt; font-weight: 800; color: #0f172a; letter-spacing: 0.3px; }
  .brand-header .company-tagline { font-size: 9pt; color: #475569; margin-top: 1pt; }
  .brand-header .company-meta { font-size: 8.5pt; color: #475569; margin-top: 4pt; line-height: 1.4; }
  .brand-header .doc-badge { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.5; }
  .brand-header .doc-badge .doc-number { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 9pt; color: #0f172a; font-weight: 700; }

  /* Perito strip just below the brand header */
  .perito-strip {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10pt;
    padding: 6pt 0 0 0;
    margin-bottom: 8mm;
    font-size: 9.5pt;
  }
  .perito-strip .label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; }
  .perito-strip .value { font-weight: 600; margin-top: 1pt; }

  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6pt; }

  .stat { border: 1px solid #e2e8f0; border-radius: 6pt; padding: 6pt 8pt; background: #f8fafc; }
  .stat .label { font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat .value { font-size: 16pt; font-weight: 700; margin-top: 2pt; }
  .stat.success { background: #ecfdf5; border-color: #bbf7d0; color: #166534; }
  .stat.warning { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .stat.danger  { background: #fef2f2; border-color: #fecaca; color: #991b1b; }

  /* Compact risk hero (replaces the 8-stat grid in executive summary) */
  .risk-hero { display: flex; flex-wrap: wrap; align-items: center; gap: 8pt; margin-top: 8pt; font-size: 11pt; }
  .risk-hero .risk-pill { font-size: 10pt; padding: 3pt 9pt; }
  .risk-hero .risk-stat { font-weight: 600; color: #0f172a; }
  .risk-hero .risk-sep { color: #cbd5e1; }
  .counter-chips { display: flex; flex-wrap: wrap; gap: 4pt; margin-top: 6pt; }
  .counter-chip { font-size: 9pt; padding: 2pt 8pt; border-radius: 100pt; background: #f1f5f9; color: #334155; border: 1px solid transparent; }
  .counter-chip strong { font-weight: 700; }
  .counter-warning { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  .counter-danger  { background: #fef2f2; color: #991b1b; border-color: #fecaca; }

  .pill { display: inline-block; padding: 1.5pt 6pt; border-radius: 999px; font-size: 8.8pt; font-weight: 600; line-height: 1.4; }
  .pill-success { background: #dcfce7; color: #166534; }
  .pill-warning { background: #fef3c7; color: #92400e; }
  .pill-danger  { background: #fee2e2; color: #991b1b; }
  .pill-neutral { background: #e2e8f0; color: #334155; }

  .finding { display: grid; grid-template-columns: auto 1fr auto; gap: 8pt; align-items: center; padding: 6pt 8pt; border: 1px solid #e2e8f0; border-radius: 5pt; margin-bottom: 4pt; }
  .finding.critical { border-color: #fecaca; background: #fef2f2; }
  .finding.warning  { border-color: #fde68a; background: #fffbeb; }

  .section-table { width: 100%; border-collapse: collapse; margin-top: 4pt; font-size: 9.8pt; }
  .section-table th, .section-table td { border-bottom: 1px solid #e2e8f0; padding: 5pt 6pt; vertical-align: top; text-align: left; }
  .section-table th { background: #f1f5f9; font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.4px; color: #334155; }
  .section-table tr:last-child td { border-bottom: none; }
  .section-table td.group { color: #64748b; }
  .section-table td.notes { color: #334155; }
  .section-table .imgcount { color: #64748b; font-size: 8.5pt; }
  .section-table td.num, .section-table th.num { text-align: right; }
  .section-table.small td, .section-table.small th { padding: 4pt 6pt; }

  .section-table.compact { font-size: 8.6pt; margin-top: 3pt; }
  .section-table.compact th { font-size: 7.4pt; padding: 3pt 5pt; letter-spacing: 0.3px; }
  .section-table.compact td { padding: 2.8pt 5pt; }
  .section-table.compact .pill { font-size: 7.6pt; padding: 1pt 5pt; }
  .section-table .grouprow td {
    background: #f8fafc;
    font-weight: 700;
    font-size: 7.8pt;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #475569;
    padding: 3pt 6pt;
    border-bottom: 1px solid #e2e8f0;
  }

  .two-col-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8pt 12pt;
    margin-top: 6pt;
  }
  .two-col-grid > section {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .two-col-grid h2 {
    font-size: 11.5pt;
    margin-top: 4pt;
    padding-bottom: 3pt;
  }

  .image-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; margin-top: 6pt; }
  .image-grid figure { margin: 0; border: 1px solid #e2e8f0; border-radius: 4pt; overflow: hidden; background: #f8fafc; page-break-inside: avoid; }
  .image-grid img { width: 100%; height: 120pt; object-fit: cover; display: block; }
  .image-grid figcaption { padding: 3pt 5pt; font-size: 8pt; color: #475569; }

  section { page-break-inside: auto; }
  .avoid-break { page-break-inside: avoid; }
  .page-break { page-break-before: always; }

  .conclusion { border: 1px solid #e2e8f0; border-radius: 6pt; padding: 10pt; background: #f8fafc; margin-top: 8pt; }
  .conclusion h3 { margin-top: 0; }

  .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 18mm; }
  .sig-box { border-bottom: 1px solid #0f172a; height: 22mm; display: flex; align-items: flex-end; justify-content: center; }
  .sig-box img { max-height: 22mm; max-width: 100%; }
  .sig-label { font-size: 9pt; color: #334155; text-align: center; padding-top: 3pt; }

  /* Executive section blocks */
  .exec-section { padding: 6pt 0; page-break-inside: avoid; }
  .exec-section h2 { margin-bottom: 4pt; }
  .exec-finding {
    display: grid;
    grid-template-columns: 1fr;
    gap: 3pt;
    background: #ffffff;
    border-left: 2.5pt solid #d97706;
    padding: 3pt 0 3pt 8pt;
    margin-bottom: 3pt;
  }
  .exec-finding.danger { border-left-color: #b91c1c; }
  .exec-finding-head { display: flex; flex-wrap: wrap; align-items: center; gap: 5pt; font-size: 9.5pt; }
  .exec-finding-head strong { font-size: 10pt; }
  .exec-finding-notes { font-size: 9pt; color: #475569; }
  .exec-finding-photos { display: flex; flex-wrap: wrap; gap: 4pt; margin-top: 2pt; }
  .exec-finding-photos img { width: 70pt; height: 52pt; object-fit: cover; border-radius: 3pt; border: 1px solid #e2e8f0; }
  .exec-ok-summary {
    font-size: 9pt;
    color: #475569;
    padding: 2pt 0 2pt 8pt;
    border-left: 2.5pt solid #16a34a;
    margin-top: 4pt;
  }
</style>
</head>
<body>

  <!-- COVER -->
  <section class="cover">
    <div>
      <!-- BRANDED HEADER -->
      <div class="brand-header">
        <div class="logo">
          <img src="${brand.logoDataUrl}" alt="${escapeHtml(brand.name)}" />
        </div>
        <div>
          <div class="company-name">${escapeHtml(brand.name)}</div>
          <div class="company-tagline">${escapeHtml(brand.tagline)}</div>
          <div class="company-meta">
            ${escapeHtml(brand.nit)} · ${escapeHtml(brand.address)}<br/>
            ${escapeHtml(brand.email)} · ${escapeHtml(brand.phone)}${brand.website ? ` · ${escapeHtml(brand.website)}` : ""}
          </div>
        </div>
        <div class="doc-badge">
          <div class="doc-number">${escapeHtml(docNumber)}</div>
          <div>Emitido ${fmtDate(v.date)}</div>
        </div>
      </div>

      <!-- PERITO STRIP -->
      <div class="perito-strip">
        <div>
          <div class="label">Perito responsable</div>
          <div class="value">${esc(v.inspector)}</div>
          ${v.inspectorId ? `<div class="muted" style="font-size:8.5pt;margin-top:1pt;">Documento / licencia: ${esc(v.inspectorId)}</div>` : ""}
        </div>
        <div style="text-align:right;">
          <div class="label">Lugar de inspección</div>
          <div class="value">${esc(v.location)}</div>
        </div>
      </div>

      <div class="brand">Informe de Peritaje Vehicular</div>
      <div class="title">${esc(v.make)} ${esc(v.model)}</div>
      <div class="subtitle">Año ${esc(v.year)} · Placa ${esc(v.plate)}</div>
      <div class="ribbon pill-${rTone}">Nivel de riesgo: ${rLevel}</div>

      <div class="vehicle-specs">
        <div class="spec-row">
          <div class="spec-cell"><span class="label">Fecha</span><span class="value">${fmtDate(v.date)}</span></div>
          <div class="spec-cell"><span class="label">Kilometraje</span><span class="value">${esc(v.mileage)} km</span></div>
          <div class="spec-cell"><span class="label">Combustible</span><span class="value">${escapeHtml(fuelLabel(v.fuel))}</span></div>
          <div class="spec-cell"><span class="label">Transmisión</span><span class="value">${escapeHtml(transmissionLabel(v.transmission))}</span></div>
        </div>
        <div class="spec-row">
          <div class="spec-cell"><span class="label">Color</span><span class="value">${esc(v.color)}</span></div>
          <div class="spec-cell"><span class="label">Carrocería</span><span class="value">${esc(v.bodyType)}</span></div>
          <div class="spec-cell" style="grid-column: span 2;"><span class="label">VIN / Chasis</span><span class="value mono">${esc(v.vin)}</span></div>
        </div>
        <div class="spec-row full">
          <div class="spec-cell"><span class="label">Propietario</span><span class="value">${esc(v.owner)}</span></div>
        </div>
      </div>
    </div>

    <div class="footer">
      <span>${escapeHtml(brand.name)} · ${escapeHtml(docNumber)}</span>
      <span>Generado el ${new Date().toLocaleString("es-CO")}</span>
    </div>
  </section>

  <!-- EXECUTIVE SUMMARY -->
  <section class="avoid-break">
    <h2>Resumen ejecutivo</h2>
    <p><strong>${escapeHtml(report.headline)}</strong></p>
    <p class="muted">${escapeHtml(report.conditionSummary)}</p>

    <div class="risk-hero">
      <span class="pill pill-${rTone} risk-pill">Riesgo ${rLevel.toLowerCase()}</span>
      <span class="risk-stat">${report.findings.length} ${report.findings.length === 1 ? "hallazgo" : "hallazgos"}</span>
      <span class="risk-sep">·</span>
      <span class="risk-stat">Puntaje ${report.score}/100</span>
    </div>

    ${(() => {
      const chips: { label: string; value: number; tone: "warning" | "danger" }[] = [];
      if (counters.repainted > 0) chips.push({ label: "Repintados", value: counters.repainted, tone: "warning" });
      if (counters.repaired > 0) chips.push({ label: "Reparados", value: counters.repaired, tone: "warning" });
      if (counters.poorlyRepaired > 0) chips.push({ label: "Mal reparados", value: counters.poorlyRepaired, tone: "danger" });
      if (counters.structuralHits > 0) chips.push({ label: "Daño estructural", value: counters.structuralHits, tone: "danger" });
      if (counters.criticalLeaks > 0) chips.push({ label: "Fugas críticas", value: counters.criticalLeaks, tone: "danger" });
      if (counters.mechanicalBad > 0) chips.push({ label: "Mecánica falla", value: counters.mechanicalBad, tone: "warning" });
      if (counters.brakingIssues > 0) chips.push({ label: "Frenos", value: counters.brakingIssues, tone: "danger" });
      if (chips.length === 0) return "";
      return `<div class="counter-chips">${chips
        .map(
          (c) =>
            `<span class="counter-chip counter-${c.tone}">${escapeHtml(c.label)}: <strong>${c.value}</strong></span>`,
        )
        .join("")}</div>`;
    })()}
  </section>

  <section class="avoid-break">
    <h3>Alertas críticas</h3>
    ${
      findingsByLevel.critical.length === 0
        ? `<p class="muted">Sin alertas críticas.</p>`
        : findingsByLevel.critical
            .map(
              (f) => `
      <div class="finding critical">
        <span class="pill pill-danger">${escapeHtml(f.section)}</span>
        <div><strong>${escapeHtml(f.item)}</strong> — ${escapeHtml(f.message)}</div>
        <span></span>
      </div>`,
            )
            .join("")
    }

    <h3>Advertencias</h3>
    ${
      findingsByLevel.warning.length === 0
        ? `<p class="muted">Sin advertencias.</p>`
        : findingsByLevel.warning
            .map(
              (f) => `
      <div class="finding warning">
        <span class="pill pill-warning">${escapeHtml(f.section)}</span>
        <div><strong>${escapeHtml(f.item)}</strong> — ${escapeHtml(f.message)}</div>
        <span></span>
      </div>`,
            )
            .join("")
    }
  </section>

  <!-- DETAILED SECTIONS -->
  ${
    mode === "executive"
      ? `
  <section class="page-break">
    ${sections.map((s) => renderSectionExecutive(s.title, s.def, s.data)).join("")}
  </section>

  <!-- TIRES + ACCESSORIES -->
  <section class="avoid-break" style="margin-top:14pt;">
    <h2>Llantas</h2>
    ${renderTires(data)}
  </section>

  <section class="avoid-break" style="margin-top:14pt;">
    <h2>Accesorios</h2>
    ${renderAccessories(data)}
  </section>
  `
      : `
  <section class="page-break">
    <h2>${escapeHtml(sections[0].title)}</h2>
    ${renderSectionTable(sections[0].def, sections[0].data)}
  </section>

  <div class="two-col-grid">
    ${sections
      .slice(1)
      .map(
        (s) => `
      <section>
        <h2>${escapeHtml(s.title)}</h2>
        ${renderSectionTableCompact(s.def, s.data)}
      </section>`,
      )
      .join("")}
  </div>

  <!-- TIRES -->
  <section class="page-break">
    <h2>Llantas</h2>
    ${renderTires(data)}
  </section>

  <!-- ACCESSORIES -->
  <section class="avoid-break" style="margin-top:14pt;">
    <h2>Accesorios</h2>
    ${renderAccessories(data)}
  </section>

  <!-- EVIDENCE -->
  <section class="page-break">
    <h2>Evidencia fotográfica</h2>
    ${sections.map((s) => renderEvidence(s.title, s.def, s.data)).join("") || `<p class="muted">No se registraron fotografías.</p>`}
  </section>
  `
  }

  <!-- CONCLUSION -->
  <section class="page-break">
    <h2>Conclusión técnica</h2>
    <div class="conclusion">
      <h3>Condición general: ${escapeHtml(conditionLabel)}</h3>
      ${data.conclusion.observations ? `<p><strong>Observaciones:</strong><br/>${escapeHtml(data.conclusion.observations).replace(/\n/g, "<br/>")}</p>` : ""}
      ${data.conclusion.recommendation ? `<p><strong>Recomendación:</strong><br/>${escapeHtml(data.conclusion.recommendation).replace(/\n/g, "<br/>")}</p>` : ""}
    </div>

    <div class="sig-block">
      <div>
        <div class="sig-box">
          ${data.conclusion.inspectorSignature ? `<img src="${data.conclusion.inspectorSignature}" alt="Firma perito" />` : ""}
        </div>
        <div class="sig-label">Firma del perito<br/>${esc(v.inspector)}${v.inspectorId ? ` · ${esc(v.inspectorId)}` : ""}</div>
      </div>
      <div>
        <div class="sig-box">
          ${data.conclusion.clientSignature ? `<img src="${data.conclusion.clientSignature}" alt="Firma cliente" />` : ""}
        </div>
        <div class="sig-label">Firma del cliente<br/>${esc(v.owner)}</div>
      </div>
    </div>
  </section>

</body>
</html>`;
}
