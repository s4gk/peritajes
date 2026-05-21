import { buildDocumentNumber, getCompanyBranding, type CompanyBranding } from "./company";
import {
  activeSectionsFor,
  bodyworkSectionFor,
  CHASSIS_SECTION,
  COMFORT_SECTION,
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
        <div class="gates-label">⚠ Gates de seguridad activos — fuerzan riesgo alto sin importar la nota global</div>
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
    <section style="margin-top:${options?.compact ? "6mm" : "14pt"};">
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
  return `
    <section class="docs-section proc-section">
      ${headingHtml}
      ${heroBlock}
      ${tablesBlock}
    </section>
  `;
}

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
  const slots: { key: keyof InspectionData["mandatoryPhotos"]; label: string }[] = [
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
    <section class="docs-section proc-section" style="page-break-before: always; break-before: page;">
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

  const heroLabel = `${list.length} accesorio${list.length === 1 ? "" : "s"} registrado${list.length === 1 ? "" : "s"}`;

  const cells = list
    .map(
      (a) => `
        <div class="docs-cell accessory-cell">
          <span class="docs-label">${escapeHtml(a.name)}</span>
          ${a.notes ? `<span class="accessory-notes">${escapeHtml(a.notes)}</span>` : ""}
        </div>`,
    )
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
      <div class="docs-grid accessory-grid">${cells}</div>
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

  return `
    <section class="page-break docs-section">
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

/* -----------------------------------------------------------
 *  Sección 4: Resumen de hallazgos del peritaje
 * --------------------------------------------------------- */

function renderFindingsSummary(
  report: RiskReport,
  pillarReport: PillarReport,
  headingHtml: string,
): string {
  const findings = report.findings.filter(
    (f) => f.level === "critical" || f.level === "warning",
  );
  const total = findings.length;

  const heroLabel = total === 0
    ? "Sin hallazgos detectados"
    : `${total} ${total === 1 ? "hallazgo detectado" : "hallazgos detectados"}`;
  const heroMeta = total === 0
    ? "El vehículo no presenta hallazgos en el peritaje."
    : "Listado de observaciones encontradas durante la inspección.";

  const globalPct = pillarReport.globalPct;

  const cards = findings
    .map(
      (f) => `
      <div class="proc-finding">
        <div class="proc-finding-head">
          <span class="proc-finding-group">${escapeHtml(f.section)}</span>
          <span class="pill pill-neutral">${escapeHtml(f.item)}</span>
        </div>
        <div class="proc-finding-title">${escapeHtml(f.message)}</div>
      </div>`,
    )
    .join("");

  return `
    <section class="docs-section proc-section findings-summary">
      ${headingHtml}
      <div class="proc-hero">
        <div class="proc-hero-text">
          <span class="proc-hero-label">${escapeHtml(heroLabel)}</span>
          <span class="proc-hero-meta">${escapeHtml(heroMeta)}</span>
        </div>
        ${globalPct !== null ? `<span class="proc-hero-pct">${globalPct}%</span>` : ""}
      </div>
      ${total === 0 ? "" : `<div class="proc-findings">${cards}</div>`}
    </section>
  `;
}

export type PdfMode = "executive" | "detailed";

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
  },
): string {
  const mode: PdfMode = options?.mode ?? "executive";
  const v = data.vehicle;
  const brand = options?.branding ?? getCompanyBranding();
  const inspectorSignatureDataUrl = options?.inspectorSignatureDataUrl ?? null;
  const vehicleRenderDataUrl = options?.vehicleRenderDataUrl ?? null;
  const verificationUrl = options?.verificationUrl ?? null;
  const verificationQrDataUrl = options?.verificationQrDataUrl ?? null;
  const verifiable = !!(verificationUrl && verificationQrDataUrl);
  const docNumber =
    options?.reportNumber || buildDocumentNumber(v.plate, v.date);
  const kindDef = PERITAJE_KINDS[data.kind] ?? PERITAJE_KINDS.complete;
  const vehicleType = data.vehicleType ?? FALLBACK_VEHICLE_TYPE;
  const vehicleTypeDef =
    VEHICLE_TYPES[vehicleType] ?? VEHICLE_TYPES[FALLBACK_VEHICLE_TYPE];
  const activeSectionIds = new Set(activeSectionsFor(data.kind, vehicleType));
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

  .cover { page-break-after: always; display: flex; flex-direction: column; padding-top: 0; }
  /* Vehicle hero: license-plate visual + vehicle info + risk pill */
  .vehicle-hero {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 14pt;
    align-items: center;
    margin-top: 6mm;
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
    margin-top: 7mm;
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
  .vehicle-specs .spec-group-body {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2.5mm 6mm;
  }
  .vehicle-specs .spec-cell {
    display: flex;
    flex-direction: column;
    gap: 1pt;
  }
  .vehicle-specs .spec-cell.spec-owner {
    grid-column: span 2;
  }
  .vehicle-specs .label {
    font-size: 7pt;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 500;
  }
  .vehicle-specs .value {
    font-size: 9.8pt;
    font-weight: 500;
    color: #0f172a;
    line-height: 1.25;
  }
  .vehicle-specs .value.mono {
    font-size: 9pt;
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

  /* Branded header on the cover page */
  .brand-header {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12pt;
    align-items: flex-start;
    padding: 7pt 0 10pt;
    border-bottom: 2pt solid #0f172a;
    margin-bottom: 6mm;
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
  .summary-global {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4pt solid #94a3b8;
    border-radius: 5pt;
    padding: 8pt 14pt;
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
    font-size: 26pt;
    font-weight: 800;
    color: #0f172a;
    line-height: 1;
    letter-spacing: -0.5px;
  }

  .summary-rows {
    display: flex;
    flex-direction: column;
    gap: 7pt;
    margin-top: 4pt;
    padding: 9pt 12pt;
    border: 1px solid #e2e8f0;
    border-radius: 5pt;
    background: #ffffff;
  }
  .prog-row {
    display: flex;
    flex-direction: column;
    gap: 4pt;
    padding-bottom: 7pt;
    border-bottom: 1px solid #f1f5f9;
  }
  .prog-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .prog-row-main {
    display: grid;
    grid-template-columns: 150pt 1fr 38pt 90pt;
    align-items: center;
    gap: 12pt;
  }
  .prog-name {
    font-size: 10.5pt;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 5pt;
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
    text-align: right;
  }
  .prog-pct.tone-success { color: #166534; }
  .prog-pct.tone-warning { color: #92400e; }
  .prog-pct.tone-danger  { color: #991b1b; }
  .prog-pct.tone-muted   { color: #94a3b8; font-weight: 600; }
  .prog-bar {
    height: 10pt;
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

  /* Sección 4+ — Procedimiento (hallazgos, secciones de inspección, llantas, accesorios) */
  .proc-section { margin-top: 8mm; }
  .proc-section .section-h { margin-top: 0; }
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
  .tire-grid { grid-template-columns: repeat(5, 1fr); }
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
    page-break-before: always;
    margin-top: 6mm;
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

  /* Indivisible blocks: never split these mid-page */
  .proc-finding,
  .sig-block,
  .conclusion { page-break-inside: avoid; }
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
          <div class="kind-label">${escapeHtml(kindDef.label)} · ${escapeHtml(vehicleTypeDef.label)}</div>
          <div class="vehicle-name">${esc(v.make)} ${esc(v.model)}</div>
          <div class="vehicle-meta">Año ${esc(v.year)}${v.color ? ` · ${esc(v.color)}` : ""}</div>
        </div>
      </div>

      ${vehicleRenderDataUrl
        ? `<div class="vehicle-render-banner"><img src="${vehicleRenderDataUrl}" alt="${esc(v.make)} ${esc(v.model)} ${esc(v.year)}" /></div>`
        : ""}

      ${renderPillarSummary(pillarReport, {
        heading: "Calificación por pilares",
        compact: true,
      })}

      <div class="vehicle-specs">
        ${heading("Datos del vehículo")}
        <div class="spec-group">
          <div class="spec-group-body">
            <div class="spec-cell"><span class="label">Clase</span><span class="value">${esc(v.vehicleClass)}</span></div>
            <div class="spec-cell"><span class="label">Marca</span><span class="value">${esc(v.make)}</span></div>
            <div class="spec-cell"><span class="label">Línea</span><span class="value">${esc(v.model)}</span></div>
            <div class="spec-cell"><span class="label">Carrocería</span><span class="value">${esc(v.bodyType)}</span></div>
            <div class="spec-cell"><span class="label">Modelo</span><span class="value">${esc(v.year)}</span></div>
            <div class="spec-cell"><span class="label">Nacionalidad</span><span class="value">${esc(v.nationality)}</span></div>
            <div class="spec-cell"><span class="label">Tipo de caja</span><span class="value">${escapeHtml(transmissionLabel(v.transmission))}</span></div>
            <div class="spec-cell"><span class="label">Cilindraje</span><span class="value">${v.cylinderCapacity ? `${escapeHtml(v.cylinderCapacity)} cc` : "—"}</span></div>
            <div class="spec-cell"><span class="label">Combustible</span><span class="value">${escapeHtml(fuelLabel(v.fuel))}</span></div>
            <div class="spec-cell"><span class="label">Pintura</span><span class="value">${esc(v.paintCondition)}</span></div>
            <div class="spec-cell"><span class="label">Servicio</span><span class="value">${esc(v.serviceType)}</span></div>
            <div class="spec-cell"><span class="label">Kilometraje</span><span class="value">${v.mileage ? `${escapeHtml(v.mileage)} km` : "—"}</span></div>
            <div class="spec-cell"><span class="label">Color</span><span class="value">${esc(v.color)}</span></div>
            <div class="spec-cell"><span class="label">No. Chasis</span><span class="value mono">${esc(v.chassisNumber)}</span></div>
            <div class="spec-cell"><span class="label">No. Serial</span><span class="value mono">${esc(v.vin)}</span></div>
            <div class="spec-cell"><span class="label">No. Motor</span><span class="value mono">${esc(v.engineNumber)}</span></div>
            <div class="spec-cell spec-owner"><span class="label">Propietario</span><span class="value">${esc(v.owner)}</span></div>
          </div>
        </div>
        ${renderLegalAdmin(data.verifik)}
      </div>
    </div>
  </section>

  <!-- DOCUMENTACIÓN -->
  ${renderDocumentation(data, heading("Documentación"))}

  <!-- HALLAZGOS DEL PERITAJE -->
  ${renderFindingsSummary(report, pillarReport, heading("Hallazgos del peritaje"))}

  <!-- DETAILED SECTIONS -->
  ${
    mode === "executive"
      ? `
  ${sections.map(renderOneSection).join("")}

  ${showTires ? renderTires(data, heading("Llantas")) : ""}

  ${showAccessories ? renderAccessories(data, heading("Accesorios")) : ""}
  `
      : `
  ${sections.map(renderOneSection).join("")}

  ${showTires ? renderTires(data, heading("Llantas")) : ""}

  ${showAccessories ? renderAccessories(data, heading("Accesorios")) : ""}

  <!-- EVIDENCE -->
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
  `
  }

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
            <strong>Peritaje verificable en línea.</strong> Escaneá este código o ingresá a la URL para confirmar que esta copia coincide con la versión oficial registrada por ${escapeHtml(brand.name)}.
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
    <span>${escapeHtml(brand.address)} · ${escapeHtml(brand.email)} · ${escapeHtml(brand.phone)}${brand.website ? ` · ${escapeHtml(brand.website)}` : ""}</span>
    <span>Generado el ${new Date().toLocaleString("es-CO")}</span>
  </div>

</body>
</html>`;
}
