import { buildDocumentNumber, getCompanyBranding, type CompanyBranding } from "./company";
import {
  BODYWORK_SECTION,
  CHASSIS_SECTION,
  COMFORT_SECTION,
  ELECTRICAL_SECTION,
  ENGINE_SECTION,
  LEAKS_SECTION,
  PERITAJE_KINDS,
  ROAD_TEST_SECTION,
  stepsForKind,
  SUSPENSION_SECTION,
  type StepId,
} from "./constants";
import { findOption } from "./findings-catalog";
import { computeHealth, type HealthReport, type RiskReport, type SectionHealth } from "./rules-engine";
import type {
  InspectionData,
  InspectionEntry,
  InspectionSectionDef,
} from "./types";
import { titleCase } from "./verifik/mappings";
import type { RuntSoat, RuntTecnoMecanica, VerifikSnapshot } from "./verifik/types";

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

function formatPlate(p: string | undefined): string {
  if (!p) return "—";
  const clean = p.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (/^[A-Z]{3}\d{3}$/.test(clean)) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  if (/^[A-Z]{3}\d{2}[A-Z]$/.test(clean)) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  return clean || p;
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

function parseRuntDate(s: string | undefined): Date | null {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mm, y] = m;
  const dt = new Date(Number(y), Number(mm) - 1, Number(d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function fmtRuntDate(s: string | undefined): string {
  const dt = parseRuntDate(s);
  if (!dt) return s ?? "—";
  return dt.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

type StatusTone = "success" | "warning" | "danger" | "muted";

function pickActiveSoat(soats: RuntSoat[] | undefined): RuntSoat | null {
  if (!soats || soats.length === 0) return null;
  return [...soats].sort((a, b) => {
    const da = parseRuntDate(a.fechaVencimiento)?.getTime() ?? 0;
    const db = parseRuntDate(b.fechaVencimiento)?.getTime() ?? 0;
    return db - da;
  })[0];
}

function soatStatus(soat: RuntSoat): { label: string; tone: StatusTone } {
  const exp = parseRuntDate(soat.fechaVencimiento);
  if (!exp) return { label: soat.estado || "Sin estado", tone: "warning" };
  const now = Date.now();
  if (exp.getTime() < now) return { label: "Vencido", tone: "danger" };
  const daysLeft = Math.floor((exp.getTime() - now) / 86_400_000);
  if (daysLeft <= 30) return { label: "Por vencer", tone: "warning" };
  return { label: "Vigente", tone: "success" };
}

function rtmStatus(rtm: RuntTecnoMecanica | undefined): { label: string; tone: StatusTone } {
  const v = (rtm?.vigente ?? "").trim().toUpperCase();
  if (!v) return { label: "Sin información", tone: "muted" };
  if (v === "SI" || v === "VIGENTE") return { label: "Vigente", tone: "success" };
  if (v === "NO" || v === "VENCIDA") return { label: "No vigente", tone: "danger" };
  if (v === "NO APLICA") return { label: "No aplica", tone: "muted" };
  const dt = parseRuntDate(v);
  if (dt) {
    return dt.getTime() < Date.now()
      ? { label: "Vencida", tone: "danger" }
      : { label: "Vigente", tone: "success" };
  }
  return { label: titleCase(v), tone: "warning" };
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

function scoreTone(pct: number): "success" | "warning" | "danger" {
  if (pct >= 80) return "success";
  if (pct >= 60) return "warning";
  return "danger";
}

function tierLabel(pct: number | null): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  if (pct === null) return { label: "Sin inspeccionar", tone: "muted" };
  if (pct >= 80) return { label: "Óptimo", tone: "success" };
  if (pct >= 60) return { label: "Aceptable", tone: "warning" };
  return { label: "Deficiente", tone: "danger" };
}

function renderProgressRow(
  stats: SectionHealth,
  tone: "success" | "warning" | "danger" | "muted",
  title: string,
  tierText: string,
): string {
  const fill = stats.healthPct === null ? 0 : Math.max(0, Math.min(100, stats.healthPct));
  const pctText = stats.healthPct === null ? "—" : `${stats.healthPct}%`;
  const itemsLabel = stats.inspected === 1 ? "1 ítem inspeccionado" : `${stats.inspected} ítems inspeccionados`;
  const statChips: string[] = [];
  if (stats.inspected === 0) {
    statChips.push(`<span class="stat-meta">Sección no evaluada</span>`);
  } else {
    if (stats.ok > 0)
      statChips.push(
        `<span class="stat-chip ok"><span class="stat-dot"></span><span class="stat-count">${stats.ok}</span> sin novedad</span>`,
      );
    if (stats.warning > 0)
      statChips.push(
        `<span class="stat-chip warn"><span class="stat-dot"></span><span class="stat-count">${stats.warning}</span> ${stats.warning === 1 ? "advertencia" : "advertencias"}</span>`,
      );
    if (stats.danger > 0)
      statChips.push(
        `<span class="stat-chip danger"><span class="stat-dot"></span><span class="stat-count">${stats.danger}</span> ${stats.danger === 1 ? "crítico" : "críticos"}</span>`,
      );
    statChips.push(`<span class="stat-sep">·</span><span class="stat-meta">${itemsLabel}</span>`);
  }
  return `
    <div class="prog-row">
      <div class="prog-row-main">
        <div class="prog-name">${escapeHtml(title)}:</div>
        <div class="prog-bar"><div class="prog-fill tone-${tone}" style="width:${fill.toFixed(2)}%"></div></div>
        <span class="prog-pct tone-${tone}">${pctText}</span>
        <span class="prog-tier tone-${tone}">${escapeHtml(tierText)}</span>
      </div>
      <div class="prog-stats">${statChips.join("")}</div>
    </div>
  `;
}

function renderSummaryBars(
  health: HealthReport,
  rows: { key: string; title: string }[],
  options?: { heading?: string; compact?: boolean },
): string {
  const validRows = rows
    .map((r) => ({ ...r, stats: health.bySection[r.key] }))
    .filter((r) => r.stats);
  if (validRows.length === 0) return "";
  const heading = options?.heading
    ? options.compact
      ? `<div class="summary-bars-label">${escapeHtml(options.heading)}</div>`
      : `<h2>${escapeHtml(options.heading)}</h2>`
    : "";
  const globalBlock = health.global.healthPct === null
    ? ""
    : `
      <div class="summary-global tone-${scoreTone(health.global.healthPct)}">
        <div class="sg-text">
          <div class="sg-label">Estado general del vehículo</div>
          <div class="sg-meta">${health.global.inspected} ítem${health.global.inspected === 1 ? "" : "s"} inspeccionado${health.global.inspected === 1 ? "" : "s"} · ponderado por severidad del catálogo</div>
        </div>
        <div class="sg-value">${health.global.healthPct}%</div>
      </div>`;
  return `
    <section style="margin-top:${options?.compact ? "6mm" : "14pt"};">
      ${heading}
      ${globalBlock}
      <div class="summary-rows">
        ${validRows
          .map(({ title, stats }) => {
            const tier = tierLabel(stats.healthPct);
            return renderProgressRow(stats, tier.tone, title, tier.label);
          })
          .join("")}
      </div>
    </section>
  `;
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
    <section class="evidence">
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

function renderLegalAdmin(snapshot: VerifikSnapshot | undefined): string {
  const runt = snapshot?.runt?.data;
  if (!runt) return "";
  const ig = runt.informacionGeneral;

  const activeSoat = pickActiveSoat(runt.soat);
  const soatCard = activeSoat
    ? (() => {
        const st = soatStatus(activeSoat);
        const entity = activeSoat.entidadExpideSoat
          ? titleCase(activeSoat.entidadExpideSoat)
          : "";
        return `
          <div class="legal-card tone-${st.tone}">
            <span class="legal-label">SOAT</span>
            <span class="legal-status tone-${st.tone}">${escapeHtml(st.label)}</span>
            <span class="legal-meta">Vence ${escapeHtml(fmtRuntDate(activeSoat.fechaVencimiento))}${entity ? `<br/>${escapeHtml(entity)}` : ""}</span>
          </div>`;
      })()
    : `<div class="legal-card tone-muted">
         <span class="legal-label">SOAT</span>
         <span class="legal-status tone-muted">Sin póliza</span>
         <span class="legal-meta">No registrada en RUNT</span>
       </div>`;

  const tecno = runt.tecnoMecanica?.[0];
  const rtm = rtmStatus(tecno);
  const rtmCard = `
    <div class="legal-card tone-${rtm.tone}">
      <span class="legal-label">Tecnomecánica</span>
      <span class="legal-status tone-${rtm.tone}">${escapeHtml(rtm.label)}</span>
    </div>`;

  const prendasYes = (ig.prendas ?? "").trim().toUpperCase() === "SI";
  const gravamenesYes = (ig.tieneGravamenes ?? "").trim().toUpperCase() === "SI";
  const restrictionsTone: StatusTone = prendasYes || gravamenesYes ? "danger" : "success";
  const restrictionsLabel = prendasYes || gravamenesYes ? "Con restricciones" : "Sin restricciones";
  const restrictionsCard = `
    <div class="legal-card tone-${restrictionsTone}">
      <span class="legal-label">Prendas / gravámenes</span>
      <span class="legal-status tone-${restrictionsTone}">${escapeHtml(restrictionsLabel)}</span>
      <span class="legal-meta">Prendas: ${prendasYes ? "Sí" : "No"} · Gravámenes: ${gravamenesYes ? "Sí" : "No"}</span>
    </div>`;

  const metaItems: string[] = [];
  if (ig.tipoServicio)
    metaItems.push(
      `<span><span class="meta-key">Servicio:</span> ${escapeHtml(titleCase(ig.tipoServicio))}</span>`,
    );
  if (ig.fechaMatricula)
    metaItems.push(
      `<span><span class="meta-key">Matrícula:</span> ${escapeHtml(fmtRuntDate(ig.fechaMatricula))}</span>`,
    );
  if (ig.organismoTransito)
    metaItems.push(
      `<span><span class="meta-key">Organismo:</span> ${escapeHtml(titleCase(ig.organismoTransito))}</span>`,
    );
  if (ig.estadoDelVehiculo)
    metaItems.push(
      `<span><span class="meta-key">Estado:</span> ${escapeHtml(titleCase(ig.estadoDelVehiculo))}</span>`,
    );

  const queriedAt = snapshot?.queriedAt
    ? new Date(snapshot.queriedAt).toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "";

  return `
    <div class="spec-group legal-group">
      <div class="spec-group-title"><span>Estado legal y administrativo</span></div>
      <div class="legal-cards">
        ${soatCard}
        ${rtmCard}
        ${restrictionsCard}
      </div>
      ${metaItems.length > 0 ? `<div class="legal-meta-row">${metaItems.join("")}</div>` : ""}
      ${queriedAt ? `<div class="legal-source">Datos oficiales del RUNT consultados el ${escapeHtml(queriedAt)}</div>` : ""}
    </div>
  `;
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
  const kindDef = PERITAJE_KINDS[data.kind] ?? PERITAJE_KINDS.complete;
  const activeStepIds = new Set(stepsForKind(data.kind));
  const allSections: {
    stepId: StepId;
    title: string;
    def: InspectionSectionDef;
    data: Record<string, InspectionEntry>;
  }[] = [
    { stepId: "bodywork", title: "Carrocería", def: BODYWORK_SECTION, data: data.bodywork },
    { stepId: "chassis", title: "Chasis y estructura", def: CHASSIS_SECTION, data: data.chassis },
    { stepId: "suspension", title: "Suspensión y dirección", def: SUSPENSION_SECTION, data: data.suspension },
    { stepId: "engine", title: "Motor", def: ENGINE_SECTION, data: data.engine },
    { stepId: "electrical", title: "Sistema eléctrico", def: ELECTRICAL_SECTION, data: data.electrical },
    { stepId: "leaks", title: "Fugas de fluidos", def: LEAKS_SECTION, data: data.leaks },
    { stepId: "comfort", title: "Confort e interior", def: COMFORT_SECTION, data: data.comfort },
    { stepId: "roadTest", title: "Prueba de ruta", def: ROAD_TEST_SECTION, data: data.roadTest },
  ];
  const sections = allSections.filter((s) => activeStepIds.has(s.stepId));
  const showTires = activeStepIds.has("tires");
  const showAccessories = activeStepIds.has("accessories");

  const health = computeHealth(data);
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
  /* Vehicle hero: license-plate visual + vehicle info + risk pill */
  .vehicle-hero {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 14pt;
    align-items: center;
    margin-top: 8mm;
    padding: 4pt 0;
  }
  .plate-frame {
    background: #FCD34D;
    border: 1.2pt solid #0f172a;
    border-radius: 4pt;
    overflow: hidden;
    text-align: center;
    display: inline-block;
    box-shadow: 1pt 1pt 0 #0f172a;
    min-width: 110pt;
  }
  .plate-band {
    background: #1e3a8a;
    color: #ffffff;
    font-size: 5pt;
    font-weight: 700;
    letter-spacing: 1.6pt;
    padding: 1.5pt 0 1.8pt;
  }
  .plate-number {
    font-size: 22pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: 2.2pt;
    line-height: 1;
    padding: 6pt 11pt 8pt;
  }
  .vehicle-info { display: flex; flex-direction: column; gap: 1pt; }
  .vehicle-info .kind-label {
    font-size: 7.8pt;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 600;
  }
  .vehicle-info .vehicle-name {
    font-size: 18pt;
    font-weight: 800;
    letter-spacing: -0.3px;
    color: #0f172a;
    line-height: 1.05;
    margin-top: 2pt;
  }
  .vehicle-info .vehicle-meta {
    font-size: 9.5pt;
    color: #475569;
    margin-top: 3pt;
  }
  .risk-corner { align-self: center; text-align: right; }
  .risk-corner .risk-label {
    font-size: 7.2pt;
    letter-spacing: 1.3px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 600;
    margin-bottom: 3pt;
  }
  .risk-corner .pill {
    font-size: 9.5pt;
    padding: 3.5pt 11pt;
    font-weight: 700;
  }
  .vehicle-specs {
    margin-top: 12mm;
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 5mm 0;
    display: flex;
    flex-direction: column;
    gap: 4mm;
  }
  .vehicle-specs .spec-group-title {
    display: flex;
    align-items: center;
    gap: 8pt;
    margin-bottom: 2.5mm;
  }
  .vehicle-specs .spec-group-title span {
    font-size: 8pt;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 1.4px;
  }
  .vehicle-specs .spec-group-title::after {
    content: "";
    flex: 1;
    height: 1px;
    background: #e2e8f0;
  }
  .vehicle-specs .spec-group-body {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3mm 6mm;
  }
  .vehicle-specs .spec-cell {
    display: flex;
    flex-direction: column;
    gap: 1pt;
  }
  .vehicle-specs .spec-cell.spec-vin {
    grid-column: span 1;
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
    font-size: 9.5pt;
    letter-spacing: 0.3px;
    font-family: "Roboto Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace;
  }
  .legal-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4mm;
  }
  .legal-card {
    display: flex;
    flex-direction: column;
    gap: 2pt;
    padding: 6pt 9pt 7pt 10pt;
    border: 1px solid #e2e8f0;
    border-left: 3pt solid #94a3b8;
    border-radius: 4pt;
    background: #f8fafc;
  }
  .legal-card.tone-success { border-left-color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; }
  .legal-card.tone-warning { border-left-color: #f59e0b; background: #fffbeb; border-color: #fde68a; }
  .legal-card.tone-danger  { border-left-color: #dc2626; background: #fef2f2; border-color: #fecaca; }
  .legal-card.tone-muted   { border-left-color: #94a3b8; background: #f8fafc; border-color: #e2e8f0; }
  .legal-label {
    font-size: 7.4pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #64748b;
  }
  .legal-status {
    font-size: 12pt;
    font-weight: 700;
    letter-spacing: -0.2px;
    line-height: 1.1;
    margin-top: 1pt;
  }
  .legal-status.tone-success { color: #166534; }
  .legal-status.tone-warning { color: #92400e; }
  .legal-status.tone-danger  { color: #991b1b; }
  .legal-status.tone-muted   { color: #64748b; }
  .legal-meta {
    font-size: 8pt;
    color: #475569;
    line-height: 1.4;
    margin-top: 1pt;
  }
  .legal-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 2.5mm 6mm;
    font-size: 8.8pt;
    color: #475569;
    padding-top: 3mm;
    margin-top: 3mm;
    border-top: 1px dashed #e2e8f0;
  }
  .legal-meta-row .meta-key {
    font-weight: 700;
    color: #334155;
    letter-spacing: 0.2px;
    margin-right: 2pt;
  }
  .legal-source {
    font-size: 7.6pt;
    color: #94a3b8;
    font-style: italic;
    margin-top: 2.5mm;
    text-align: right;
  }
  .cover .footer { border-top: 1px solid #e2e8f0; padding-top: 6mm; color: #64748b; font-size: 9pt; display: flex; justify-content: space-between; }

  /* Branded header on the cover page */
  .brand-header {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12pt;
    align-items: flex-start;
    padding: 10pt 0 12pt;
    border-bottom: 2pt solid #0f172a;
    margin-bottom: 8mm;
    page-break-inside: avoid;
  }
  .brand-header .brand-logo {
    width: 54pt;
    height: 54pt;
    object-fit: contain;
    display: block;
  }
  .brand-header .brand-content {
    display: flex;
    flex-direction: column;
    gap: 4pt;
  }
  .brand-header .company-name {
    font-size: 16pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: 0.3px;
    line-height: 1.15;
  }
  .brand-header .brand-cols {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 18pt;
    align-items: start;
  }
  .brand-header .doc-badge { text-align: right; }
  .brand-header .hdr-value {
    font-size: 9.5pt;
    line-height: 1.5;
    color: #0f172a;
    font-weight: 500;
  }
  .brand-header .hdr-value.mono {
    font-weight: 700;
    letter-spacing: 0.3px;
  }

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

  /* Section status bars */
  .summary-bars-label {
    font-size: 8pt;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
    margin-bottom: 4pt;
  }
  /* Global score block */
  .summary-global {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4pt solid #94a3b8;
    border-radius: 5pt;
    padding: 9pt 14pt;
    margin: 6pt 0 8pt;
  }
  .summary-global.tone-success { border-left-color: #16a34a; background: #f0fdf4; }
  .summary-global.tone-warning { border-left-color: #f59e0b; background: #fffbeb; }
  .summary-global.tone-danger  { border-left-color: #dc2626; background: #fef2f2; }
  .summary-global .sg-label {
    font-size: 8pt;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #475569;
    font-weight: 700;
  }
  .summary-global .sg-meta {
    font-size: 8.5pt;
    color: #64748b;
    margin-top: 2pt;
  }
  .summary-global .sg-value {
    font-size: 28pt;
    font-weight: 800;
    color: #0f172a;
    line-height: 1;
    letter-spacing: -0.5px;
  }

  .summary-rows {
    display: flex;
    flex-direction: column;
    gap: 8pt;
    margin-top: 4pt;
    padding: 10pt 12pt;
    border: 1px solid #e2e8f0;
    border-radius: 5pt;
    background: #ffffff;
  }
  .prog-row {
    display: flex;
    flex-direction: column;
    gap: 4pt;
    padding-bottom: 8pt;
    border-bottom: 1px solid #f1f5f9;
  }
  .prog-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .prog-row-main {
    display: grid;
    grid-template-columns: minmax(80pt, auto) 1fr auto auto;
    align-items: center;
    gap: 12pt;
  }
  .prog-name {
    font-size: 10.5pt;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
  }
  .prog-tier {
    font-size: 9pt;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .prog-tier.tone-success { color: #166534; }
  .prog-tier.tone-warning { color: #92400e; }
  .prog-tier.tone-danger  { color: #991b1b; }
  .prog-tier.tone-muted   { color: #94a3b8; }
  .prog-pct {
    font-size: 12pt;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.3px;
  }
  .prog-pct.tone-success { color: #166534; }
  .prog-pct.tone-warning { color: #92400e; }
  .prog-pct.tone-danger  { color: #991b1b; }
  .prog-pct.tone-muted   { color: #94a3b8; font-weight: 600; }
  .prog-bar {
    height: 11pt;
    background: #e2e8f0;
    border-radius: 100px;
    overflow: hidden;
  }
  .prog-fill {
    height: 100%;
    border-radius: 100px;
  }
  .prog-fill.tone-success { background: #16a34a; }
  .prog-fill.tone-warning { background: #f59e0b; }
  .prog-fill.tone-danger  { background: #dc2626; }
  .prog-fill.tone-muted   { background: #cbd5e1; }
  .prog-stats {
    display: flex;
    gap: 10pt;
    align-items: center;
    flex-wrap: wrap;
    font-size: 8.8pt;
    color: #475569;
  }
  .stat-chip {
    display: inline-flex;
    gap: 4pt;
    align-items: center;
  }
  .stat-dot {
    width: 6pt;
    height: 6pt;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }
  .stat-chip.ok     .stat-dot { background: #16a34a; }
  .stat-chip.warn   .stat-dot { background: #f59e0b; }
  .stat-chip.danger .stat-dot { background: #dc2626; }
  .stat-count {
    font-weight: 700;
    color: #0f172a;
  }
  .stat-chip.ok     .stat-count { color: #166534; }
  .stat-chip.warn   .stat-count { color: #92400e; }
  .stat-chip.danger .stat-count { color: #991b1b; }
  .stat-sep { color: #cbd5e1; font-weight: 700; }
  .stat-meta { color: #64748b; }
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

  /* Indivisible blocks: never split these mid-page */
  .finding,
  .exec-finding,
  .sig-block,
  .conclusion { page-break-inside: avoid; }
  /* Avoid orphan headings (a h2 stranded at the bottom of a page) */
  h2, h3 { page-break-after: avoid; }

  .conclusion { border: 1px solid #e2e8f0; border-radius: 6pt; padding: 10pt; background: #f8fafc; margin-top: 8pt; }
  .conclusion h3 { margin-top: 0; }

  .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 18mm; }
  .sig-box { border-bottom: 1px solid #0f172a; height: 22mm; display: flex; align-items: flex-end; justify-content: center; }
  .sig-box img { max-height: 22mm; max-width: 100%; }
  .sig-label { font-size: 9pt; color: #334155; text-align: center; padding-top: 3pt; }

  /* Executive section blocks — let them flow across pages naturally */
  .exec-section { padding: 6pt 0; }
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
        <img class="brand-logo" src="${brand.logoDataUrl}" alt="${escapeHtml(brand.name)}" />
        <div class="brand-content">
          <div class="company-name">${escapeHtml(brand.name)}</div>
          <div class="brand-cols">
            <div>
              <div class="hdr-value">${esc(brand.nit)}</div>
              <div class="hdr-value">${esc(v.inspector)}</div>
              <div class="hdr-value">${esc(v.inspectorId)}</div>
            </div>
            <div class="doc-badge">
              <div class="hdr-value mono">${esc(docNumber)}</div>
              <div class="hdr-value">${fmtDate(v.date)}</div>
              <div class="hdr-value">${esc(v.location)}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="vehicle-hero">
        <div class="plate-frame">
          <div class="plate-band">COLOMBIA</div>
          <div class="plate-number">${escapeHtml(formatPlate(v.plate))}</div>
        </div>
        <div class="vehicle-info">
          <div class="kind-label">${escapeHtml(kindDef.label)}</div>
          <div class="vehicle-name">${esc(v.make)} ${esc(v.model)}</div>
          <div class="vehicle-meta">Año ${esc(v.year)}${v.color ? ` · ${esc(v.color)}` : ""}</div>
        </div>
      </div>

      ${renderSummaryBars(
        health,
        [
          ...sections.map((s) => ({ key: s.stepId as string, title: s.title })),
          ...(showTires ? [{ key: "tires", title: "Llantas" }] : []),
          ...(showAccessories ? [{ key: "accessories", title: "Accesorios" }] : []),
        ],
        { heading: "Estado general por sección", compact: true },
      )}

      <div class="vehicle-specs">
        <div class="spec-group">
          <div class="spec-group-title"><span>Identificación</span></div>
          <div class="spec-group-body">
            <div class="spec-cell spec-vin"><span class="label">VIN / Chasis</span><span class="value mono">${esc(v.vin)}</span></div>
            <div class="spec-cell"><span class="label">Carrocería</span><span class="value">${esc(v.bodyType)}</span></div>
            <div class="spec-cell"><span class="label">Propietario</span><span class="value">${esc(v.owner)}</span></div>
          </div>
        </div>
        <div class="spec-group">
          <div class="spec-group-title"><span>Operación</span></div>
          <div class="spec-group-body">
            <div class="spec-cell"><span class="label">Kilometraje</span><span class="value">${esc(v.mileage)} km</span></div>
            <div class="spec-cell"><span class="label">Combustible</span><span class="value">${escapeHtml(fuelLabel(v.fuel))}</span></div>
            <div class="spec-cell"><span class="label">Transmisión</span><span class="value">${escapeHtml(transmissionLabel(v.transmission))}</span></div>
          </div>
        </div>
        ${renderLegalAdmin(data.verifik)}
      </div>
    </div>

    <div class="footer">
      <span>${escapeHtml(brand.address)} · ${escapeHtml(brand.email)} · ${escapeHtml(brand.phone)}${brand.website ? ` · ${escapeHtml(brand.website)}` : ""}</span>
      <span>Generado el ${new Date().toLocaleString("es-CO")}</span>
    </div>
  </section>

  <!-- EXECUTIVE SUMMARY -->
  <section>
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

  <section>
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
  <section style="margin-top:10pt;">
    ${sections.map((s) => renderSectionExecutive(s.title, s.def, s.data)).join("")}
  </section>

  ${showTires ? `
  <section style="margin-top:10pt;">
    <h2>Llantas</h2>
    ${renderTires(data)}
  </section>
  ` : ""}

  ${showAccessories ? `
  <section style="margin-top:10pt;">
    <h2>Accesorios</h2>
    ${renderAccessories(data)}
  </section>
  ` : ""}
  `
      : `
  ${sections.length > 0 ? `
  <section style="margin-top:10pt;">
    <h2>${escapeHtml(sections[0].title)}</h2>
    ${renderSectionTable(sections[0].def, sections[0].data)}
  </section>

  ${sections.length > 1 ? `
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
  ` : ""}
  ` : ""}

  ${showTires ? `
  <section style="margin-top:10pt;">
    <h2>Llantas</h2>
    ${renderTires(data)}
  </section>
  ` : ""}

  ${showAccessories ? `
  <section style="margin-top:10pt;">
    <h2>Accesorios</h2>
    ${renderAccessories(data)}
  </section>
  ` : ""}

  <!-- EVIDENCE -->
  <section style="margin-top:10pt;">
    <h2>Evidencia fotográfica</h2>
    ${sections.map((s) => renderEvidence(s.title, s.def, s.data)).join("") || `<p class="muted">No se registraron fotografías.</p>`}
  </section>
  `
  }

  <!-- CONCLUSION -->
  <section style="margin-top:10pt;">
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
