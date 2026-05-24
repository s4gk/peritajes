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
import { findOption, type FindingOption, type RiskTag } from "./findings-catalog";
import type {
  InspectionData,
  InspectionEntry,
  InspectionSectionDef,
  RiskLevel,
} from "./types";

export type RiskFinding = {
  level: "info" | "warning" | "critical";
  section: string;
  item: string;
  message: string;
};

export type RiskReport = {
  level: RiskLevel;
  score: number;
  findings: RiskFinding[];
  counters: {
    repainted: number;
    repaired: number;
    poorlyRepaired: number;
    damaged: number;
    structuralHits: number;
    criticalLeaks: number;
    mechanicalBad: number;
    mechanicalRegular: number;
    roadTestDeficient: number;
    tiresCritical: number;
    rustHits: number;
    brakingIssues: number;
  };
  headline: string;
  conditionSummary: string;
};

function catalogSeverityScore(opt: FindingOption): number {
  if (opt.tone === "success" || opt.tone === "neutral") return 0;
  const sev = opt.severity ?? 1;
  return opt.tone === "danger" ? sev * 5 : sev * 2;
}

function catalogLevel(opt: FindingOption): "info" | "warning" | "critical" | null {
  if (opt.tone === "success" || opt.tone === "neutral") return null;
  return opt.tone === "danger" ? "critical" : "warning";
}

function hasRisk(opt: FindingOption | undefined, tag: RiskTag): boolean {
  return !!opt?.risks?.includes(tag);
}

function sectionLabel(section: InspectionSectionDef): string {
  return section.label;
}

function lookupItemLabel(section: InspectionSectionDef, id: string): string {
  for (const g of section.groups) {
    const match = g.items.find((i) => i.id === id);
    if (match) return match.label;
  }
  return id;
}

function entriesOf(
  section: InspectionSectionDef,
  record: Record<string, InspectionEntry> | undefined,
): { itemId: string; label: string; opt: FindingOption | undefined; entry: InspectionEntry | undefined }[] {
  if (!record) return [];
  return section.groups.flatMap((g) =>
    g.items.map((i) => ({
      itemId: i.id,
      label: i.label,
      entry: record[i.id],
      opt: findOption(record[i.id]?.status),
    })),
  );
}

