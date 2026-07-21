import * as fs from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

import { buildDocumentNumber, getCompanyBranding, type CompanyBranding } from "./company";
import {
  activeSectionsFor,
  bodyworkSectionFor,
  CHASSIS_SECTION,
  COMFORT_SECTION,
  componentsForKind,
  ELECTRICAL_SECTION,
  ENGINE_SECTION,
  FALLBACK_VEHICLE_TYPE,
  LEAKS_SECTION,
  PERITAJE_KINDS,
  ROAD_TEST_SECTION,
  SUSPENSION_SECTION,
  VEHICLE_TYPES,
  type SectionId,
} from "./constants";
import { findOption } from "./findings-catalog";
import { computeHealth, type HealthReport, type RiskReport, type SectionHealth } from "./rules-engine";
import { computePillars, type PillarHealth, type PillarReport } from "./scoring";
import type {
  InspectionData,
  InspectionEntry,
  InspectionSectionDef,
  VehicleType,
} from "./types";
import { titleCase } from "./verifik/mappings";
import { fasecoldaLatestValueCop } from "./verifik/fasecolda";
import type { FasecoldaData, RuntSoat, RuntTecnoMecanica, VerifikSnapshot } from "./verifik/types";

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

// Mapeo automático del puntaje a color/etiqueta. Decisión de negocio: DOS bandas
// parejas para todos los pilares y la nota global — aprobado (verde) desde 55%,
// rechazado (rojo) por debajo. La banda amarilla intermedia ("FUERA ESTÁNDAR")
// del cálculo automático se eliminó (sigue existiendo solo como concepto MANUAL
// que el perito puede elegir a mano, ver CONDITION_OPTIONS en summary.tsx).
const APPROVAL_THRESHOLD = 55;

function scoreTone(pct: number): "success" | "warning" | "danger" {
  return pct >= APPROVAL_THRESHOLD ? "success" : "danger";
}

function tierLabel(pct: number | null): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  if (pct === null) return { label: "Sin inspeccionar", tone: "muted" };
  if (pct >= APPROVAL_THRESHOLD) return { label: "ESTÁNDAR", tone: "success" };
  return { label: "ASEGURABILIDAD SUJETA A POLÍTICAS", tone: "danger" };
}

/**
 * Concepto a partir de la *condición general* que el perito eligió a mano en la
 * conclusión técnica. Esta selección manda sobre el cálculo automático por
 * puntaje: el concepto del peritaje debe ser exactamente el que el perito
 * dictaminó. Devuelve null si no se seleccionó ninguna.
 */
function conceptoFromGeneralCondition(
  value: string | undefined,
): { label: string; tone: "success" | "warning" | "danger" | "muted"; meaning: string } | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const norm = v.toUpperCase();
  if (norm === "ESTÁNDAR" || norm === "ESTANDAR") {
    return {
      label: v,
      tone: "success",
      meaning: "El vehículo cumple con las condiciones estándar de aseguramiento.",
    };
  }
  if (norm.startsWith("FUERA")) {
    return {
      label: v,
      tone: "warning",
      meaning:
        "El vehículo presenta condiciones fuera del estándar; revise los hallazgos antes de asegurar.",
    };
  }
  if (norm.includes("ASEGURABILIDAD")) {
    return {
      label: v,
      tone: "danger",
      meaning:
        "La asegurabilidad del vehículo queda sujeta a las políticas de cada aseguradora.",
    };
  }
  // Valor no reconocido (no debería pasar con el selector actual): lo mostramos
  // tal cual, sin tono fuerte.
  return { label: v, tone: "muted", meaning: "" };
}

/**
 * Banner del concepto global en la portada — el titular del reporte. Muestra el
 * concepto en grande (ESTÁNDAR / FUERA DE ESTÁNDAR / ASEGURABILIDAD SUJETA A
 * POLÍTICAS), para que sea lo primero que vea el cliente.
 *
 * El concepto es SIEMPRE la condición general que el perito eligió a mano en la
 * conclusión técnica. Nunca se deriva del puntaje ni de ningún cálculo
 * automático. Si el perito no eligió una condición, no se muestra banner.
 */
function renderConceptoBanner(data: InspectionData): string {
  const concepto = conceptoFromGeneralCondition(data.conclusion?.generalCondition);
  if (!concepto) return "";
  return `
    <div class="concepto-banner tone-${concepto.tone}">
      <div class="cb-main">
        <div class="cb-overline">Concepto del peritaje</div>
        <div class="cb-label">${escapeHtml(concepto.label)}</div>
        <div class="cb-meaning">${escapeHtml(concepto.meaning)}</div>
      </div>
    </div>
  `;
}

function renderPillarRow(pillar: PillarHealth): string {
  const fill = pillar.healthPct === null ? 0 : Math.max(0, Math.min(100, pillar.healthPct));
  const tier = tierLabel(pillar.healthPct);
  const pctText = pillar.healthPct === null ? "—" : `${pillar.healthPct}%`;
  const itemsLabel = pillar.inspected === 1 ? "1 ítem" : `${pillar.inspected} ítems`;
  const statChips: string[] = [];
  if (pillar.inspected === 0) {
    statChips.push(`<span class="stat-meta">Pilar no evaluado</span>`);
  } else {
    if (pillar.ok > 0)
      statChips.push(
        `<span class="stat-chip ok"><span class="stat-dot"></span><span class="stat-count">${pillar.ok}</span> sin novedad</span>`,
      );
    if (pillar.warning > 0)
      statChips.push(
        `<span class="stat-chip warn"><span class="stat-dot"></span><span class="stat-count">${pillar.warning}</span> ${pillar.warning === 1 ? "advertencia" : "advertencias"}</span>`,
      );
    if (pillar.danger > 0)
      statChips.push(
        `<span class="stat-chip danger"><span class="stat-dot"></span><span class="stat-count">${pillar.danger}</span> ${pillar.danger === 1 ? "crítico" : "críticos"}</span>`,
      );
    statChips.push(`<span class="stat-sep">·</span><span class="stat-meta">${itemsLabel}</span>`);
  }
  return `
    <div class="prog-row">
      <div class="prog-row-main">
        <div class="prog-name">
          ${escapeHtml(pillar.title)}
        </div>
        <div class="prog-bar"><div class="prog-fill tone-${tier.tone}" style="width:${fill.toFixed(2)}%"></div></div>
        <span class="prog-pct tone-${tier.tone}">${pctText}</span>
        <span class="prog-tier tone-${tier.tone}">${escapeHtml(tier.label)}</span>
      </div>
      <div class="prog-stats">${statChips.join("")}</div>
    </div>
  `;
}

