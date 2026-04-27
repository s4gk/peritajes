import type { PanelCoord } from "./bodywork-coords";
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

export type BodyworkVisual = {
  /** Data URL or path to the rendered vehicle image. */
  imageSrc: string;
  /** Panel id → coord. Missing or null entries get no callout. */
  coords: Record<string, PanelCoord | null>;
};

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

type BodyworkCallout = {
  index: number;
  itemId: string;
  itemLabel: string;
  groupLabel: string;
  findingLabel: string;
  tone: "neutral" | "success" | "warning" | "danger";
  notes: string;
  coord: PanelCoord | null;
};

function collectBodyworkFindings(
  data: Record<string, InspectionEntry>,
  coords: Record<string, PanelCoord | null>,
): BodyworkCallout[] {
  const out: BodyworkCallout[] = [];
  let idx = 0;
  for (const group of BODYWORK_SECTION.groups) {
    for (const item of group.items) {
      const entry = data?.[item.id];
      const opt = findOption(entry?.status);
      if (!opt) continue;
      if (opt.tone !== "warning" && opt.tone !== "danger") continue;
      idx += 1;
      out.push({
        index: idx,
        itemId: item.id,
        itemLabel: item.label,
        groupLabel: group.label,
        findingLabel: opt.label,
        tone: opt.tone,
        notes: entry?.notes ?? "",
        coord: coords[item.id] ?? null,
      });
    }
  }
  return out;
}