export function analyze(data: InspectionData): RiskReport {
  const findings: RiskFinding[] = [];
  const counters = {
    repainted: 0,
    repaired: 0,
    poorlyRepaired: 0,
    damaged: 0,
    structuralHits: 0,
    criticalLeaks: 0,
    mechanicalBad: 0,
    mechanicalRegular: 0,
    roadTestDeficient: 0,
    tiresCritical: 0,
    rustHits: 0,
    brakingIssues: 0,
  };
  let score = 0;

  // --- Bodywork ---
  for (const { opt, label } of entriesOf(BODYWORK_SECTION, data.bodywork)) {
    if (!opt) continue;
    if (hasRisk(opt, "repainted")) counters.repainted += 1;
    if (hasRisk(opt, "repaired")) counters.repaired += 1;
    if (hasRisk(opt, "poor_repair")) counters.poorlyRepaired += 1;
    if (hasRisk(opt, "damage")) counters.damaged += 1;
    if (hasRisk(opt, "rust")) counters.rustHits += 1;

    const lvl = catalogLevel(opt);
    if (lvl) {
      findings.push({
        level: lvl,
        section: "Carrocería",
        item: label,
        message: opt.label,
      });
      score += catalogSeverityScore(opt);
    }
  }

  // --- Structural / chassis ---
  for (const { opt, label } of entriesOf(CHASSIS_SECTION, data.chassis)) {
    if (!opt) continue;
    if (hasRisk(opt, "structural")) counters.structuralHits += 1;
    if (hasRisk(opt, "poor_repair")) counters.poorlyRepaired += 1;
    if (hasRisk(opt, "rust")) counters.rustHits += 1;

    const lvl = catalogLevel(opt);
    if (lvl) {
      findings.push({
        level: lvl,
        section: "Chasis / Estructura",
        item: label,
        message: opt.label,
      });
      // structural issues weigh extra
      score += catalogSeverityScore(opt) + (hasRisk(opt, "structural") ? 5 : 0);
    }
  }

  // --- Leaks ---
  for (const { opt, label } of entriesOf(LEAKS_SECTION, data.leaks)) {
    if (!opt) continue;
    if (hasRisk(opt, "leak_heavy")) counters.criticalLeaks += 1;

    const lvl = catalogLevel(opt);
    if (lvl) {
      findings.push({
        level: lvl,
        section: "Fugas",
        item: label,
        message: opt.label,
      });
      score += catalogSeverityScore(opt);
    }
  }

  // --- Mechanical sections (engine, suspension, electrical, comfort) ---
  const mechanicalSources: { section: InspectionSectionDef; data?: Record<string, InspectionEntry>; sectionLabel: string }[] = [
    { section: ENGINE_SECTION, data: data.engine, sectionLabel: "Motor" },
    { section: SUSPENSION_SECTION, data: data.suspension, sectionLabel: "Suspensión / Dirección" },
    { section: ELECTRICAL_SECTION, data: data.electrical, sectionLabel: "Eléctrico" },
    { section: COMFORT_SECTION, data: data.comfort, sectionLabel: "Confort" },
  ];
  for (const src of mechanicalSources) {
    for (const { opt, label } of entriesOf(src.section, src.data)) {
      if (!opt) continue;
      if (hasRisk(opt, "mechanical_fail")) counters.mechanicalBad += 1;
      else if (hasRisk(opt, "mechanical_issue")) counters.mechanicalRegular += 1;
      if (hasRisk(opt, "leak_heavy")) counters.criticalLeaks += 1;

      const lvl = catalogLevel(opt);
      if (lvl) {
        findings.push({
          level: lvl,
          section: src.sectionLabel,
          item: label,
          message: opt.label,
        });
        score += catalogSeverityScore(opt);
      }
    }
  }

  // --- Road test ---
  // Si el perito marcó la etapa como "No aplica", no contamos hallazgos ni
  // sumamos al score. Los datos en data.roadTest (si los hay) se ignoran.
  if (!data.roadTestSkipped) {
    for (const { opt, label, itemId } of entriesOf(ROAD_TEST_SECTION, data.roadTest)) {
      if (!opt) continue;
      if (hasRisk(opt, "braking_fail")) counters.brakingIssues += 1;
      if (opt.tone === "danger") counters.roadTestDeficient += 1;

      const lvl = catalogLevel(opt);
      if (lvl) {
        const isBrakingCritical = hasRisk(opt, "braking_fail") && opt.tone === "danger";
        findings.push({
          level: isBrakingCritical ? "critical" : lvl,
          section: "Prueba de ruta",
          item: label,
          message: isBrakingCritical && itemId === "braking"
            ? `${opt.label} — riesgo de seguridad`
            : opt.label,
        });
        score += catalogSeverityScore(opt) + (isBrakingCritical ? 5 : 0);
      }
    }
  }

  // --- Tires ---
  const tireSpots: { name: string; v: number }[] = [
    { name: "Delantera izquierda", v: data.tires.frontLeft },
    { name: "Delantera derecha", v: data.tires.frontRight },
    { name: "Trasera izquierda", v: data.tires.rearLeft },
    { name: "Trasera derecha", v: data.tires.rearRight },
  ];
  for (const t of tireSpots) {
    if (t.v <= 25) {
      counters.tiresCritical += 1;
      findings.push({
        level: "critical",
        section: "Llantas",
        item: t.name,
        message: `Desgaste crítico (${t.v}%)`,
      });
      score += 8;
    } else if (t.v <= 50) {
      findings.push({
        level: "warning",
        section: "Llantas",
        item: t.name,
        message: `Desgaste moderado (${t.v}%)`,
      });
      score += 2;
    }
  }

  // --- Risk level ---
  // El nivel se determina por los gates duros definidos en lib/scoring.ts
  // (estructura/frenos/fugas/llantas/reparaciones) o por el agregado ponderado
  // de pilares, no por umbrales arbitrarios sobre el score acumulado. El score
  // queda como dato auxiliar para auditoría.
  // Aplicamos la misma lógica de gates aquí para que `report.level` coincida
  // con lo que muestra el PDF en la sección de pilares.
  let level: RiskLevel = "low";
  const hasHardGate =
    counters.structuralHits >= 1 ||
    counters.criticalLeaks >= 1 ||
    counters.brakingIssues >= 1 ||
    counters.tiresCritical >= 2 ||
    counters.poorlyRepaired >= 2;
  if (hasHardGate) {
    level = "high";
  } else if (
    counters.damaged >= 1 ||
    counters.mechanicalBad >= 2 ||
    counters.repaired >= 2 ||
    counters.tiresCritical >= 1 ||
    counters.repainted >= 4 ||
    counters.rustHits >= 3
  ) {
    level = "medium";
  }

  // Headline puramente descriptivo: el perito reporta hallazgos, NO opina sobre
  // riesgo ni recomienda comprar/no comprar. Esa interpretación la hace la
  // aseguradora o el cliente con los datos del peritaje.
  const headline =
    level === "high"
      ? "Hallazgos críticos detectados en la inspección"
      : level === "medium"
        ? "Hallazgos relevantes detectados en la inspección"
        : "Inspección sin hallazgos críticos";

  const conditionSummary =
    counters.structuralHits > 0
      ? "Vehículo con intervenciones estructurales."
      : counters.damaged + counters.poorlyRepaired > 0
        ? "Vehículo con daños o reparaciones relevantes."
        : counters.repainted + counters.repaired > 0
          ? "Vehículo con reparaciones menores o repintes."
          : "Vehículo sin reparaciones mayores detectadas.";

  findings.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 } as const;
    return order[a.level] - order[b.level];
  });

  return { level, score, findings, counters, headline, conditionSummary };
}