function renderPillarSummary(
  pillarReport: PillarReport,
  options?: { heading?: string; compact?: boolean },
): string {
  const { pillars, globalPct, gates } = pillarReport;
  const inspectedTotal = pillars.reduce((sum, p) => sum + p.inspected, 0);
  if (inspectedTotal === 0 && gates.length === 0) return "";

  const heading = options?.heading
    ? options.compact
      ? `<div class="summary-bars-label">${escapeHtml(options.heading)}</div>`
      : `<h2>${escapeHtml(options.heading)}</h2>`
    : "";

  const evaluatedPillars = pillars.filter((p) => p.healthPct !== null).length;
  const totalPillars = pillars.length;
  const globalBlock = globalPct === null
    ? ""
    : `
      <div class="summary-global tone-${scoreTone(globalPct)}">
        <div class="sg-text">
          <div class="sg-label">Estado general del vehículo</div>
          <div class="sg-meta">Promedio ponderado · ${evaluatedPillars} de ${totalPillars} pilares evaluados${gates.length > 0 ? ` · <strong>${gates.length} gate${gates.length === 1 ? "" : "s"} de seguridad activo${gates.length === 1 ? "" : "s"}</strong>` : ""}</div>
        </div>
        <div class="sg-value">${globalPct}%</div>
      </div>`;

  const gatesBlock = gates.length === 0
    ? ""
    : `
      <div class="gates-block">
        <div class="gates-label">⚠ Gates de seguridad activos — fuerzan riesgo alto o crítico sin importar la nota global</div>
        <ul class="gates-list">
          ${gates
            .map(
              (g) => `
            <li>
              <strong>${escapeHtml(g.reason)}:</strong>
              <span>${escapeHtml(g.detail)}</span>
            </li>`,
            )
            .join("")}
        </ul>
      </div>`;

  return `
    <section style="margin-top:${options?.compact ? "4mm" : "14pt"};">
      ${heading}
      ${globalBlock}
      <div class="summary-rows">
        ${pillars.map((p) => renderPillarRow(p)).join("")}
      </div>
      ${gatesBlock}
    </section>
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
  headingHtml: string,
  section: InspectionSectionDef,
  data: Record<string, InspectionEntry>,
  sectionHealth?: SectionHealth,
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
      <section class="docs-section proc-section">
        ${headingHtml}
        <p class="muted">Sin datos registrados.</p>
      </section>
    `;
  }

  const totalInspected = findings.length + okItems.length;
  const heroTone =
    sectionHealth && sectionHealth.healthPct !== null
      ? scoreTone(sectionHealth.healthPct)
      : findings.some((f) => f.tone === "danger")
        ? "danger"
        : findings.length > 0
          ? "warning"
          : "success";
  const heroLabel = findings.length === 0
    ? "Sección sin hallazgos"
    : findings.length === 1
      ? "1 hallazgo detectado"
      : `${findings.length} hallazgos detectados`;
  const heroMeta = `${totalInspected} ítem${totalInspected === 1 ? "" : "s"} inspeccionado${totalInspected === 1 ? "" : "s"} · ${okItems.length} en condición original`;
  const heroPct = sectionHealth?.healthPct;

  const heroBlock = `
    <div class="proc-hero tone-${heroTone}">
      <div class="proc-hero-text">
        <span class="proc-hero-label">${escapeHtml(heroLabel)}</span>
        <span class="proc-hero-meta">${escapeHtml(heroMeta)}</span>
      </div>
      ${heroPct !== undefined && heroPct !== null
        ? `<span class="proc-hero-pct">${heroPct}%</span>`
        : ""}
    </div>`;

  const findingBlocks = findings
    .map((f) => {
      const photos = f.images.length
        ? `<div class="proc-finding-photos">${f.images
            .map(
              (img) =>
                `<img src="${img.dataUrl}" alt="${escapeHtml(f.label)}" />`,
            )
            .join("")}</div>`
        : "";
      const notes = f.notes
        ? `<div class="proc-finding-notes">${escapeHtml(f.notes)}</div>`
        : "";
      return `
        <div class="proc-finding tone-${f.tone}">
          <div class="proc-finding-head">
            <span class="pill pill-${f.tone}">${escapeHtml(f.findingLabel)}</span>
          </div>
          <div class="proc-finding-title">${escapeHtml(f.label)}</div>
          ${notes}
          ${photos}
        </div>`;
    })
    .join("");

  // Carrocería tiene ~20 ítems, así que ahí los OK se renderizan en 2 columnas
  // con bullets para que quepan respirados. El resto de secciones tiene menos
  // ítems y queda mejor con el listado inline " · "-separado.
  const okBody = section.id === "bodywork"
    ? `<ul class="proc-ok-grid">${okItems.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
    : `<div class="proc-ok-note">${okItems.map((s) => escapeHtml(s)).join(" · ")}</div>`;

  const okBlock = okItems.length > 0
    ? `
      <div class="proc-ok-card">
        <div class="proc-ok-head">
          <span class="proc-ok-icon">✓</span>
          <span class="proc-ok-count">${okItems.length} ${okItems.length === 1 ? "ítem" : "ítems"} en condición original</span>
        </div>
        ${okBody}
      </div>`
    : "";

  return `
    <section class="docs-section proc-section">
      ${headingHtml}
      ${heroBlock}
      ${findingBlocks ? `<div class="proc-findings proc-findings-2col">${findingBlocks}</div>` : ""}
      ${okBlock}
    </section>
  `;
}

/**
 * Render compacto: en vez de cards + lista de OK, los ítems van en dos tablas
 * lado-a-lado (todos con su pill de estado), y solo los hallazgos con notas o
 * fotos se expanden en un bloque de detalle abajo. Así cada sección queda
 * mucho más corta sin perder la trazabilidad del peritaje.
 */
function renderSectionDualTable(
  headingHtml: string,
  section: InspectionSectionDef,
  data: Record<string, InspectionEntry>,
  sectionHealth?: SectionHealth,
  sectionId?: SectionId,
  vehicleType?: VehicleType,
): string {
  type Row = {
    label: string;
    statusLabel: string;
    tone: "success" | "warning" | "danger" | "neutral";
    notes: string;
    images: { dataUrl: string }[];
    sealant?: "original" | "generic";
  };

  const rows: Row[] = [];
  for (const group of section.groups) {
    for (const item of group.items) {
      const entry = data?.[item.id];
      const opt = findOption(entry?.status);
      if (!opt) continue;
      rows.push({
        label: item.label,
        statusLabel: opt.label,
        tone: opt.tone,
        notes: entry?.notes ?? "",
        images: entry?.images ?? [],
        sealant: item.hasSealantCheck ? entry?.sealant : undefined,
      });
    }
  }

  if (rows.length === 0) {
    return `
      <section class="docs-section proc-section">
        ${headingHtml}
        <p class="muted">Sin datos registrados.</p>
      </section>
    `;
  }

  const findings = rows.filter((r) => r.tone === "warning" || r.tone === "danger");
  const okCount = rows.length - findings.length;
  const heroTone =
    sectionHealth && sectionHealth.healthPct !== null
      ? scoreTone(sectionHealth.healthPct)
      : findings.some((f) => f.tone === "danger")
        ? "danger"
        : findings.length > 0
          ? "warning"
          : "success";
  const heroLabel = findings.length === 0
    ? "Sección sin hallazgos"
    : findings.length === 1
      ? "1 hallazgo detectado"
      : `${findings.length} hallazgos detectados`;
  const heroMeta = `${rows.length} ítem${rows.length === 1 ? "" : "s"} inspeccionado${rows.length === 1 ? "" : "s"} · ${okCount} en condición original`;
  const heroPct = sectionHealth?.healthPct;

  const heroBlock = `
    <div class="proc-hero tone-${heroTone}">
      <div class="proc-hero-text">
        <span class="proc-hero-label">${escapeHtml(heroLabel)}</span>
        <span class="proc-hero-meta">${escapeHtml(heroMeta)}</span>
      </div>
      ${heroPct !== undefined && heroPct !== null
        ? `<span class="proc-hero-pct">${heroPct}%</span>`
        : ""}
    </div>`;

  const half = Math.ceil(rows.length / 2);
  const leftRows = rows.slice(0, half);
  const rightRows = rows.slice(half);

  const sealantChip = (sealant: "original" | "generic") => `
    <span class="sealant-chip sealant-${sealant}" title="Sellante del marco">
      Sellante ${sealant === "original" ? "original" : "genérico"}
    </span>`;

  const renderTable = (tableRows: Row[]) => `
    <table class="section-table compact bodywork-split">
      <thead>
        <tr>
          <th>Ítem</th>
          <th style="width:42%">Estado</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows
          .map(
            (r) => `
              <tr>
                <td class="item">${escapeHtml(r.label)}${r.sealant ? sealantChip(r.sealant) : ""}</td>
                <td><span class="pill pill-${r.tone}">${escapeHtml(r.statusLabel)}</span></td>
              </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;

  const tablesBlock = `
    <div class="bodywork-tables">
      ${renderTable(leftRows)}
      ${renderTable(rightRows)}
    </div>`;

  // Los detalles de hallazgos (con notas/fotos) ya no se renderizan acá —
  // se consolidan al final del documento en renderAllFindingsDetail para que
  // el PDF tenga primero el resumen tabular y luego el dossier completo.
  const SECTIONS_WITH_REF_IMAGE: readonly SectionId[] = ["bodywork", "chassis", "engine"];
  const refImage =
    sectionId && SECTIONS_WITH_REF_IMAGE.includes(sectionId)
      ? sectionReferenceImage(sectionId, vehicleType)
      : "";

  return `
    <section class="docs-section proc-section">
      ${headingHtml}
      ${refImage}
      ${heroBlock}
      ${tablesBlock}
    </section>
  `;
}

/**
 * Si `public/section-refs/<sectionId>.png|jpg` existe, devuelve el HTML
 * para mostrar esa imagen al inicio de la sección del PDF. Si no, devuelve
 * string vacío y la sección se renderiza sin imagen. El check de archivo es
 * sincrónico (existsSync) — barato porque solo corre una vez por sección
 * del PDF, y los archivos viven en `public/` del bundle.
 *
 * La imagen se referencia por ruta `/section-refs/...` que Puppeteer
 * descarga del mismo origin durante el render.
 */
const SECTION_DESCRIPTIONS: Record<SectionId, { summary: string; items: string[] }> = {
  bodywork: {
    summary: "Evaluación visual completa del exterior del vehículo para detectar daños, reparaciones previas y alteraciones de fábrica.",
    items: ["Paneles, puertas y guardabarros", "Vidrios, molduras y cromados", "Capó y maletero", "Pintura: repintada, oxidación o masilla", "Huellas de colisión o reparación estructural"],
  },
  chassis: {
    summary: "Inspección estructural del chasis para identificar daños post-colisión, reparaciones ocultas y pérdida de integridad.",
    items: ["Largueros y travesaños", "Puntos de anclaje y soldaduras", "Originalidad de sellantes", "Óxido estructural o dobleces", "Piso, parales y panel trasero"],
  },
  suspension: {
    summary: "Diagnóstico del sistema de amortiguación y dirección para evaluar seguridad, confort y desgaste de componentes.",
    items: ["Amortiguadores delanteros y traseros", "Rótulas, bujes y muelles", "Brazos de suspensión", "Estabilizadores y terminales", "Alineación y comportamiento general"],
  },
  engine: {
    summary: "Revisión del compartimento motor para verificar su estado mecánico, estanqueidad y comportamiento al encendido.",
    items: ["Nivel y estado de fluidos", "Mangueras, correas y fajas", "Batería y sistema de arranque", "Signos de fugas o sobrecalentamiento", "Comportamiento al ralentí"],
  },
  electrical: {
    summary: "Verificación del sistema eléctrico y electrónico para detectar fallos en iluminación, carga y conectividad.",
    items: ["Sistema de iluminación completo", "Señales, sensores y tablero", "Sistema de carga y alternador", "Fusibles y conectores", "Elevavidrios y cierre centralizado"],
  },
  comfort: {
    summary: "Evaluación del habitáculo para verificar el estado de materiales, controles y sistemas de confort del ocupante.",
    items: ["Tapicería, techo y pisos", "Climatización y calefacción", "Sistema de audio y pantallas", "Tablero e instrumentos", "Funcionamiento de controles y mandos"],
  },
  leaks: {
    summary: "Inspección visual de fugas activas o residuales en sistemas de fluidos críticos del vehículo.",
    items: ["Aceite de motor y caja", "Líquido refrigerante", "Líquido de frenos", "Dirección hidráulica", "Sellos de cigüeñal y diferencial"],
  },
  roadTest: {
    summary: "Evaluación del comportamiento dinámico del vehículo en condiciones reales de conducción.",
    items: ["Aceleración y respuesta del motor", "Sistema de frenos", "Dirección y estabilidad", "Transmisión y caja de velocidades", "Ruidos y vibraciones anómalos"],
  },
  tires: {
    summary: "Revisión del estado de los neumáticos y aros para verificar seguridad, desgaste y uniformidad entre ejes.",
    items: ["Profundidad de banda de rodadura", "Desgaste irregular o excéntrico", "Presión y estado general", "Condición de los aros", "Uniformidad entre ejes"],
  },
  accessories: {
    summary: "Inventario de accesorios obligatorios y opcionales presentes en el vehículo al momento de la inspección.",
    items: ["Documentos y tarjeta de propiedad", "Llaves y controles remotos", "Extintor y señales de emergencia", "Gato hidráulico y herramientas", "Llanta de repuesto"],
  },
};

function sectionReferenceImage(sectionId: SectionId, vehicleType?: VehicleType): string {
  const refUrl =
    (vehicleType && SECTION_REF_URLS[`${sectionId}_${vehicleType}`]) ||
    SECTION_REF_URLS[sectionId] ||
    null;
  const desc = SECTION_DESCRIPTIONS[sectionId];
  if (!desc) return "";

  const descHtml = `
    <div class="section-intro-desc">
      <p class="section-intro-summary">${escapeHtml(desc.summary)}</p>
      <ul class="section-intro-items">
        ${desc.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;

  if (!refUrl) {
    return `<div class="section-intro section-intro-noimg">${descHtml}</div>`;
  }
  return `
    <div class="section-intro">
      <div class="section-intro-img">
        <img src="${refUrl}" alt="Referencia visual: ${escapeHtml(sectionId)}" />
      </div>
      ${descHtml}
    </div>
  `;
}

/**
 * Map sectionId → URL pública del archivo en `public/section-refs/`.
 *
 * El chequeo se hace UNA VEZ al cargar el módulo (en boot del server) en vez
 * de en cada render: existsSync es barato pero el render del PDF llama a
 * sectionReferenceImage por cada sección, y multiplicar I/O ahí no aporta.
 * Si el operador agrega un archivo nuevo, hay que reiniciar pm2 para que
 * lo detecte — trade-off aceptable porque las imágenes de referencia se
 * cambian rara vez.
 */
const SECTION_REF_DIR = path.join(process.cwd(), "public", "section-refs");
const SECTION_REF_IDS: SectionId[] = [
  "bodywork",
  "chassis",
  "suspension",
  "engine",
  "electrical",
  "leaks",
  "comfort",
  "roadTest",
  "tires",
  "accessories",
];

/**
 * Mapa plano de claves "{sectionId}_{vehicleType}" y "{sectionId}" → URL pública.
 * La búsqueda en sectionReferenceImage prueba primero la clave específica por
 * tipo de vehículo y cae al genérico si no existe.
 */
const SECTION_REF_URLS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const exts = ["png", "jpg", "jpeg", "webp"];
  const mimeOf: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(SECTION_REF_DIR);
  } catch { /* carpeta no existe */ }

  for (const entry of entries) {
    const dot = entry.lastIndexOf(".");
    if (dot === -1) continue;
    const ext = entry.slice(dot + 1).toLowerCase();
    if (!exts.includes(ext)) continue;
    const key = entry.slice(0, dot);
    if (out[key]) continue;
    try {
      const buf = fs.readFileSync(path.join(SECTION_REF_DIR, entry));
      out[key] = `data:${mimeOf[ext]};base64,${buf.toString("base64")}`;
    } catch { /* archivo no legible */ }
  }
  return out;
})();

/**
 * Detalle consolidado de hallazgos: recorre todas las secciones, junta los
 * ítems con notas o fotos (sólo warnings/dangers que aporten contexto), y
 * los agrupa por sección. Se renderiza al final del documento como dossier,
 * separado del resumen tabular que va arriba en cada sección.
 */
function renderAllFindingsDetail(
  sections: {
    title: string;
    def: InspectionSectionDef;
    data: Record<string, InspectionEntry>;
  }[],
  headingHtml: string,
): string {
  type DetailFinding = {
    label: string;
    statusLabel: string;
    tone: "warning" | "danger";
    notes: string;
    images: { dataUrl: string }[];
  };
  type DetailGroup = { title: string; findings: DetailFinding[] };

  const groups: DetailGroup[] = [];
  for (const s of sections) {
    const found: DetailFinding[] = [];
    for (const group of s.def.groups) {
      for (const item of group.items) {
        const entry = s.data?.[item.id];
        const opt = findOption(entry?.status);
        if (!opt) continue;
        if (opt.tone !== "warning" && opt.tone !== "danger") continue;
        const hasNotes = !!entry?.notes;
        const hasImages = !!entry?.images && entry.images.length > 0;
        if (!hasNotes && !hasImages) continue;
        found.push({
          label: item.label,
          statusLabel: opt.label,
          tone: opt.tone,
          notes: entry?.notes ?? "",
          images: entry?.images ?? [],
        });
      }
    }
    if (found.length > 0) groups.push({ title: s.title, findings: found });
  }

  if (groups.length === 0) return "";

  const cards = (findings: DetailFinding[]) =>
    findings
      .map((f) => {
        const photos = f.images.length
          ? `<div class="proc-finding-photos">${f.images
              .map(
                (img) =>
                  `<img src="${img.dataUrl}" alt="${escapeHtml(f.label)}" />`,
              )
              .join("")}</div>`
          : "";
        const notes = f.notes
          ? `<div class="proc-finding-notes">${escapeHtml(f.notes)}</div>`
          : "";
        return `
          <div class="proc-finding tone-${f.tone}">
            <div class="proc-finding-head">
              <span class="pill pill-${f.tone}">${escapeHtml(f.statusLabel)}</span>
            </div>
            <div class="proc-finding-title">${escapeHtml(f.label)}</div>
            ${notes}
            ${photos}
          </div>`;
      })
      .join("");

  return `
    <section class="docs-section proc-section findings-detail">
      ${headingHtml}
      ${groups
        .map(
          (g) => `
        <div class="findings-detail-group">
          <div class="findings-detail-group-head">${escapeHtml(g.title)}</div>
          <div class="proc-findings proc-findings-2col">
            ${cards(g.findings)}
          </div>
        </div>`,
        )
        .join("")}
    </section>
  `;
}

/**
 * Consideraciones y aclaraciones del servicio: cláusulas de limitación de
 * responsabilidad por sistema. Cada sistema lleva (cuando aplica) Alcance del
 * servicio, Observaciones y "Este servicio no comprende". El bloque va en
 * página propia (page-break-before) y se imprime antes del aviso legal.
 */
type ServiceClause = {
  title: string;
  scope?: string;
  observations?: string;
  excludes?: string;
};