function renderBodyworkVisual(
  data: Record<string, InspectionEntry>,
  visual: BodyworkVisual,
): string {
  const callouts = collectBodyworkFindings(data, visual.coords);
  const visibleCallouts = callouts.filter((c) => c.coord);
  const offImageCallouts = callouts.filter((c) => !c.coord);

  if (callouts.length === 0) {
    return `
      <div class="bodywork-visual">
        <figure class="bodywork-image">
          <img src="${escapeHtml(visual.imageSrc)}" alt="Vehículo" />
        </figure>
        <p class="muted" style="margin-top:6pt;">
          Sin hallazgos en carrocería — todos los paneles inspeccionados quedaron en condición original o equivalente.
        </p>
      </div>
    `;
  }

  const markers = visibleCallouts
    .map((c) => {
      const toneClass = c.tone === "danger" ? "danger" : "warning";
      return `
        <span class="callout callout-${toneClass}" style="left:${(c.coord!.x * 100).toFixed(2)}%; top:${(c.coord!.y * 100).toFixed(2)}%;">
          ${c.index}
        </span>`;
    })
    .join("");

  const tableRows = callouts
    .map((c) => {
      const toneClass = c.tone === "danger" ? "danger" : "warning";
      return `
        <tr>
          <td class="callout-cell"><span class="pill pill-${toneClass} num">${c.index}</span></td>
          <td><strong>${escapeHtml(c.itemLabel)}</strong><div class="muted" style="font-size:8.5pt;">${escapeHtml(c.groupLabel)}</div></td>
          <td><span class="pill pill-${toneClass}">${escapeHtml(c.findingLabel)}</span></td>
          <td class="notes">${c.notes ? escapeHtml(c.notes) : ""}</td>
        </tr>`;
    })
    .join("");

  const offNote =
    offImageCallouts.length > 0
      ? `<p class="muted" style="margin-top:4pt; font-size:8.5pt;">
          ${offImageCallouts.length} hallazgo${offImageCallouts.length === 1 ? "" : "s"} sin posición visible en esta vista (ver tabla).
        </p>`
      : "";

  return `
    <div class="bodywork-visual">
      <figure class="bodywork-image">
        <img src="${escapeHtml(visual.imageSrc)}" alt="Vehículo" />
        ${markers}
      </figure>
      ${offNote}
      <table class="section-table compact" style="margin-top:8pt;">
        <thead>
          <tr>
            <th style="width:36pt">#</th>
            <th>Panel</th>
            <th style="width:30%">Hallazgo</th>
            <th style="width:30%">Notas</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

export function renderReportHtml(
  data: InspectionData,
  report: RiskReport,
  options?: { bodyworkVisual?: BodyworkVisual | null },
): string {
  const bodyworkVisual = options?.bodyworkVisual ?? null;
  const v = data.vehicle;
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

  .cover { page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; min-height: 245mm; padding-top: 12mm; }
  .cover .brand { font-size: 10pt; letter-spacing: 3px; text-transform: uppercase; color: #64748b; }
  .cover .title { font-size: 30pt; font-weight: 700; letter-spacing: -0.5px; margin-top: 8pt; }
  .cover .subtitle { color: #475569; font-size: 12pt; margin-top: 4pt; }
  .cover .ribbon { display: inline-block; padding: 6pt 10pt; border-radius: 6pt; font-weight: 600; margin-top: 10mm; }
  .cover .meta { margin-top: 16mm; display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 14mm; }
  .cover .meta .label { font-size: 9pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; }
  .cover .meta .value { font-size: 13pt; font-weight: 600; margin-top: 1mm; }
  .cover .footer { border-top: 1px solid #e2e8f0; padding-top: 6mm; color: #64748b; font-size: 9pt; display: flex; justify-content: space-between; }

  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6pt; }

  .stat { border: 1px solid #e2e8f0; border-radius: 6pt; padding: 6pt 8pt; background: #f8fafc; }
  .stat .label { font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat .value { font-size: 16pt; font-weight: 700; margin-top: 2pt; }
  .stat.success { background: #ecfdf5; border-color: #bbf7d0; color: #166534; }
  .stat.warning { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .stat.danger  { background: #fef2f2; border-color: #fecaca; color: #991b1b; }

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

  /* Bodywork visual */
  .bodywork-visual { margin-top: 6pt; }
  .bodywork-image {
    margin: 0;
    position: relative;
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    overflow: hidden;
    background: #0f172a;
    page-break-inside: avoid;
  }
  .bodywork-image img { display: block; width: 100%; height: auto; }
  .callout {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 18pt;
    height: 18pt;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9pt;
    font-weight: 700;
    color: #ffffff;
    box-shadow: 0 0 0 2px #ffffff, 0 1pt 3pt rgba(0,0,0,0.4);
    line-height: 1;
  }
  .callout-warning { background: #d97706; }
  .callout-danger  { background: #b91c1c; }
  .pill.num { min-width: 16pt; text-align: center; padding: 1pt 5pt; }
</style>
</head>
<body>

  <!-- COVER -->
  <section class="cover">
    <div>
      <div class="brand">Informe de Peritaje Vehicular</div>
      <div class="title">${esc(v.make)} ${esc(v.model)}</div>
      <div class="subtitle">Año ${esc(v.year)} · Placa ${esc(v.plate)}</div>
      <div class="ribbon pill-${rTone}">Nivel de riesgo: ${rLevel}</div>

      <div class="meta">
        <div><div class="label">Fecha</div><div class="value">${fmtDate(v.date)}</div></div>
        <div><div class="label">Kilometraje</div><div class="value">${esc(v.mileage)} km</div></div>
        <div><div class="label">Color</div><div class="value">${esc(v.color)}</div></div>
        <div><div class="label">Carrocería</div><div class="value">${esc(v.bodyType)}</div></div>
        <div><div class="label">Combustible</div><div class="value">${escapeHtml(fuelLabel(v.fuel))}</div></div>
        <div><div class="label">Transmisión</div><div class="value">${escapeHtml(transmissionLabel(v.transmission))}</div></div>
        <div><div class="label">VIN</div><div class="value">${esc(v.vin)}</div></div>
        <div><div class="label">Propietario</div><div class="value">${esc(v.owner)}</div></div>
        <div><div class="label">Lugar</div><div class="value">${esc(v.location)}</div></div>
        <div><div class="label">Perito</div><div class="value">${esc(v.inspector)}${v.inspectorId ? ` · ${esc(v.inspectorId)}` : ""}</div></div>
      </div>
    </div>

    <div class="footer">
      <span>Informe generado automáticamente</span>
      <span>${new Date().toLocaleString("es-CO")}</span>
    </div>
  </section>

  <!-- EXECUTIVE SUMMARY -->
  <section class="avoid-break">
    <h2>Resumen ejecutivo</h2>
    <p><strong>${escapeHtml(report.headline)}</strong></p>
    <p class="muted">${escapeHtml(report.conditionSummary)}</p>

    <div class="grid-4" style="margin-top:8pt;">
      <div class="stat ${counters.repainted > 0 ? "warning" : ""}"><div class="label">Repintados</div><div class="value">${counters.repainted}</div></div>
      <div class="stat ${counters.repaired > 0 ? "warning" : ""}"><div class="label">Reparados</div><div class="value">${counters.repaired}</div></div>
      <div class="stat ${counters.poorlyRepaired > 0 ? "danger" : ""}"><div class="label">Mal reparados</div><div class="value">${counters.poorlyRepaired}</div></div>
      <div class="stat ${counters.structuralHits > 0 ? "danger" : ""}"><div class="label">Daño estructural</div><div class="value">${counters.structuralHits}</div></div>
      <div class="stat ${counters.criticalLeaks > 0 ? "danger" : ""}"><div class="label">Fugas críticas</div><div class="value">${counters.criticalLeaks}</div></div>
      <div class="stat ${counters.mechanicalBad > 0 ? "warning" : ""}"><div class="label">Mecánica falla</div><div class="value">${counters.mechanicalBad}</div></div>
      <div class="stat ${counters.brakingIssues > 0 ? "danger" : ""}"><div class="label">Frenos</div><div class="value">${counters.brakingIssues}</div></div>
      <div class="stat ${rTone}"><div class="label">Puntaje</div><div class="value">${report.score}</div></div>
    </div>
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
  <section class="page-break">
    <h2>${escapeHtml(sections[0].title)}</h2>
    ${
      bodyworkVisual
        ? renderBodyworkVisual(sections[0].data, bodyworkVisual)
        : renderSectionTable(sections[0].def, sections[0].data)
    }
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