export function riskTone(level: RiskLevel): "success" | "warning" | "danger" {
  return level === "low" ? "success" : level === "medium" ? "warning" : "danger";
}

/**
 * Health metric derived from the same severity weights used by analyze().
 *
 * - `penalty` is the cumulative penalty score using catalog severity (warning = sev×2,
 *   danger = sev×5) plus the same bonuses analyze() applies (structural +5,
 *   critical braking +5, critical tire wear 8, moderate tire wear 2).
 * - `maxPenalty` is the theoretical worst-case penalty for the *items actually
 *   inspected* in this section, using the per-item ceiling for that section.
 * - `healthPct` = 100 − (penalty / maxPenalty) × 100. So the score scales with
 *   the size and risk profile of the inspection performed, not against a fixed
 *   threshold.
 */
export type SectionHealth = {
  inspected: number;
  ok: number;
  warning: number;
  danger: number;
  penalty: number;
  maxPenalty: number;
  healthPct: number | null;
};

export type HealthReport = {
  global: SectionHealth;
  bySection: Record<string, SectionHealth>;
};

/**
 * Worst-case penalty per inspected item, derived from the rules in analyze():
 *  - default item: severity 3 × 5 = 15
 *  - chassis: + structural bonus 5 = 20
 *  - road test: + critical braking bonus 5 = 20
 *  - tires: hard cap 8 (motor uses fixed +8 / +2, not severity)
 */
const MAX_PENALTY_PER_ITEM: Record<string, number> = {
  bodywork: 15,
  chassis: 20,
  suspension: 15,
  engine: 15,
  electrical: 15,
  leaks: 15,
  comfort: 15,
  roadTest: 20,
  tires: 8,
  accessories: 15,
};

function emptyHealth(): SectionHealth {
  return { inspected: 0, ok: 0, warning: 0, danger: 0, penalty: 0, maxPenalty: 0, healthPct: null };
}