function renderServiceConsiderations(brand: CompanyBranding): string {
  const upperName = (brand.name || "Peritajes del Llano").toUpperCase();

  const clauses: ServiceClause[] = [
    {
      title: "Suspensión",
      scope:
        "Validación visual de elementos como tijeras, barra estabilizadora, espirales, tensores, bujes de tijera, mulecos, soportes, axiales, terminales, rótulas y muelles. Verificación de rebote: se realiza aplicando fuerza manual.",
      observations:
        "La validación visual y la verificación de rebote se realizan sin hacer desmonte de algún elemento del vehículo.",
      excludes:
        "Estado funcional de espirales de suspensión, ballestas, barras de torsión, bombonas, sistemas hidráulicos y neumáticos de suspensión, sensores y controladores eléctricos dentro del sistema, terminales, torres de amortiguadores. Vida útil de elementos de suspensión como: tijeras, espirales, tensores, barra estabilizadora, bujes de tijera.",
    },
    {
      title: "Frenos",
      scope:
        "Diagnóstico visual y verificación física del funcionamiento del pedal de freno y del freno de mano. Se verifica el estado de los discos de freno, el nivel de líquido de frenos y que no presenten fugas en las líneas hidráulicas.",
      observations:
        "El estado de los discos de freno se limita a la verificación visual; el resultado no implica un buen estado funcional de los elementos al momento de la inspección.",
      excludes:
        "Nivel de desgaste o vida útil de los elementos de fricción (pastillas, bandas), estado funcional o vida útil de guayas de freno de mano y pedal de freno. Graduación de bomba de freno y freno de mano. Existencia de sensores, captadores, módulos de control electrónico EBD (reparto electrónico de frenada) del sistema de frenos ABS (antibloqueo de frenos). No se valida la calidad de fluidos. No se realizan pruebas de ruta para validar el funcionamiento de ningún elemento del sistema.",
    },
    {
      title: "Dirección",
      scope:
        "Verificación de fugas (aceite) de caja de dirección y depósito de aceite hidráulico. Estado de guardapolvos, brazos y axiales. Existencia de pines en tuercas terminales y rótulas (cuando aplique).",
      observations:
        "El estado de los guardapolvos, la existencia de pines y la verificación de fugas se realiza por inspección visual; no implica un equipo profesional de diagnóstico para dichos elementos y sus complementos.",
      excludes:
        "No incluye medición de otros ángulos como camber, caster, said, divergencia o convergencia. Suavidad y confort del timón de dirección. Estado funcional de brazos de dirección, holgura de terminales de dirección, brazos axiales, topes, desgaste de componentes internos de la caja de dirección ni su vida útil.",
    },
    {
      title: "Llantas",
      scope:
        "Estado del labrado y banda radial de las llantas en uso, no inferior a lo estipulado por las normas técnicas.",
      observations:
        "La vida útil de las llantas es calculada según la profundidad del labrado y estado de la banda radial. Esta puede cambiar dramáticamente según su manejo.",
      excludes:
        "No se verifica el estado de los componentes internos, deformaciones internas o externas.",
    },
    {
      title: "Rines",
      excludes:
        "No se valida si el rin presenta rectificación, reconstrucción, deformación o desbalanceo.",
    },
    {
      title: "Sistema eléctrico",
      scope:
        "Funcionamiento del sistema eléctrico, sunroof, retrovisores eléctricos, limpiabrisas delanteros y traseros, verificación de líquido limpiaparabrisas, funcionamiento de luces (altas, bajas, medias, direccionales, estacionarias, placa, freno, reverso, antiniebla, luz techo, exploradoras), estado de aire acondicionado, calefacción, desempañador, millar y tablero de instrumentos (radio, velocímetro, tacómetro, reloj, pito, testigos de alerta), funcionamiento de bloqueo central.",
      observations:
        "La revisión de luces se realiza de manera visual sin necesidad de usar equipos profesionales. La revisión de los elementos eléctricos y electrónicos del vehículo depende de la carga de la batería que tenga durante el peritaje. La funcionalidad de sensores, módulos de control electrónico de sistemas de seguridad o confort y controladores a nivel general se valida con equipos profesionales y no está incluida dentro del alcance del servicio.",
      excludes:
        "Vida útil de elementos eléctricos, potencia de luminosidad de faros (altas, bajas, medias, direccionales, estacionarias, placa, freno, reverso, antiniebla, luz techo, exploradoras). Estado de conexiones eléctricas principales y secundarias. No se valida funcionamiento de alarmas originales de fábrica ni genéricas instaladas en el vehículo. No se valida función automática de los elevavidrios eléctricos. No se valida función de retracción de los espejos retrovisores exteriores. No se verifica estado de luces de señalización o confort.",
    },
    {
      title: "Transmisión de potencia",
      scope:
        "Estado de ejes cardánicos y crucetas. Verificación de fugas de fluidos por diferencial, caja de transmisión y bomba de embrague. Verificar nivel de líquidos de embrague (cuando aplique). Verificar guardapolvos de semieje.",
      observations:
        "La verificación de los elementos de transmisión de potencia se realiza de forma visual; no se implementa ningún tipo de equipo especializado que permita diagnosticar fallas u originalidad de piezas. La detección de fugas se realiza de acuerdo al estado inicial del vehículo en modo estacionario; no se realiza encendido prolongado para verificar el estado de varios elementos o el impacto de una fuga.",
      excludes:
        "No se verifica el estado funcional de la caja de velocidades ni del diferencial. Embrague: se verifica el accionamiento básico del sistema, no se valida nivel de desgaste de los componentes internos (elementos de fricción) o ruidos normales de funcionamiento. Funcionamiento o nivel de desgaste de los selectores de cambios en transmisiones automáticas, manuales, secuenciales o CVT (transmisión variable continua). Semieje, juntas homocinéticas, tricetas, bocines, rodamientos, roscado de pernos de sujeción de neumáticos, retenedores, ruidos anormales de los anteriores elementos. Validación de engrase de elementos articulados. No se valida la cantidad de los fluidos. No se verifican conjuntos de transferencia de doble tracción ni sus sensores y controladores, ya que no siempre aplica la prueba de ruta o las condiciones son propicias para la verificación.",
    },
    {
      title: "Chasis",
      scope:
        "Verificación de puntas de chasis delanteras y traseras, piso de carrocería y baúl, panel trasero, parales, traviesas, larguero, capota, originalidad de soldaduras y sellantes de piezas estructurales, determinando si existen reparaciones anteriores o daños existentes y su nivel de afectación. Originalidad del sistema de identificación. Largueros de chasis y sus traviesas (para vehículos con chasis independiente).",
      observations:
        "El concepto de puntas de chasis en buen estado o buena reparación no garantiza que el vehículo presente las medidas de alineación dentro de los rangos normales, ya que estas dependen de los componentes del sistema de suspensión y estos elementos pueden tener deformaciones que no son perceptibles en la revisión visual. Las medidas de alineación cambian por deformaciones en el chasis para componentes como suspensión o cuna de motor y son imperceptibles en la revisión visual.",
      excludes:
        "Fisuras o daños en el ala superior de los largueros de chasis que no son identificables visualmente. No se realiza medición de cotas de habitáculo de pasajeros, distancia entre ejes ni cotas de parte baja o habitáculo de motor. No se realiza inspección a largueros, estructuras o uniones de chasis que no sean visibles sin necesidad de desmontar piezas del vehículo.",
    },
    {
      title: "Pintura",
      scope:
        "Validación visual y medición de cantidad de micras de espesor de pintura, identificando los defectos más comunes en la aplicación. La medición de micras de la pintura no está necesariamente relacionada con una reparación de la pieza.",
      excludes:
        "No se determina estado de pintura ajena a los componentes externos de la carrocería. No se determina la pintura de fábrica. No se realiza prueba diferente a la validación visual para validar la diferencia en el tono de la pintura. No se realiza prueba de imprimación de la pintura sobre el material.",
    },
    {
      title: "Accesorios",
      scope:
        "Inventario de accesorios adicionales al equipo de fábrica que se identifiquen visualmente sin necesidad de desmontar partes del vehículo. Valor estimado de los accesorios adicionales.",
      observations:
        "Los accesorios del vehículo solo se tendrán en cuenta para generar valor adicional al vehículo; no garantiza el correcto funcionamiento del vehículo con la ausencia o ineficiencia de los mismos. El peritaje se limita a una revisión de las partes originales del vehículo según el modelo.",
      excludes:
        "Estado funcional del accesorio adicional. Estado físico de elementos adaptados al vehículo de fabricación industrial o artesanal. No se consultan bases de datos comerciales para validar el valor del accesorio. El valor real de los accesorios depende de su estado de conservación, calidad y funcionamiento.",
    },
    {
      title: "Motor",
      scope:
        "Revisión visual de fugas y fluidos (refrigerante, aceites, combustible). Revisión de sistema de escape en baja (catalizador, silenciador y presilenciador), estado de radiador. Originalidad del sistema de identificación. Verificación de nivel de aceite y líquido refrigerante. Verificación de fugas de aceite en compresor de A/A (aire acondicionado). Estado de correa de accesorios.",
      observations:
        "Durante la inspección visual del habitáculo motor no se realiza ningún tipo de diagnóstico con el motor encendido, ni se valida la funcionalidad de las partes internas o externas del vehículo que no se puedan determinar con los instrumentos utilizados y sus limitaciones. El exceso de humo del escape, el color o sus propiedades no genera una afectación en el resultado del peritaje. Si se realiza prueba de compresión de motor, esta valida el estado aproximado de segmento de pistones, cilindros y empaques de culata, lo cual determina un diagnóstico inicial que puede ser complementado con pruebas específicas para determinar un diagnóstico preciso del estado del motor.",
      excludes:
        "Funcionamiento del sistema de control de emisiones contaminantes del motor. Nivel de desgaste o vida útil de la correa o cadena de repartición, guayas de acelerador, elementos internos del motor como cigüeñal, pistones, árbol de levas, válvulas, bloque de cilindros, bomba de aceite, volante. No se realiza análisis de ruidos normales de funcionamiento. Daños internos de elementos sellados como canister, catalizador, silenciador y presilenciador. Estado de complementos (electrónicos, mecánicos, estructurales, lujos) del conjunto del motor. No se valida la calidad de los fluidos como aceite de motor, aceite hidráulico, líquido refrigerante, líquido de limpiaparabrisas o aceite de caja.",
    },
    {
      title: "Carrocería",
      scope:
        "Revisión visual del estado de la tapicería (asientos, techo, carteras de puertas, millar, alfombra de piso). Revisión visual del estado de componentes de confort y seguridad (parasol, bandeja portaobjetos, consola central, guantera, funcionalidad de asientos delanteros). Funcionamiento de amortiguadores de baúl y capot. Identificar reparaciones o daños de lámina (oxidación, corrosión) y pintura de piezas exteriores de carrocería como puertas, capot, tapas, baúl, capota, guardafangos, costados, boceles, spoiler, vidrios y piezas plásticas. Descuadres mayores entre piezas de carrocería.",
      observations:
        "La oxidación de piezas del vehículo puede agravarse dramáticamente sin tratamiento adecuado.",
      excludes:
        'Ruidos en carrocería por desajuste de elementos de suspensión, frenos o elementos internos del habitáculo de pasajeros. Si el vehículo presenta protección en fibra de vidrio "bote" no se puede determinar el estado de las piezas ocultas por esta adaptación. Apertura de capot, puertas, baúl o tanque de combustible. Estado interno de puertas, empaques, guardapolvos, estructura de sillas, complementos de seguridad y confort. Estado de pisos de carrocería a nivel interno, estado de impermeabilización de piezas de carrocería oculta con el tapizado o guarnecidos plásticos. No se realiza prueba de sellado de carrocería ante ruidos o agua.',
    },
    {
      title: "Valores",
      scope:
        "Se entregan los valores comerciales y valores ponderados según FASECOLDA, Revista Motor y promedios de valores del mercado colombiano para determinar el valor ponderado, que no está sujeto a conveniencia del comprador o vendedor.",
      observations:
        "Estos valores comerciales del vehículo están sujetos a cambios mensuales y los valores ponderados sugeridos según estudios de Cesvi Colombia S.A. tienen en cuenta las depreciaciones aproximadas que pueda tener o no el vehículo.",
      excludes:
        "Estos valores han sido diseñados como una guía para el comprador / vendedor y no determinan un valor definitivo del vehículo para la venta o las depreciaciones. No se basan en cotizaciones reales de mano de obra o repuestos específicos para el vehículo.",
    },
    {
      title: "Testigos de alerta (tablero de instrumentos)",
      scope:
        "Verificación del correcto encendido y apagado de los testigos de falla del tablero de instrumentos. Los testigos del tablero deben encenderse al iniciar el vehículo y apagarse después de un tiempo no mayor a 10 segundos mientras el vehículo siga encendido. No se realiza un diagnóstico a los sistemas en los que tenga incidencia el testigo de falla.",
      excludes:
        "Diagnóstico de fallas indicadas por los testigos encendidos. Diagnóstico del no encendido de los testigos. Utilizar el escáner como medio de validación de códigos de falla dentro del vehículo.",
    },
  ];

  const clauseHtml = clauses
    .map((c) => {
      const parts: string[] = [];
      if (c.scope)
        parts.push(`<p><strong>Alcance del servicio:</strong> ${escapeHtml(c.scope)}</p>`);
      if (c.observations)
        parts.push(
          `<p><strong>Observaciones:</strong> ${escapeHtml(c.observations)}</p>`,
        );
      if (c.excludes)
        parts.push(
          `<p><strong>Este servicio no comprende:</strong> ${escapeHtml(c.excludes)}</p>`,
        );
      return `
        <div class="clause">
          <h3>${escapeHtml(c.title)}</h3>
          ${parts.join("")}
        </div>`;
    })
    .join("");

  return `
    <section class="service-considerations">
      <h2>Consideraciones y aclaraciones del servicio</h2>
      <p class="intro">
        Para todos los efectos se hace saber al cliente que ninguno de los resultados se produjo con base en el kilometraje del vehículo, por cuanto es un sistema de fácil vulneración, lo cual no es detectable por el servicio aquí prestado.
      </p>
      <h3 class="subhead">Cláusulas de limitación de responsabilidad de ${escapeHtml(upperName)}</h3>
      ${clauseHtml}
      <p class="closing">
        Este diagnóstico está basado exclusivamente en criterios técnicos y va con destino únicamente del cliente. Así mismo, no podrá ser utilizado como medio que garantice la comercialización ni relación contractual alguna con el vehículo; no sustituye las formalidades propias de cada contrato y por ende no puede usarse como requisito para el perfeccionamiento de ninguno de ellos. Por último, la inspección del vehículo no genera cobertura inmediata del mismo, ya que ${escapeHtml(brand.name || "Peritajes del Llano")} no es parte dentro de ningún contrato de seguro.
      </p>
    </section>
  `;
}

/**
 * Aviso legal estandarizado al final del PDF. El nombre de la empresa y el
 * teléfono de contacto se inyectan desde el branding (company_config),
 * así que cambiar la empresa en /empresa actualiza el disclaimer sin
 * tocar este archivo.
 */
function renderLegalDisclaimer(brand: CompanyBranding): string {
  const name = brand.name || "Peritajes del Llano";
  const upperName = name.toUpperCase();
  const phone = brand.phone || "";
  const phoneLine = phone
    ? `Cualquier inconformidad con el servicio y/o producto por favor comunicarse con la gerencia al ${escapeHtml(phone)}.`
    : `Cualquier inconformidad con el servicio y/o producto por favor comunicarse con la gerencia.`;
  return `
    <section class="legal-notice">
      <h2>Aviso legal</h2>
      <p>Este diagnóstico automotriz emitido por <strong>${escapeHtml(name)}</strong> está basado exclusivamente en criterios técnicos y va con destino únicamente del solicitante. Así mismo, no podrá ser usado como medio que garantice la comercialización ni relación contractual alguna del vehículo. No sustituye las formalidades propias de cada contrato y por ende no puede usarse como requisito para el perfeccionamiento de ninguno de ellos.</p>
      <p>Se hacen revisiones de "histórico vehicular" ante el Registro Único Nacional de Tránsito (RUNT) para reflejar la situación del vehículo hasta la fecha y hora de su expedición. El histórico vehicular no reemplaza el certificado de tradición que expiden los organismos de tránsito.</p>
      <p>Se precisa que la información suministrada es la que se encuentra en el RUNT al momento de la consulta y a su vez la información contenida es producto de los reportes efectuados por los diferentes Organismos de Tránsito, Directores territoriales, entre otros actores, quienes son responsables de reportar información al RUNT y su actualización. Por lo que la empresa que actúa bajo la marca <strong>${escapeHtml(upperName)}</strong> no asume responsabilidad alguna de la veracidad de la información.</p>
      <div class="legal-contact">${phoneLine}</div>
    </section>
  `;
}

function renderEvidenceGroup(
  title: string,
  items: { label: string; dataUrl: string }[],
): string {
  if (items.length === 0) return "";
  return `
    <div class="evidence-group">
      <div class="evidence-group-head">
        <span class="evidence-group-title">${escapeHtml(title)}</span>
        <span class="evidence-group-count">${items.length} foto${items.length === 1 ? "" : "s"}</span>
      </div>
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
    </div>
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
  return renderEvidenceGroup(title, items);
}

function renderMandatoryPhotosEvidence(data: InspectionData): string {
  const m = data.mandatoryPhotos;
  if (!m) return "";
  // Las 6 fotos obligatorias (incluidas las improntas) aplican a todos los
  // tipos de peritaje. Se renderizan las que tengan al menos una foto.
  const slots: {
    key: keyof InspectionData["mandatoryPhotos"];
    label: string;
  }[] = [
    { key: "diagonalFrontLeft", label: "Diagonal Delantera Izquierda" },
    { key: "diagonalRearRight", label: "Diagonal Trasera Derecha" },
    { key: "innerCabin", label: "Habitáculo Interno" },
    { key: "chassisNumber", label: "Número de Chasis" },
    { key: "engineNumber", label: "Número de Motor" },
    { key: "idPlate", label: "Número de Plaqueta" },
  ];
  const items: { label: string; dataUrl: string }[] = [];
  for (const slot of slots) {
    for (const img of m[slot.key] ?? []) {
      items.push({ label: slot.label, dataUrl: img.dataUrl });
    }
  }
  if (items.length === 0) return "";
  return renderEvidenceGroup("Fotografías obligatorias", items);
}

function renderExtraPhotosEvidence(data: InspectionData): string {
  const photos = data.extraPhotos ?? [];
  if (photos.length === 0) return "";
  const items = photos.map((img, idx) => ({
    label: img.caption?.trim() || `Adjunto ${idx + 1}`,
    dataUrl: img.dataUrl,
  }));
  return renderEvidenceGroup("Fotografías adicionales", items);
}

function renderDocumentEvidence(data: InspectionData): string {
  const docs = data.documents;
  if (!docs) return "";
  const items: { label: string; dataUrl: string }[] = [];
  for (const img of docs.ownershipCardFront ?? []) {
    items.push({ label: "Tarjeta de propiedad — Frente", dataUrl: img.dataUrl });
  }
  for (const img of docs.ownershipCardBack ?? []) {
    items.push({ label: "Tarjeta de propiedad — Reverso", dataUrl: img.dataUrl });
  }
  return renderEvidenceGroup("Tarjeta de propiedad / Licencia de tránsito", items);
}

function renderTireEvidence(data: InspectionData): string {
  const items = (data.tires?.images ?? []).map((img) => ({
    label: "Llantas",
    dataUrl: img.dataUrl,
  }));
  return renderEvidenceGroup("Llantas", items);
}

function tireTone(pct: number): "success" | "warning" | "danger" {
  if (pct <= 25) return "danger";
  if (pct <= 50) return "warning";
  return "success";
}

function renderTires(data: InspectionData, headingHtml: string): string {
  const t = data.tires;
  const positions: { key: string; label: string; pct: number }[] = [
    { key: "fl", label: "Delantera izq.", pct: t.frontLeft },
    { key: "fr", label: "Delantera der.", pct: t.frontRight },
    { key: "rl", label: "Trasera izq.", pct: t.rearLeft },
    { key: "rr", label: "Trasera der.", pct: t.rearRight },
    { key: "sp", label: "Repuesto", pct: t.spare },
  ];

  const worst = positions.reduce((acc, p) => (p.pct < acc.pct ? p : acc), positions[0]);
  const avg = Math.round(
    positions.reduce((sum, p) => sum + p.pct, 0) / positions.length,
  );
  const heroTone = tireTone(worst.pct);
  const heroLabel = heroTone === "danger"
    ? "Llantas críticas"
    : heroTone === "warning"
      ? "Desgaste considerable"
      : "Llantas en buen estado";
  const heroMeta = `Posición más crítica: ${worst.label} (${worst.pct}%) · Promedio ${avg}%`;

  const cells = positions
    .map((p) => {
      const tone = tireTone(p.pct);
      return `
        <div class="docs-cell tire-cell tone-${tone}">
          <span class="docs-label">${escapeHtml(p.label)}</span>
          <span class="tire-pct">${p.pct}%</span>
          <div class="tire-bar"><span class="tire-bar-fill tone-${tone}" style="width:${p.pct}%"></span></div>
        </div>`;
    })
    .join("");

  const imagesBlock = t.images.length > 0
    ? `<div class="image-grid" style="margin-top:4mm;">${t.images
        .map(
          (img) =>
            `<figure><img src="${img.dataUrl}" alt="Llanta" /><figcaption>Llanta</figcaption></figure>`,
        )
        .join("")}</div>`
    : "";

  const notesBlock = t.notes
    ? `
      <div class="proc-ok-card" style="margin-top:3mm;">
        <div class="proc-ok-head">
          <span class="proc-ok-icon">✎</span>
          <span class="proc-ok-count">Observaciones del perito</span>
        </div>
        <div class="proc-ok-note">${escapeHtml(t.notes)}</div>
      </div>`
    : "";

  return `
    <section class="docs-section proc-section">
      ${headingHtml}
      <div class="proc-hero tone-${heroTone}">
        <div class="proc-hero-text">
          <span class="proc-hero-label">${escapeHtml(heroLabel)}</span>
          <span class="proc-hero-meta">${escapeHtml(heroMeta)}</span>
        </div>
        <span class="proc-hero-pct">${avg}%</span>
      </div>
      <div class="docs-grid tire-grid">${cells}</div>
      ${notesBlock}
      ${imagesBlock}
    </section>
  `;
}

function renderAccessories(data: InspectionData, headingHtml: string): string {
  const list = data.accessories;
  if (list.length === 0) {
    return `
      <section class="docs-section proc-section">
        ${headingHtml}
        <p class="muted">Sin accesorios registrados.</p>
      </section>
    `;
  }

  const totalValue = list.reduce((sum, a) => {
    const n = Number(a.value);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  const anyValue = totalValue > 0;

  const count = `${list.length} accesorio${list.length === 1 ? "" : "s"} registrado${list.length === 1 ? "" : "s"}`;
  const heroLabel = anyValue
    ? `${count} · valor total estimado ${fmtCop(String(totalValue))}`
    : count;

  const rows = list
    .map((a) => {
      const n = Number(a.value);
      const val = Number.isFinite(n) && n > 0 ? escapeHtml(fmtCop(a.value)) : "—";
      return `
        <tr>
          <td>${escapeHtml(a.name)}${a.notes ? `<div class="accessory-notes">${escapeHtml(a.notes)}</div>` : ""}</td>
          <td class="num">${val}</td>
        </tr>`;
    })
    .join("");

  return `
    <section class="docs-section proc-section">
      ${headingHtml}
      <div class="proc-hero tone-muted">
        <div class="proc-hero-text">
          <span class="proc-hero-label">${escapeHtml(heroLabel)}</span>
        </div>
        <span class="proc-hero-pct">${list.length}</span>
      </div>
      <table class="value-table accessory-table">
        <thead>
          <tr><th>Accesorio</th><th class="num">Valor estimado</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        ${
          anyValue
            ? `<tfoot><tr><td>Valor total estimado</td><td class="num">${escapeHtml(fmtCop(String(totalValue)))}</td></tr></tfoot>`
            : ""
        }
      </table>
    </section>
  `;
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

function sectionHeading(num: number, title: string): string {
  const numStr = String(num).padStart(2, "0");
  return `<div class="section-h"><span class="section-num">${numStr}</span><span class="section-title">${escapeHtml(title)}</span></div>`;
}

function fmtCop(raw: string | undefined): string {
  if (!raw) return "—";
  const n = Number(String(raw).replace(/[^\d-]/g, ""));
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

function claimsTone(value: string | undefined): "success" | "warning" | "danger" | "muted" {
  const v = (value ?? "").trim().toUpperCase();
  if (v === "SÍ" || v === "SI") return "warning";
  if (v === "NO") return "success";
  return "muted";
}

function renderDocumentation(
  data: InspectionData,
  headingHtml: string,
): string {
  const v = data.vehicle;
  const runt = data.verifik?.runt?.data;
  const ig = runt?.informacionGeneral;

  const licenseNumber = ig?.noLicenciaTransito?.trim() || "";

  const activeSoat = pickActiveSoat(runt?.soat);
  const soatBlock = activeSoat
    ? (() => {
        const st = soatStatus(activeSoat);
        const entity = activeSoat.entidadExpideSoat
          ? titleCase(activeSoat.entidadExpideSoat)
          : "";
        return `
          <div class="docs-card tone-${st.tone}">
            <span class="docs-label">SOAT</span>
            <span class="docs-status tone-${st.tone}">${escapeHtml(st.label)}</span>
            <span class="docs-meta">
              No. ${escapeHtml(activeSoat.noPoliza || "—")}<br/>
              Vence ${escapeHtml(fmtRuntDate(activeSoat.fechaVencimiento))}${entity ? `<br/>${escapeHtml(entity)}` : ""}
            </span>
          </div>`;
      })()
    : `<div class="docs-card tone-muted">
         <span class="docs-label">SOAT</span>
         <span class="docs-status tone-muted">Sin póliza</span>
         <span class="docs-meta">No registrada en RUNT</span>
       </div>`;

  const tecno = runt?.tecnoMecanica?.[0];
  const rtm = rtmStatus(tecno);
  const rtmBlock = `
    <div class="docs-card tone-${rtm.tone}">
      <span class="docs-label">Rev. tecnomecánica</span>
      <span class="docs-status tone-${rtm.tone}">${escapeHtml(rtm.label)}</span>
    </div>`;

  const claimsLabel = v.hasClaimsHistory || "—";
  const cTone = claimsTone(v.hasClaimsHistory);

  // Valoración comercial — el perito la digita (campos obligatorios del wizard).
  const fasecoldaVal = v.fasecoldaValue?.trim() || "";
  const llanoVal = v.llanoValue?.trim() || "";
  const valuationBlock = `
      <div class="value-subhead">Valoración comercial</div>
      <div class="value-duo">
        <div class="value-hero${fasecoldaVal ? "" : " tone-muted"}">
          <div class="value-hero-text">
            <span class="value-hero-label">Valor Fasecolda</span>
            <span class="value-hero-meta">Código ${esc(v.fasecoldaCode?.trim() || "—")}</span>
          </div>
          <span class="value-hero-amount${fasecoldaVal ? "" : " muted"}">${fasecoldaVal ? escapeHtml(fmtCop(fasecoldaVal)) : "—"}</span>
        </div>
        <div class="value-hero tone-brand${llanoVal ? "" : " tone-muted"}">
          <div class="value-hero-text">
            <span class="value-hero-label">Valor Peritajes del Llano</span>
            <span class="value-hero-meta">Avalúo del perito</span>
          </div>
          <span class="value-hero-amount${llanoVal ? "" : " muted"}">${llanoVal ? escapeHtml(fmtCop(llanoVal)) : "—"}</span>
        </div>
      </div>`;

  return `
    <section class="docs-section">
      ${headingHtml}
      <p class="muted" style="margin-bottom: 8pt;">
        Información administrativa del vehículo: propietario, papeles legales, póliza particular y reporte de siniestros.
      </p>

      <div class="docs-grid">
        <div class="docs-cell">
          <span class="docs-label">Propietario</span>
          <span class="docs-value">${esc(v.owner)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Documento / NIT</span>
          <span class="docs-value mono">${esc(v.ownerDocument)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Teléfono</span>
          <span class="docs-value mono">${esc(v.ownerPhone)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Tarjeta de Propiedad</span>
          <span class="docs-value">${esc(v.propertyCardStatus)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">No. Licencia de Tránsito</span>
          <span class="docs-value mono">${esc(licenseNumber)}</span>
        </div>
      </div>

      <div class="docs-cards">
        ${soatBlock}
        ${rtmBlock}
      </div>

      <div class="docs-grid">
        <div class="docs-cell">
          <span class="docs-label">Aseguradora (todo riesgo)</span>
          <span class="docs-value">${esc(v.insurer)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Reporta siniestros</span>
          <span class="docs-value tone-${cTone}">${escapeHtml(claimsLabel)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Número de siniestros</span>
          <span class="docs-value">${esc(v.claimsCount)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Valor de reclamaciones</span>
          <span class="docs-value">${escapeHtml(fmtCop(v.claimsValue))}</span>
        </div>
      </div>

      ${valuationBlock}
    </section>
  `;
}

/* -----------------------------------------------------------
 *  Sección 3: Valor del vehículo
 * --------------------------------------------------------- */

function fmtPct(raw: string | undefined): string {
  if (!raw) return "—";
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return `${raw}%`;
  return `${n}%`;
}

const FASECOLDA_ACCESSORIES: { key: keyof FasecoldaData; label: string }[] = [
  { key: "airbags", label: "Airbags" },
  { key: "absShow", label: "Frenos ABS" },
  { key: "airconditioningShow", label: "Aire acondicionado" },
  { key: "typeAirConditioning", label: "Tipo A/C" },
  { key: "brakes", label: "Frenos" },
  { key: "electricChairs", label: "Sillas eléctricas" },
  { key: "electricGlasses", label: "Vidrios eléctricos" },
  { key: "electricMirrors", label: "Espejos eléctricos" },
  { key: "explorersShow", label: "Exploradoras" },
  { key: "reverseCameraShow", label: "Cámara de reversa" },
  { key: "sensorsShow", label: "Sensores" },
  { key: "sunroofShow", label: "Sunroof" },
  { key: "upholsteryLeatherShow", label: "Tapicería en cuero" },
  { key: "tachometer", label: "Tacómetro" },
  { key: "typeBox", label: "Tipo de caja" },
  { key: "typeAddress", label: "Tipo de dirección" },
  { key: "typeHeadlights", label: "Tipo de luces" },
  { key: "rearSuspension", label: "Suspensión trasera" },
  { key: "foodSystem", label: "Sistema de alimentación" },
];

function fmtAccessoryValue(raw: unknown): { label: string; tone: StatusTone } {
  if (raw === undefined || raw === null) return { label: "—", tone: "muted" };
  const s = String(raw).trim();
  if (!s) return { label: "—", tone: "muted" };
  const u = s.toUpperCase();
  if (u === "SI" || u === "SÍ") return { label: "Sí", tone: "success" };
  if (u === "NO") return { label: "No", tone: "muted" };
  return { label: titleCase(s), tone: "success" };
}

function renderVehicleValue(
  data: InspectionData,
  headingHtml: string,
): string {
  const v = data.vehicle;
  const fc = data.verifik?.fasecolda;
  const fcData = fc?.data;
  const valueModel = Array.isArray(fcData?.valueModel) ? fcData!.valueModel : [];
  const sortedValues = [...valueModel].sort(
    (a, b) => Number(b.modelo) - Number(a.modelo),
  );
  const latestCop = fc ? fasecoldaLatestValueCop(fc) : null;
  const latestRow = sortedValues[0];

  const homoloCode = fcData?.homoloCode?.trim() || "";
  const bcppCode = fcData?.bcpp?.trim() || "";

  const queriedAt = data.verifik?.queriedAt
    ? new Date(data.verifik.queriedAt).toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "";

  const heroBlock = latestCop !== null
    ? `
      <div class="value-hero">
        <div class="value-hero-text">
          <span class="value-hero-label">Valor comercial FASECOLDA</span>
          <span class="value-hero-meta">Modelo ${escapeHtml(String(latestRow?.modelo ?? "—"))}${latestRow?.estado ? ` · ${escapeHtml(titleCase(latestRow.estado))}` : ""}</span>
        </div>
        <span class="value-hero-amount">${escapeHtml(fmtCop(String(latestCop)))}</span>
      </div>`
    : `
      <div class="value-hero tone-muted">
        <div class="value-hero-text">
          <span class="value-hero-label">Valor comercial FASECOLDA</span>
          <span class="value-hero-meta">No disponible — la consulta a Verifik no devolvió valoraciones.</span>
        </div>
        <span class="value-hero-amount muted">—</span>
      </div>`;

  const historyTable = sortedValues.length > 1
    ? `
      <div class="value-history">
        <div class="value-history-label">Histórico de valor por modelo</div>
        <table class="value-table">
          <thead>
            <tr><th>Modelo</th><th>Estado</th><th class="num">Valor</th></tr>
          </thead>
          <tbody>
            ${sortedValues
              .map(
                (row) => `
              <tr>
                <td>${escapeHtml(String(row.modelo))}</td>
                <td>${escapeHtml(row.estado ? titleCase(row.estado) : "—")}</td>
                <td class="num">${escapeHtml(fmtCop(String(row.valor * 1000)))}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const accessoryCells = FASECOLDA_ACCESSORIES.map(({ key, label }) => {
    const raw = fcData?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") return "";
    const { label: valLabel, tone } = fmtAccessoryValue(raw);
    return `
      <div class="docs-cell">
        <span class="docs-label">${escapeHtml(label)}</span>
        <span class="docs-value tone-${tone}">${escapeHtml(valLabel)}</span>
      </div>`;
  })
    .filter((s) => s.length > 0)
    .join("");

  const accessoriesBlock = accessoryCells
    ? `
      <div class="value-subhead">Accesorios y equipamiento de fábrica</div>
      <div class="docs-grid">${accessoryCells}</div>`
    : "";

  const sourceFooter = fc && queriedAt
    ? `<div class="legal-source">Datos FASECOLDA consultados vía Verifik el ${escapeHtml(queriedAt)}</div>`
    : !fc
    ? `<div class="legal-source">FASECOLDA no consultado — los códigos y valores deben digitarse manualmente.</div>`
    : "";

  return `
    <section class="docs-section value-section">
      ${headingHtml}
      <p class="muted" style="margin-bottom: 8pt;">
        Valor comercial FASECOLDA, códigos de identificación y depreciación calculada por el perito.
      </p>

      ${heroBlock}

      <div class="docs-grid">
        <div class="docs-cell">
          <span class="docs-label">Código FASECOLDA</span>
          <span class="docs-value mono">${esc(homoloCode)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Código BCPP</span>
          <span class="docs-value mono">${esc(bcppCode)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Código Sibga</span>
          <span class="docs-value mono">${esc(v.sibgaCode)}</span>
        </div>
        <div class="docs-cell">
          <span class="docs-label">Depreciación</span>
          <span class="docs-value">${escapeHtml(fmtPct(v.depreciationPct))}</span>
        </div>
        ${
          v.depreciationNotes
            ? `
        <div class="docs-cell" style="grid-column: 1 / -1;">
          <span class="docs-label">Notas de depreciación</span>
          <span class="docs-value">${escapeHtml(v.depreciationNotes)}</span>
        </div>`
            : ""
        }
      </div>

      ${historyTable}

      ${accessoriesBlock}

      ${sourceFooter}
    </section>
  `;
}

export type PdfMode = "executive" | "detailed";

/** Tile base de la marca de agua de fondo: el ícono de herramientas (llave)
 *  en slate muy tenue, 48×48, estilo papel de seguridad. */
const WRENCH_WATERMARK_TILE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDQ4IDQ4Ij48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMiwxMikiIGZpbGw9IiMzMzQxNTUiPjxwYXRoIGQ9Ik01LjMyOTQzIDMuMjcxNThDNi41NjI1MiAyLjgzMzIgNy45OTIzIDMuMTA3NDkgOC45NzkyNyA0LjA5NDQ2QzkuOTY2NTIgNS4wODE3MSAxMC4yNDA3IDYuNTEyMDIgOS44MDE3OCA3Ljc0NTM1TDIwLjY0NjUgMTguNTkwMkwxOC41MjUyIDIwLjcxMTVMNy42NzkzNiA5Ljg2NzA5QzYuNDQ2MjcgMTAuMzA1NSA1LjAxNjQ5IDEwLjAzMTIgNC4wMjk1MiA5LjA0NDIxQzMuMDQyMjcgOC4wNTY5NiAyLjc2ODEgNi42MjY2NSAzLjIwNzAxIDUuMzkzMzJMNS40NDM3MyA3LjYzQzYuMDI5NTIgOC4yMTU3OCA2Ljk3OTI3IDguMjE1NzggNy41NjUwNSA3LjYzQzguMTUwODQgNy4wNDQyMSA4LjE1MDg0IDYuMDk0NDYgNy41NjUwNSA1LjUwODY4TDUuMzI5NDMgMy4yNzE1OFpNMTUuNjk2OCA1LjE1NTEyTDE4Ljg3ODggMy4zODczNkwyMC4yOTMgNC44MDE1N0wxOC41MjUyIDcuOTgzNTVMMTYuNzU3NCA4LjMzNzFMMTQuNjM2MSAxMC40NTg0TDEzLjIyMTkgOS4wNDQyMUwxNS4zNDMyIDYuOTIyODlMMTUuNjk2OCA1LjE1NTEyWk04LjYyNTcyIDEyLjkzMzNMMTAuNzQ3IDE1LjA1NDZMNS43OTcyOSAyMC4wMDQ0QzUuMjExNSAyMC41OTAyIDQuMjYxNzUgMjAuNTkwMiAzLjY3NTk3IDIwLjAwNDRDMy4xMjQ2NCAxOS40NTMgMy4wOTIyMSAxOC41NzkzIDMuNTc4NjcgMTcuOTlMMy42NzU5NyAxNy44ODNMOC42MjU3MiAxMi45MzMzWiIvPjwvZz48L3N2Zz4=";

/** Estilo inline para la capa `.bg-watermark`. Si la organización tiene logo
 *  (ya pre-padeado por `buildWatermarkLogo` en pdf-render), devuelve un mosaico
 *  de DOS capas que intercala el ícono de herramientas y el logo en damero
 *  diagonal: la llave en la sublattice (0,0) y el logo desfasado media celda
 *  (26pt en ambos ejes). Sin logo, cae al tile clásico de solo herramientas.
 *
 *  El logo va como capa de background CSS independiente (raster directo) y NO
 *  embebido dentro del SVG: Chromium NO rinde `<image href="data:...">` cuando
 *  el SVG se usa como `background-image` (probado). Los data URLs van sin
 *  comillas en `url()` — base64 no contiene espacios ni paréntesis — para no
 *  chocar con las comillas del atributo `style`. */
function buildBgWatermarkStyle(watermarkLogoDataUrl: string | null): string {
  if (!watermarkLogoDataUrl) {
    return `background-image:url(${WRENCH_WATERMARK_TILE});background-size:52pt 52pt;`;
  }
  return (
    `background-image:url(${WRENCH_WATERMARK_TILE}),url(${watermarkLogoDataUrl});` +
    `background-position:0 0,26pt 26pt;` +
    `background-size:52pt 52pt,52pt 52pt;`
  );
}

export function renderReportHtml(
  data: InspectionData,
  report: RiskReport,
  options?: {
    mode?: PdfMode;
    branding?: CompanyBranding;
    /** Firma estática del perito responsable (data URL). Si no se pasa o es
     *  null, no se renderiza la imagen de firma. */
    inspectorSignatureDataUrl?: string | null;
    /** Render fotorealista del vehículo generado por IA (data URL). Si está
     *  set, aparece como banner visual en la portada arriba de la tabla de
     *  datos. Si es null, la portada cae al layout solo-tablas. */
    vehicleRenderDataUrl?: string | null;
    /** URL pública del peritaje (e.g. https://app/r/xyz). Si está set, se
     *  embebe el QR + watermark de verificación. */
    verificationUrl?: string | null;
    /** Data URL del QR pre-generado para verificationUrl. */
    verificationQrDataUrl?: string | null;
    /** Consecutivo oficial asignado al finalizar (ej. PER-2026-0001). Si no
     *  viene, el PDF cae al docNumber derivado de placa+fecha — útil para
     *  previews de borradores que todavía no se finalizan. */
    reportNumber?: string | null;
    /** Previsualización: el peritaje aún no está finalizado. Estampa una marca
     *  de agua "PREVISUALIZACIÓN" en todas las páginas y un banner en la
     *  portada, para que el documento no pueda confundirse con el oficial. */
    preview?: boolean;
    /** Logo de la organización ya pre-procesado para la marca de agua de fondo
     *  (centrado en lienzo transparente con margen). Si está set, el mosaico
     *  de `.bg-watermark` intercala el ícono de herramientas con el logo en
     *  damero diagonal. Si es null/undefined, cae al tile de solo herramientas.
     *  Lo genera `buildWatermarkLogo` en pdf-render (requiere sharp, async). */
    watermarkLogoDataUrl?: string | null;
  },
): string {
  // `options.mode` se acepta en el tipo por compatibilidad con callers
  // existentes, pero ya no diferencia el render: ejecutivo y detallado
  // producen el mismo PDF (incluyendo fotos obligatorias y documentos).
  const v = data.vehicle;
  const brand = options?.branding ?? getCompanyBranding();
  const inspectorSignatureDataUrl = options?.inspectorSignatureDataUrl ?? null;
  const vehicleRenderDataUrl = options?.vehicleRenderDataUrl ?? null;
  const verificationUrl = options?.verificationUrl ?? null;
  const verificationQrDataUrl = options?.verificationQrDataUrl ?? null;
  const verifiable = !!(verificationUrl && verificationQrDataUrl);
  const preview = options?.preview ?? false;
  const bgWatermarkStyle = buildBgWatermarkStyle(
    options?.watermarkLogoDataUrl ?? null,
  );
  const docNumber =
    options?.reportNumber || buildDocumentNumber(v.plate, v.date);
  const kindDef = PERITAJE_KINDS[data.kind] ?? PERITAJE_KINDS.plus;
  const vehicleType = data.vehicleType ?? FALLBACK_VEHICLE_TYPE;
  const vehicleTypeDef =
    VEHICLE_TYPES[vehicleType] ?? VEHICLE_TYPES[FALLBACK_VEHICLE_TYPE];
  const activeSectionIds = new Set(activeSectionsFor(data.kind, vehicleType));
  const components = componentsForKind(data.kind);
  const bodyworkSectionForPdf = bodyworkSectionFor(vehicleType);

  // El grupo "Compresión" del motor es dinámico: el perito agrega cilindros uno
  // a uno y se guardan en data.engineCompression. Para que las funciones de
  // render que iteran section.groups[].items los muestren igual que el resto,
  // inyectamos los cilindros como items virtuales dentro del grupo compresión
  // y mergeamos sus entries en el record de engine. Es una transformación de
  // solo-lectura para el PDF — no toca el storage.
  const cylinders = data.engineCompression ?? [];
  const engineSectionForPdf: InspectionSectionDef = {
    ...ENGINE_SECTION,
    groups: ENGINE_SECTION.groups.map((g) =>
      g.id === "compression"
        ? {
            ...g,
            items: cylinders.map((c) => ({
              id: c.id,
              label: c.label,
              kind: "mechanical" as const,
            })),
          }
        : g,
    ),
  };
  const engineDataForPdf: Record<string, InspectionEntry> = { ...data.engine };
  for (const c of cylinders) {
    engineDataForPdf[c.id] = {
      status: c.status,
      notes: c.notes ?? "",
      images: c.images ?? [],
    };
  }

  const allSections: {
    sectionId: SectionId;
    title: string;
    def: InspectionSectionDef;
    data: Record<string, InspectionEntry>;
  }[] = [
    { sectionId: "bodywork", title: "Carrocería", def: bodyworkSectionForPdf, data: data.bodywork },
    { sectionId: "chassis", title: "Chasis y estructura", def: CHASSIS_SECTION, data: data.chassis },
    { sectionId: "suspension", title: "Suspensión", def: SUSPENSION_SECTION, data: data.suspension },
    { sectionId: "engine", title: "Motor", def: engineSectionForPdf, data: engineDataForPdf },
    { sectionId: "electrical", title: "Sistema eléctrico", def: ELECTRICAL_SECTION, data: data.electrical },
    { sectionId: "comfort", title: "Interior delantero", def: COMFORT_SECTION, data: data.comfort },
    { sectionId: "leaks", title: "Fugas de fluidos", def: LEAKS_SECTION, data: data.leaks },
    { sectionId: "roadTest", title: "Prueba de ruta", def: ROAD_TEST_SECTION, data: data.roadTest },
  ];
  const sections = allSections.filter((s) => activeSectionIds.has(s.sectionId));
  // La revisión general del motor no va en ningún tipo, pero la prueba de
  // compresión es un componente gateado (Plus). Si está activa y hay cilindros,
  // la insertamos como sección propia (sin los grupos generales del motor),
  // justo después de suspensión (donde iría el motor).
  if (components.compression && cylinders.length > 0) {
    const compressionSection: (typeof allSections)[number] = {
      sectionId: "engine",
      title: "Compresión del motor",
      def: {
        id: "engine",
        label: "Compresión del motor",
        groups: [
          {
            id: "compression",
            label: "Compresión por cilindro",
            items: cylinders.map((c) => ({
              id: c.id,
              label: c.label,
              kind: "mechanical" as const,
            })),
          },
        ],
      },
      data: engineDataForPdf,
    };
    const insertAt = sections.findIndex((s) => s.sectionId === "suspension");
    if (insertAt >= 0) sections.splice(insertAt + 1, 0, compressionSection);
    else sections.push(compressionSection);
  }
  const showTires = activeSectionIds.has("tires");
  const showAccessories = activeSectionIds.has("accessories");
  const roadTestSkipped = data.roadTestSkipped === true;

  const health = computeHealth(data);
  const pillarReport = computePillars(health, report);
  const findingsByLevel = {
    critical: report.findings.filter((f) => f.level === "critical"),
    warning: report.findings.filter((f) => f.level === "warning"),
    info: report.findings.filter((f) => f.level === "info"),
  };

  const conditionLabel = findingDisplay(data.conclusion.generalCondition).label;

  let sectionN = 0;
  const heading = (title: string) => sectionHeading(++sectionN, title);

  // Renderiza una sección: si es prueba de ruta y el perito la marcó como
  // "No aplica", reemplazamos la tabla con una nota corta para que el
  // cliente vea explícitamente que la etapa se omitió por decisión técnica.
  const renderOneSection = (s: typeof allSections[number]): string => {
    if (s.sectionId === "roadTest" && roadTestSkipped) {
      return `
        ${heading(s.title)}
        <p class="muted" style="margin: 4pt 0 12pt 0;">
          No aplica — el perito determinó que no se realizó prueba de ruta para este vehículo.
        </p>
      `;
    }
    return renderSectionDualTable(
      heading(s.title),
      s.def,
      s.data,
      health.bySection[s.sectionId],
      s.sectionId,
      vehicleType,
    );
  };

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

  /* Unified numbered section header — used across the whole document. */
  .section-h {
    display: flex;
    align-items: baseline;
    gap: 9pt;
    margin: 14pt 0 8pt 0;
    padding-bottom: 5pt;
    border-bottom: 1px solid #e2e8f0;
    page-break-after: avoid;
  }
  .section-h .section-num {
    display: inline-block;
    background: #0f172a;
    color: #ffffff;
    font-size: 9pt;
    font-weight: 800;
    padding: 2.5pt 7pt 2.8pt;
    border-radius: 3pt;
    letter-spacing: 1.4px;
    line-height: 1;
    flex-shrink: 0;
    transform: translateY(-1pt);
  }
  .section-h .section-title {
    flex: 1;
    font-size: 14pt;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.2px;
  }
  p { margin: 0 0 6pt 0; }
  .muted { color: #475569; font-size: 9.5pt; }

  .cover { padding-top: 0; }
  /* Vehicle hero: license-plate visual + vehicle info + risk pill */
  .vehicle-hero {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 14pt;
    align-items: center;
    margin-top: 4mm;
    padding: 2pt 0;
  }
  .plate-frame {
    background: #FDE68A;
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
  /* Render fotorealista del vehículo generado por IA — banner visual en la
   * portada para que la primera página no sea solo tablas. Color neutro:
   * el color real va en la tabla de datos del vehículo. */
  .vehicle-render-banner {
    margin-top: 5mm;
    padding: 4mm 5mm;
    border: 1pt solid #e2e8f0;
    border-radius: 5pt;
    background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    page-break-inside: avoid;
  }
  .vehicle-render-banner img {
    display: block;
    max-width: 100%;
    max-height: 62mm;
    object-fit: contain;
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
    margin-top: 4mm;
    display: flex;
    flex-direction: column;
    gap: 5mm;
  }
  .vehicle-specs > .section-h:first-child { margin-top: 0; }
  .vehicle-specs .spec-group-title {
    display: flex;
    align-items: center;
    gap: 8pt;
    margin-bottom: 3mm;
  }
  .vehicle-specs .spec-group-title span {
    font-size: 8pt;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 1.4px;
  }
  .vspec-card {
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    overflow: hidden;
    font-size: 9pt;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .vspec-cols {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #e2e8f0;
  }
  .vspec-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 4pt 0;
  }
  .vspec-col:first-child {
    border-right: 1px solid #f1f5f9;
  }
  .vspec-item {
    display: flex;
    flex-direction: column;
    gap: 0.5pt;
    padding: 2pt 8pt;
  }
  .vsl {
    font-size: 7.5pt;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .vsv {
    font-size: 9pt;
    font-weight: 500;
    color: #0f172a;
  }
  .vsv.mono {
    font-family: "Roboto Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace;
    font-size: 8.5pt;
    letter-spacing: 0.3px;
  }
  .vspec-ids {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
  }
  .vspec-id-item {
    display: flex;
    flex-direction: column;
    gap: 1pt;
    padding: 3pt 8pt;
    border-right: 1px solid #e2e8f0;
  }
  .vspec-id-item:last-child { border-right: none; }
  .vspec-owner {
    display: flex;
    align-items: baseline;
    gap: 8pt;
    padding: 3pt 8pt;
    background: #f8fafc;
  }
  .vspec-owner-val {
    font-size: 9.5pt;
    font-weight: 700;
    color: #0f172a;
  }
  .vspec-owner-doc {
    font-size: 8pt;
    font-weight: 400;
    color: #64748b;
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
    font-size: 11.5pt;
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
    gap: 2mm 6mm;
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
  .docs-section .section-h { margin-top: 0; }
  .docs-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2.5mm 5mm;
    margin: 3mm 0;
    padding: 4mm 5mm;
    border: 1px solid #e2e8f0;
    border-radius: 5pt;
    background: #f8fafc;
  }
  .docs-cell {
    display: flex;
    flex-direction: column;
    gap: 1pt;
  }
  .docs-label {
    font-size: 7pt;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .docs-value {
    font-size: 9.8pt;
    font-weight: 500;
    color: #0f172a;
    line-height: 1.25;
  }
  .docs-value.mono {
    font-size: 9pt;
    font-family: "Roboto Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace;
    letter-spacing: 0.3px;
  }
  .docs-value.tone-success { color: #166534; font-weight: 700; }
  .docs-value.tone-warning { color: #92400e; font-weight: 700; }
  .docs-value.tone-danger  { color: #991b1b; font-weight: 700; }
  .docs-value.tone-muted   { color: #64748b; }
  .docs-cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 3mm;
    margin: 3mm 0;
  }
  .docs-card {
    display: flex;
    flex-direction: column;
    gap: 1pt;
    padding: 5pt 10pt 6pt 11pt;
    border: 1px solid #e2e8f0;
    border-left: 3pt solid #94a3b8;
    border-radius: 4pt;
    background: #f8fafc;
  }
  .docs-card.tone-success { border-left-color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; }
  .docs-card.tone-warning { border-left-color: #f59e0b; background: #fffbeb; border-color: #fde68a; }
  .docs-card.tone-danger  { border-left-color: #dc2626; background: #fef2f2; border-color: #fecaca; }
  .docs-card.tone-muted   { border-left-color: #94a3b8; background: #f8fafc; border-color: #e2e8f0; }
  .docs-status {
    font-size: 10.5pt;
    font-weight: 700;
    letter-spacing: -0.2px;
    line-height: 1.1;
    margin-top: 1pt;
  }
  .docs-status.tone-success { color: #166534; }
  .docs-status.tone-warning { color: #92400e; }
  .docs-status.tone-danger  { color: #991b1b; }
  .docs-status.tone-muted   { color: #64748b; }
  .docs-meta {
    font-size: 7.8pt;
    color: #475569;
    line-height: 1.35;
    margin-top: 1pt;
  }
  /* Sección 3 — Valor del vehículo */
  .value-section { margin-top: 8mm; }
  .value-section .section-h { margin-top: 0; }
  .value-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12pt;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-left: 4pt solid #16a34a;
    border-radius: 5pt;
    padding: 9pt 14pt;
    margin: 3mm 0 4mm;
  }
  .value-hero.tone-muted {
    background: #f8fafc;
    border-color: #e2e8f0;
    border-left-color: #94a3b8;
  }
  .value-hero-text { display: flex; flex-direction: column; gap: 2pt; }
  .value-hero-label {
    font-size: 8pt;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #475569;
    font-weight: 700;
  }
  .value-hero-meta { font-size: 8.8pt; color: #64748b; }
  .value-hero-amount {
    font-size: 22pt;
    font-weight: 800;
    color: #166534;
    letter-spacing: -0.5px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .value-hero-amount.muted { color: #94a3b8; }
  .value-duo {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8pt;
    margin: 3mm 0 4mm;
  }
  .value-duo .value-hero {
    margin: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 6pt;
  }
  .value-duo .value-hero-amount { font-size: 18pt; }
  .value-hero.tone-brand {
    background: #eff6ff;
    border-color: #bfdbfe;
    border-left-color: #2563eb;
  }
  .value-hero.tone-brand .value-hero-amount { color: #1d4ed8; }
  .value-history { margin: 4mm 0 3mm; }
  .value-history-label {
    font-size: 8pt;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
    margin-bottom: 2mm;
  }
  .value-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    border: 1px solid #e2e8f0;
    border-radius: 5pt;
    overflow: hidden;
  }
  .value-table thead th {
    background: #f1f5f9;
    color: #475569;
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    text-align: left;
    padding: 5pt 9pt;
    border-bottom: 1px solid #e2e8f0;
  }
  .value-table thead th.num,
  .value-table tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .value-table tbody td {
    padding: 5pt 9pt;
    border-bottom: 1px solid #f1f5f9;
    color: #0f172a;
  }
  .value-table tbody tr:last-child td { border-bottom: none; }
  .value-table tfoot { display: table-footer-group; }
  .value-table tfoot td {
    padding: 6pt 9pt;
    border-top: 1.5px solid #e2e8f0;
    background: #f8fafc;
    font-weight: 700;
    color: #0f172a;
  }
  .value-table thead { display: table-header-group; }
  .value-table tbody tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .value-subhead {
    font-size: 8pt;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
    margin: 4mm 0 2mm;
  }
  .doc-footer {
    margin-top: 14mm;
    border-top: 1px solid #e2e8f0;
    padding-top: 4mm;
    color: #64748b;
    font-size: 8.5pt;
    display: flex;
    justify-content: space-between;
    gap: 8pt;
    flex-wrap: wrap;
    page-break-inside: avoid;
  }

  /* Watermark — logo centrado en todas las páginas */
  .watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    width: 200pt;
    height: 200pt;
    object-fit: contain;
    opacity: 0.06;
    pointer-events: none;
    z-index: 0;
  }

  /* Marca de agua de fondo — mosaico muy tenue en todas las páginas (estilo
     papel de seguridad). El tile va inline en el atributo style del div: solo
     el ícono de herramientas, o herramientas + logo de la org intercalados en
     damero (ver buildBgWatermarkStyle). */
  .bg-watermark {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-repeat: repeat;
    opacity: 0.05;
    pointer-events: none;
    z-index: 0;
  }

  /* Marca de agua de PREVISUALIZACIÓN — texto diagonal repetido en cada página
     mientras el peritaje no esté finalizado. Imposible de confundir con el
     documento oficial. */
  .preview-watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 64pt;
    font-weight: 800;
    letter-spacing: 6pt;
    color: #dc2626;
    opacity: 0.10;
    white-space: nowrap;
    pointer-events: none;
    z-index: 0;
  }

  /* Banner de aviso de previsualización en la portada */
  .preview-banner {
    border: 1.5pt dashed #dc2626;
    background: #fef2f2;
    color: #b91c1c;
    border-radius: 6pt;
    padding: 8pt 12pt;
    margin-bottom: 6mm;
    page-break-inside: avoid;
  }
  .preview-banner .pb-title {
    font-size: 11pt;
    font-weight: 800;
    letter-spacing: 1pt;
    text-transform: uppercase;
  }
  .preview-banner .pb-text {
    font-size: 8.5pt;
    margin-top: 2pt;
    color: #7f1d1d;
  }

  /* Branded header on the cover page */
  .brand-header {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12pt;
    align-items: flex-start;
    padding: 7pt 0 10pt;
    border-bottom: 2pt solid #0f172a;
    margin-bottom: 4mm;
    page-break-inside: avoid;
  }
  .brand-header .brand-logo {
    width: 48pt;
    height: 48pt;
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
  /* Concepto global — el titular del reporte en la portada. Grande y a color
     para que sea lo primero que el cliente identifique. */
  .concepto-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4pt solid #94a3b8;
    border-radius: 6pt;
    padding: 7pt 11pt;
    margin: 6pt 0 5pt;
  }
  .concepto-banner.tone-success { border-color: #bbf7d0; border-left-color: #16a34a; background: #f0fdf4; }
  .concepto-banner.tone-warning { border-color: #fde68a; border-left-color: #f59e0b; background: #fffbeb; }
  .concepto-banner.tone-danger  { border-color: #fecaca; border-left-color: #dc2626; background: #fef2f2; }
  .concepto-banner.tone-muted   { border-color: #e2e8f0; border-left-color: #94a3b8; background: #f8fafc; }
  .concepto-banner .cb-main { flex: 1; min-width: 0; }
  .concepto-banner .cb-overline {
    font-size: 8pt;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
    margin-bottom: 3pt;
  }
  .concepto-banner .cb-label {
    font-size: 13pt;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.3px;
    color: #0f172a;
  }
  .concepto-banner.tone-success .cb-label { color: #15803d; }
  .concepto-banner.tone-warning .cb-label { color: #b45309; }
  .concepto-banner.tone-danger  .cb-label { color: #b91c1c; }
  .concepto-banner .cb-meaning {
    font-size: 8.5pt;
    color: #475569;
    margin-top: 4pt;
    line-height: 1.35;
  }
  .concepto-banner .cb-score {
    text-align: center;
    flex-shrink: 0;
    padding-left: 12pt;
    border-left: 1px solid rgba(15, 23, 42, 0.08);
  }
  .concepto-banner .cb-pct {
    font-size: 20pt;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.8px;
    color: #0f172a;
  }
  .concepto-banner.tone-success .cb-pct { color: #15803d; }
  .concepto-banner.tone-warning .cb-pct { color: #b45309; }
  .concepto-banner.tone-danger  .cb-pct { color: #b91c1c; }
  .concepto-banner .cb-pct-label {
    font-size: 7pt;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #94a3b8;
    font-weight: 700;
    margin-top: 3pt;
  }

  .summary-global {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 3pt solid #94a3b8;
    border-radius: 5pt;
    padding: 5pt 10pt;
    margin: 4pt 0 5pt;
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
    font-size: 18pt;
    font-weight: 800;
    color: #0f172a;
    line-height: 1;
    letter-spacing: -0.5px;
  }

  .summary-rows {
    display: flex;
    flex-direction: column;
    gap: 3pt;
    margin-top: 3pt;
    padding: 5pt 10pt;
    border: 1px solid #e2e8f0;
    border-radius: 5pt;
    background: #ffffff;
  }
  .prog-row {
    display: flex;
    flex-direction: column;
    gap: 2pt;
    padding-bottom: 3pt;
    border-bottom: 1px solid #f1f5f9;
  }
  .prog-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .prog-row-main {
    display: grid;
    grid-template-columns: 130pt 1fr 32pt 104pt;
    align-items: center;
    gap: 8pt;
  }
  .prog-name {
    font-size: 8.5pt;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4pt;
    overflow: hidden;
  }
  /* Gates de seguridad activos */
  .gates-block {
    margin-top: 4mm;
    padding: 6pt 12pt 7pt 14pt;
    border: 1px solid #fecaca;
    border-left: 4pt solid #dc2626;
    border-radius: 5pt;
    background: #fef2f2;
  }
  .gates-label {
    font-size: 8.5pt;
    font-weight: 700;
    color: #991b1b;
    letter-spacing: 0.3px;
    margin-bottom: 3pt;
  }
  .gates-list {
    margin: 0;
    padding-left: 14pt;
    color: #7f1d1d;
    font-size: 8.8pt;
    line-height: 1.4;
  }
  .gates-list li { margin-bottom: 1.5pt; }
  .gates-list li:last-child { margin-bottom: 0; }
  .gates-list strong { color: #991b1b; font-weight: 700; }
  .prog-tier {
    font-size: 7.5pt;
    font-weight: 700;
    letter-spacing: 0.2px;
    line-height: 1.15;
    text-align: right;
    text-transform: uppercase;
  }
  .prog-tier.tone-success { color: #166534; }
  .prog-tier.tone-warning { color: #92400e; }
  .prog-tier.tone-danger  { color: #991b1b; }
  .prog-tier.tone-muted   { color: #94a3b8; }
  .prog-pct {
    font-size: 9.5pt;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.3px;
    text-align: right;
  }
  .prog-pct.tone-success { color: #166534; }
  .prog-pct.tone-warning { color: #92400e; }
  .prog-pct.tone-danger  { color: #991b1b; }
  .prog-pct.tone-muted   { color: #94a3b8; font-weight: 600; }
  .prog-bar {
    height: 6pt;
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
    gap: 7pt;
    align-items: center;
    flex-wrap: wrap;
    font-size: 7.5pt;
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

  /* Sección 4+ — Procedimiento (hallazgos, secciones de inspección, llantas, accesorios) */
  .proc-section { margin-top: 8mm; }
  .proc-section .section-h { margin-top: 0; }

  /* Cabecera descriptiva de sección: imagen de referencia (60%) + descripción (40%).
     Si no hay imagen para esa sección, la descripción ocupa el ancho completo. */
  .section-intro {
    display: flex;
    gap: 0;
    margin: 3mm 0 4mm;
    page-break-inside: avoid;
    break-inside: avoid;
    align-items: stretch;
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    overflow: hidden;
    background: #f8fafc;
  }
  .section-intro-img {
    flex: 0 0 58%;
    max-width: 58%;
  }
  .section-intro-img img {
    width: 100%;
    height: 100%;
    max-height: 58mm;
    object-fit: contain;
    display: block;
    background: #f8fafc;
  }
  .section-intro-desc {
    flex: 1;
    padding: 4mm 5mm;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4pt;
  }
  .section-intro-summary {
    margin: 0;
    font-size: 8pt;
    color: #475569;
    line-height: 1.5;
    font-style: italic;
  }
  .section-intro-items {
    margin: 0;
    padding-left: 12pt;
    display: flex;
    flex-direction: column;
    gap: 2pt;
  }
  .section-intro-items li {
    font-size: 8pt;
    color: #0f172a;
    font-weight: 500;
    line-height: 1.4;
  }
  .section-intro-noimg {
    display: block;
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    background: #ffffff;
  }
  .section-intro-noimg .section-intro-desc { padding: 4mm 5mm; }

  .proc-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12pt;
    border: 1px solid #e2e8f0;
    border-left: 4pt solid #94a3b8;
    border-radius: 5pt;
    padding: 8pt 14pt;
    margin: 3mm 0 4mm;
    background: #f8fafc;
  }
  .proc-hero.tone-success { border-color: #bbf7d0; border-left-color: #16a34a; background: #f0fdf4; }
  .proc-hero.tone-warning { border-color: #fde68a; border-left-color: #f59e0b; background: #fffbeb; }
  .proc-hero.tone-danger  { border-color: #fecaca; border-left-color: #dc2626; background: #fef2f2; }
  .proc-hero.tone-muted   { border-color: #e2e8f0; border-left-color: #94a3b8; background: #f8fafc; }
  .proc-hero-text { display: flex; flex-direction: column; gap: 2pt; }
  .proc-hero-label {
    font-size: 9.5pt;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.2;
  }
  .proc-hero-meta { font-size: 8.5pt; color: #64748b; }
  .proc-hero-pct {
    font-size: 18pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.5px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .proc-hero.tone-success .proc-hero-pct { color: #166534; }
  .proc-hero.tone-warning .proc-hero-pct { color: #92400e; }
  .proc-hero.tone-danger  .proc-hero-pct { color: #991b1b; }

  .proc-subhead {
    font-size: 8pt;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
    margin: 4mm 0 2mm;
  }
  .proc-findings { display: flex; flex-direction: column; gap: 2.5mm; margin-bottom: 3mm; }
  .proc-findings.proc-findings-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.5mm 3mm;
  }
  .proc-finding {
    border: 1px solid #e2e8f0;
    border-left: 3pt solid #94a3b8;
    border-radius: 4pt;
    padding: 6pt 10pt 7pt 11pt;
    background: #f8fafc;
    page-break-inside: avoid;
  }
  .proc-finding.tone-warning { border-color: #fde68a; border-left-color: #d97706; background: #fffbeb; }
  .proc-finding.tone-danger  { border-color: #fecaca; border-left-color: #b91c1c; background: #fef2f2; }
  .proc-finding-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5pt;
    margin-bottom: 2pt;
  }
  .proc-finding-group {
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
  }
  .proc-finding-title {
    font-size: 10.2pt;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.25;
  }
  .proc-finding-notes {
    font-size: 9pt;
    color: #475569;
    margin-top: 2pt;
    line-height: 1.4;
  }
  .proc-finding-photos { display: flex; flex-wrap: wrap; gap: 4pt; margin-top: 4pt; }
  .proc-finding-photos img {
    width: 80pt;
    height: 58pt;
    object-fit: cover;
    border-radius: 3pt;
    border: 1px solid #e2e8f0;
  }
  .proc-ok-card {
    display: flex;
    flex-direction: column;
    gap: 4pt;
    padding: 7pt 12pt 8pt;
    border: 1px solid #bbf7d0;
    border-left: 3pt solid #16a34a;
    border-radius: 4pt;
    background: #f0fdf4;
  }
  .proc-ok-head {
    display: flex;
    align-items: center;
    gap: 6pt;
  }
  .proc-ok-icon {
    font-size: 12pt;
    color: #16a34a;
    font-weight: 800;
    line-height: 1;
  }
  .proc-ok-count {
    font-size: 9.5pt;
    font-weight: 700;
    color: #166534;
  }
  .proc-ok-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5pt 14pt;
    font-size: 8.8pt;
    color: #334155;
    line-height: 1.4;
  }
  .proc-ok-grid li {
    padding-left: 8pt;
    position: relative;
  }
  .proc-ok-grid li::before {
    content: "·";
    position: absolute;
    left: 0;
    color: #16a34a;
    font-weight: 800;
  }
  .proc-ok-note {
    font-size: 8.8pt;
    color: #475569;
    line-height: 1.45;
  }

  /* Llantas */
  .tire-grid { grid-template-columns: repeat(5, 1fr); page-break-inside: avoid; break-inside: avoid; }
  .tire-cell { gap: 3pt; }
  .tire-pct {
    font-size: 14pt;
    font-weight: 800;
    color: #0f172a;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .tire-cell.tone-success .tire-pct { color: #166534; }
  .tire-cell.tone-warning .tire-pct { color: #92400e; }
  .tire-cell.tone-danger  .tire-pct { color: #991b1b; }
  .tire-bar {
    height: 4pt;
    background: #e2e8f0;
    border-radius: 100pt;
    overflow: hidden;
    margin-top: 3pt;
  }
  .tire-bar-fill { display: block; height: 100%; }
  .tire-bar-fill.tone-success { background: #16a34a; }
  .tire-bar-fill.tone-warning { background: #f59e0b; }
  .tire-bar-fill.tone-danger  { background: #dc2626; }

  /* Accesorios */
  .accessory-grid { grid-template-columns: repeat(3, 1fr); }
  .accessory-notes {
    font-size: 8pt;
    color: #64748b;
    margin-top: 1pt;
    line-height: 1.35;
  }

  .section-table { width: 100%; border-collapse: collapse; margin-top: 4pt; font-size: 9.8pt; }
  .section-table th, .section-table td { border-bottom: 1px solid #e2e8f0; padding: 5pt 6pt; vertical-align: top; text-align: left; }
  .section-table th { background: #f1f5f9; font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.4px; color: #334155; }
  .section-table tr:last-child td { border-bottom: none; }
  /* Filas completas siempre — un <tr> nunca se parte a la mitad entre páginas.
   * La tabla SÍ puede continuar en la siguiente página: el thead se repite
   * arriba (display: table-header-group) y la fila de grupo intenta quedarse
   * pegada al primer item del grupo (break-after: avoid). */
  .section-table thead { display: table-header-group; }
  .section-table tfoot { display: table-footer-group; }
  .section-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .section-table tr.grouprow {
    break-after: avoid;
    page-break-after: avoid;
  }
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

  .bodywork-tables {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 10pt;
    margin-top: 4pt;
    align-items: start;
  }
  .bodywork-tables .section-table { margin-top: 0; }
  .bodywork-tables .section-table.compact td { padding: 2.4pt 5pt; }
  .bodywork-tables .section-table.compact .pill { font-size: 7.4pt; }
  /* Sellante del marco — se muestra debajo del label de la puerta */
  .sealant-chip {
    display: inline-block;
    margin-left: 5pt;
    padding: 0.6pt 4pt;
    border-radius: 999px;
    font-size: 6.8pt;
    font-weight: 700;
    letter-spacing: 0.2px;
    text-transform: uppercase;
    border: 0.5pt solid;
    vertical-align: middle;
  }
  .sealant-original {
    color: #047857;
    border-color: #6ee7b7;
    background: #ecfdf5;
  }
  .sealant-generic {
    color: #b45309;
    border-color: #fcd34d;
    background: #fffbeb;
  }
  /* Detalle consolidado de hallazgos al final del documento */
  .findings-detail { margin-top: 6mm; }
  .findings-detail-group { margin-top: 5mm; page-break-inside: auto; }
  .findings-detail-group:first-of-type { margin-top: 2mm; }
  .findings-detail-group-head {
    font-size: 11pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.2px;
    padding: 4pt 0 5pt;
    margin-bottom: 3mm;
    border-bottom: 1pt solid #e2e8f0;
    page-break-after: avoid;
  }

  /* Consideraciones y aclaraciones del servicio */
  .service-considerations {
    page-break-before: always;
    margin-top: 4mm;
  }
  .service-considerations h2 {
    font-size: 14pt;
    font-weight: 800;
    margin: 0 0 3mm;
    color: #0f172a;
    letter-spacing: -0.2px;
    border-bottom: 1pt solid #cbd5e1;
    padding-bottom: 4pt;
  }
  .service-considerations .subhead {
    font-size: 10pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #475569;
    margin: 5mm 0 2mm;
  }
  .service-considerations .intro {
    font-size: 9pt;
    line-height: 1.5;
    color: #334155;
    margin: 0 0 3mm;
    text-align: justify;
  }
  .service-considerations .closing {
    margin-top: 5mm;
    padding-top: 3mm;
    border-top: 1pt dashed #cbd5e1;
    font-size: 9pt;
    line-height: 1.5;
    color: #334155;
    text-align: justify;
  }
  .service-considerations .clause {
    margin-bottom: 3.5mm;
    page-break-inside: auto;
  }
  .service-considerations .clause h3 {
    font-size: 10.2pt;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 1.5mm;
    page-break-after: avoid;
  }
  .service-considerations .clause p {
    font-size: 8.8pt;
    line-height: 1.45;
    color: #334155;
    margin: 0 0 1.5mm;
    text-align: justify;
  }
  .service-considerations .clause p strong {
    color: #0f172a;
  }

  /* Aviso legal */
  .legal-notice {
    margin-top: 6mm;
    page-break-inside: avoid;
    border: 1pt solid #cbd5e1;
    border-radius: 6pt;
    padding: 7mm 8mm;
    background: #f8fafc;
  }
  .legal-notice h2 {
    font-size: 13pt;
    font-weight: 800;
    margin: 0 0 4mm;
    color: #0f172a;
    letter-spacing: -0.2px;
    border-bottom: 1pt solid #cbd5e1;
    padding-bottom: 3pt;
  }
  .legal-notice p {
    font-size: 9.4pt;
    line-height: 1.55;
    color: #334155;
    margin: 0 0 3mm;
    text-align: justify;
  }
  .legal-notice .legal-contact {
    margin-top: 4mm;
    padding-top: 3mm;
    border-top: 1pt dashed #cbd5e1;
    font-size: 9pt;
    color: #475569;
  }
  .legal-notice .legal-contact strong { color: #0f172a; }

  .bodywork-detail { margin-top: 4mm; }
  .bodywork-detail-head {
    font-size: 8pt;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #64748b;
    font-weight: 700;
    margin: 0 0 2mm;
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
  .two-col-grid .section-h { margin: 4pt 0 6pt 0; padding-bottom: 3pt; }
  .two-col-grid .section-h .section-title { font-size: 11.5pt; }
  .two-col-grid .section-h .section-num { font-size: 8pt; padding: 1.5pt 5pt 2pt; }

  .image-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; margin-top: 6pt; }
  .image-grid figure { margin: 0; border: 1px solid #e2e8f0; border-radius: 4pt; overflow: hidden; background: #f8fafc; page-break-inside: avoid; }
  .image-grid img { width: 100%; height: 120pt; object-fit: cover; display: block; }
  .image-grid figcaption { padding: 3pt 5pt; font-size: 8pt; color: #475569; }

  /* Evidencia fotográfica — bloques agrupados por sección */
  .evidence-section .evidence-group { margin-top: 6mm; page-break-inside: auto; }
  .evidence-section .evidence-group:first-of-type { margin-top: 3mm; }
  .evidence-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8pt;
    background: #f1f5f9;
    border-left: 3pt solid #0f172a;
    padding: 4pt 8pt;
    border-radius: 2pt;
    page-break-after: avoid;
  }
  .evidence-group-title {
    font-size: 10pt;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: 0.2px;
  }
  .evidence-group-count {
    font-size: 8.5pt;
    font-weight: 600;
    color: #475569;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 999pt;
    padding: 1pt 7pt;
  }

  section { page-break-inside: auto; }
  .avoid-break { page-break-inside: avoid; }
  .page-break { page-break-before: always; }

  /* Indivisible blocks: never split these mid-page.
     OJO: .proc-section NO va acá a propósito. Antes cada sección del recorrido
     (Carrocería, Chasis, etc.) llevaba page-break-inside: avoid e intentaba
     caber entera en una página; como cada una mide ~media hoja, si no cabía en
     el espacio restante se empujaba completa a la siguiente y dejaba media
     página en blanco. Ahora las secciones fluyen y llenan la página: lo que
     debe quedar intacto son los bloques atómicos pequeños — el badge de
     resumen (.proc-hero), la cabecera descriptiva (.section-intro) y cada fila
     de tabla (.section-table tr) — todos con su propio avoid. La tabla puede
     continuar en la página siguiente repitiendo el thead. */
  .proc-finding,
  .sig-block,
  .conclusion { page-break-inside: avoid; break-inside: avoid; }
  .proc-hero { page-break-inside: avoid; break-inside: avoid; }
  /* Avoid orphan headings (a h2 stranded at the bottom of a page) */
  h2, h3, .section-h { page-break-after: avoid; }

  .conclusion { border: 1px solid #e2e8f0; border-radius: 6pt; padding: 10pt; background: #f8fafc; margin-top: 8pt; }
  .conclusion h3 { margin-top: 0; }

  .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 18mm; }
  .sig-block.sig-block-single { grid-template-columns: minmax(0, 60mm); justify-content: start; }
  .sig-box { border-bottom: 1px solid #0f172a; height: 22mm; display: flex; align-items: flex-end; justify-content: center; }
  .sig-box img { max-height: 22mm; max-width: 100%; }
  .sig-label { font-size: 9pt; color: #334155; text-align: center; padding-top: 3pt; }

  /* Verification QR — both on the cover and near the signature. The cover one
     is large and meant to be scanned from the printed copy; the signature one
     is a redundancy that travels with the legal closing. */
  .qr-card {
    margin-top: 7mm;
    padding: 5mm 6mm;
    border: 1.5pt solid #0f172a;
    border-radius: 6pt;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6mm;
    align-items: center;
    page-break-inside: avoid;
    background: #f8fafc;
  }
  .qr-card img {
    width: 30mm;
    height: 30mm;
    display: block;
  }
  .qr-card .qr-title {
    font-size: 8pt;
    font-weight: 800;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: #0f172a;
  }
  .qr-card .qr-headline {
    font-size: 13pt;
    font-weight: 800;
    color: #0f172a;
    margin: 2pt 0 4pt;
    letter-spacing: -0.2px;
  }
  .qr-card .qr-desc {
    font-size: 9.2pt;
    color: #475569;
    line-height: 1.45;
  }
  .qr-card .qr-url {
    margin-top: 4pt;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 8.6pt;
    color: #0f172a;
    word-break: break-all;
  }

  .sig-verify {
    margin-top: 7mm;
    padding: 4mm 5mm;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 5mm;
    align-items: center;
    border: 1pt solid #e2e8f0;
    border-radius: 5pt;
    background: #fafafa;
    page-break-inside: avoid;
  }
  .sig-verify img { width: 22mm; height: 22mm; display: block; }
  .sig-verify .text { font-size: 8.8pt; color: #475569; line-height: 1.45; }
  .sig-verify .text strong { color: #0f172a; }
  .sig-verify .url {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 8pt;
    color: #0f172a;
    word-break: break-all;
    margin-top: 2pt;
  }
</style>
</head>
<body>

  <div class="bg-watermark" style="${bgWatermarkStyle}"></div>
  ${preview ? `<div class="preview-watermark">PREVISUALIZACIÓN</div>` : ""}

  <!-- COVER -->
  <section class="cover">
    <div>
      ${
        preview
          ? `<div class="preview-banner">
        <div class="pb-title">Previsualización — Documento no oficial</div>
        <div class="pb-text">Este documento es un borrador para revisión. No es válido para entrega ni tiene consecutivo oficial. Finalice el peritaje para emitir el documento definitivo.</div>
      </div>`
          : ""
      }
      <!-- BRANDED HEADER -->
      <div class="brand-header">
        <img class="brand-logo" src="${brand.logoDataUrl}" alt="${escapeHtml(brand.name)}" />
        <div class="brand-content">
          <div class="company-name">${escapeHtml(brand.name)}</div>
          <div class="brand-cols">
            <div>
              <div class="hdr-value">${esc(brand.nit)}</div>
              ${brand.phone ? `<div class="hdr-value">${esc(brand.phone)}</div>` : ""}
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
          <div class="kind-label">${escapeHtml(kindDef.label)} · ${escapeHtml(vehicleTypeDef.label)}</div>
          <div class="vehicle-name">${esc(v.make)} ${esc(v.model)}</div>
          <div class="vehicle-meta">Año ${esc(v.year)}${v.color ? ` · ${esc(v.color)}` : ""}</div>
        </div>
      </div>

      ${vehicleRenderDataUrl
        ? `<div class="vehicle-render-banner"><img src="${vehicleRenderDataUrl}" alt="${esc(v.make)} ${esc(v.model)} ${esc(v.year)}" /></div>`
        : ""}

      ${renderConceptoBanner(data)}

      ${renderPillarSummary(pillarReport, {
        heading: "Calificación por pilares",
        compact: true,
      })}

      <div class="vehicle-specs">
        ${heading("Datos del vehículo")}
        <div class="vspec-card">
          <div class="vspec-cols">
            <div class="vspec-col">
              <div class="vspec-item"><span class="vsl">Clase</span><span class="vsv">${esc(v.vehicleClass)}</span></div>
              <div class="vspec-item"><span class="vsl">Marca</span><span class="vsv">${esc(v.make)}</span></div>
              <div class="vspec-item"><span class="vsl">Línea</span><span class="vsv">${esc(v.model)}</span></div>
              <div class="vspec-item"><span class="vsl">Carrocería</span><span class="vsv">${esc(v.bodyType)}</span></div>
              <div class="vspec-item"><span class="vsl">Modelo</span><span class="vsv">${esc(v.year)}</span></div>
              <div class="vspec-item"><span class="vsl">Color</span><span class="vsv">${esc(v.color)}</span></div>
            </div>
            <div class="vspec-col">
              <div class="vspec-item"><span class="vsl">Nacionalidad</span><span class="vsv">${esc(v.nationality)}</span></div>
              <div class="vspec-item"><span class="vsl">Tipo de caja</span><span class="vsv">${escapeHtml(transmissionLabel(v.transmission))}</span></div>
              <div class="vspec-item"><span class="vsl">Cilindraje</span><span class="vsv">${v.cylinderCapacity ? `${escapeHtml(v.cylinderCapacity)} cc` : "—"}</span></div>
              <div class="vspec-item"><span class="vsl">Combustible</span><span class="vsv">${escapeHtml(fuelLabel(v.fuel))}</span></div>
              <div class="vspec-item"><span class="vsl">Servicio</span><span class="vsv">${esc(v.serviceType)}</span></div>
              <div class="vspec-item"><span class="vsl">Kilometraje</span><span class="vsv">${v.mileage ? `${escapeHtml(v.mileage)} km` : "—"}</span></div>
            </div>
          </div>
          <div class="vspec-ids">
            <div class="vspec-id-item"><span class="vsl">No. Chasis</span><span class="vsv mono">${esc(v.chassisNumber) || "—"}</span></div>
            <div class="vspec-id-item"><span class="vsl">No. Serial (VIN)</span><span class="vsv mono">${esc(v.vin) || "—"}</span></div>
            <div class="vspec-id-item"><span class="vsl">No. Motor</span><span class="vsv mono">${esc(v.engineNumber) || "—"}</span></div>
          </div>
          <div class="vspec-owner">
            <span class="vsl">Propietario</span>
            <span class="vspec-owner-val">${esc(v.owner) || "—"}${v.ownerDocument ? ` <span class="vspec-owner-doc">· ${esc(v.ownerDocument)}</span>` : ""}</span>
          </div>
        </div>
        ${components.background ? renderLegalAdmin(data.verifik) : ""}
      </div>
    </div>
  </section>

  <!-- DOCUMENTACIÓN -->
  ${renderDocumentation(data, heading("Documentación"))}

  <!-- DETAILED SECTIONS -->
  ${sections.map(renderOneSection).join("")}

  ${showTires ? renderTires(data, heading("Llantas")) : ""}

  ${showAccessories ? renderAccessories(data, heading("Accesorios")) : ""}

  <!-- EVIDENCE: fotos obligatorias y tarjeta de propiedad son evidencia
       requerida del peritaje. Antes este bloque vivía solo en el brazo
       detailed del ternario y el PDF oficial (que rendereaba en modo
       executive por default) salía sin las fotos. -->
  <section class="evidence-section" style="margin-top:10pt;">
    ${heading("Evidencia fotográfica")}
    ${(() => {
      const evidenceSections = sections.filter(
        (s) => !(s.sectionId === "roadTest" && roadTestSkipped),
      );
      const blocks = [
        renderDocumentEvidence(data),
        renderMandatoryPhotosEvidence(data),
        ...evidenceSections.map((s) => renderEvidence(s.title, s.def, s.data)),
        showTires ? renderTireEvidence(data) : "",
        renderExtraPhotosEvidence(data),
      ].filter((s) => s.length > 0);
      return blocks.length > 0
        ? blocks.join("")
        : `<p class="muted">No se registraron fotografías.</p>`;
    })()}
  </section>

  <!-- CONCLUSION -->
  <section style="margin-top:10pt;">
    ${heading("Conclusión técnica")}
    <div class="conclusion">
      <h3>Condición general: ${escapeHtml(conditionLabel)}</h3>
      ${data.conclusion.observations ? `<p><strong>Observaciones:</strong><br/>${escapeHtml(data.conclusion.observations).replace(/\n/g, "<br/>")}</p>` : ""}
      ${data.conclusion.recommendation ? `<p><strong>Recomendación:</strong><br/>${escapeHtml(data.conclusion.recommendation).replace(/\n/g, "<br/>")}</p>` : ""}
    </div>
  </section>

  <!-- DETALLE CONSOLIDADO DE HALLAZGOS -->
  ${renderAllFindingsDetail(sections, heading("Detalle de hallazgos"))}

  <!-- FIRMA Y VERIFICACIÓN -->
  ${(() => {
    const clientSig = data.conclusion?.clientSignature ?? "";
    const ownerLabel = v.owner ? esc(v.owner) : "Cliente";
    const ownerDoc = v.ownerDocument ? ` · ${esc(v.ownerDocument)}` : "";
    return `
  <section style="margin-top:10pt;">
    <div class="sig-block${clientSig ? "" : " sig-block-single"}">
      <div>
        <div class="sig-box">
          ${inspectorSignatureDataUrl ? `<img src="${inspectorSignatureDataUrl}" alt="Firma perito" />` : ""}
        </div>
        <div class="sig-label">Firma del perito responsable<br/>${esc(v.inspector)}${v.inspectorId ? ` · ${esc(v.inspectorId)}` : ""}</div>
      </div>
      ${clientSig
        ? `<div>
            <div class="sig-box">
              <img src="${clientSig}" alt="Firma cliente" />
            </div>
            <div class="sig-label">Firma del cliente<br/>${ownerLabel}${ownerDoc}</div>
          </div>`
        : ""}
    </div>

    ${verifiable
      ? `<div class="sig-verify">
          <img src="${verificationQrDataUrl}" alt="QR de verificación" />
          <div class="text">
            <strong>Peritaje verificable en línea.</strong> Escanea este código o ingresa a la URL para confirmar que esta copia coincide con la versión oficial registrada por ${escapeHtml(brand.name)}.
            <div class="url">${escapeHtml(verificationUrl ?? "")}</div>
          </div>
        </div>`
      : ""}
  </section>`;
  })()}

  <!-- CONSIDERACIONES Y ACLARACIONES DEL SERVICIO -->
  ${renderServiceConsiderations(brand)}

  <!-- AVISO LEGAL -->
  ${renderLegalDisclaimer(brand)}

  <div class="doc-footer">
    <span>Documento generado por ${escapeHtml(brand.name)}</span>
    <span>Generado el ${new Date().toLocaleString("es-CO")}</span>
  </div>

</body>
</html>`;
}