function pctFromPenalty(penalty: number, maxPenalty: number): number | null {
  if (maxPenalty === 0) return null;
  return Math.max(0, Math.min(100, Math.round(100 - (penalty / maxPenalty) * 100)));
}

function processSectionInto(
  target: SectionHealth,
  sectionDef: InspectionSectionDef,
  record: Record<string, InspectionEntry> | undefined,
  extraPenalty?: (opt: FindingOption) => number,
) {
  for (const { opt } of entriesOf(sectionDef, record)) {
    if (!opt || opt.tone === "neutral") continue;
    target.inspected += 1;
    if (opt.tone === "success") {
      target.ok += 1;
      continue;
    }
    if (opt.tone === "warning") target.warning += 1;
    else if (opt.tone === "danger") target.danger += 1;
    target.penalty += catalogSeverityScore(opt);
    if (extraPenalty) target.penalty += extraPenalty(opt);
  }
}

export function computeHealth(data: InspectionData): HealthReport {
  const sections: Record<string, SectionHealth> = {
    bodywork: emptyHealth(),
    chassis: emptyHealth(),
    suspension: emptyHealth(),
    engine: emptyHealth(),
    electrical: emptyHealth(),
    leaks: emptyHealth(),
    comfort: emptyHealth(),
    roadTest: emptyHealth(),
    tires: emptyHealth(),
    accessories: emptyHealth(),
  };

  processSectionInto(sections.bodywork, BODYWORK_SECTION, data.bodywork);
  processSectionInto(sections.chassis, CHASSIS_SECTION, data.chassis, (opt) =>
    hasRisk(opt, "structural") ? 5 : 0,
  );
  processSectionInto(sections.suspension, SUSPENSION_SECTION, data.suspension);
  processSectionInto(sections.engine, ENGINE_SECTION, data.engine);
  processSectionInto(sections.electrical, ELECTRICAL_SECTION, data.electrical);
  processSectionInto(sections.leaks, LEAKS_SECTION, data.leaks);
  processSectionInto(sections.comfort, COMFORT_SECTION, data.comfort);
  if (!data.roadTestSkipped) {
    processSectionInto(sections.roadTest, ROAD_TEST_SECTION, data.roadTest, (opt) =>
      hasRisk(opt, "braking_fail") && opt.tone === "danger" ? 5 : 0,
    );
  }

  // Tires: same buckets and weights analyze() uses (8 critical, 2 moderate)
  const tireSpots = [
    data.tires.frontLeft,
    data.tires.frontRight,
    data.tires.rearLeft,
    data.tires.rearRight,
  ];
  for (const v of tireSpots) {
    sections.tires.inspected += 1;
    if (v <= 25) {
      sections.tires.danger += 1;
      sections.tires.penalty += 8;
    } else if (v <= 50) {
      sections.tires.warning += 1;
      sections.tires.penalty += 2;
    } else {
      sections.tires.ok += 1;
    }
  }

  // Accesorios: ahora son informativos (solo presencia, sin estado), así que
  // no contribuyen al cálculo de salud ni al pillar de equipo. Quedan en el
  // mapa con healthPct = null para que el pilar `equipment` solo dependa de
  // las llantas.

  for (const key of Object.keys(sections)) {
    const s = sections[key];
    const perItemMax = MAX_PENALTY_PER_ITEM[key] ?? 15;
    s.maxPenalty = s.inspected * perItemMax;
    s.healthPct = pctFromPenalty(s.penalty, s.maxPenalty);
  }

  const global = emptyHealth();
  for (const s of Object.values(sections)) {
    global.inspected += s.inspected;
    global.ok += s.ok;
    global.warning += s.warning;
    global.danger += s.danger;
    global.penalty += s.penalty;
    global.maxPenalty += s.maxPenalty;
  }
  global.healthPct = pctFromPenalty(global.penalty, global.maxPenalty);

  return { global, bySection: sections };
}
