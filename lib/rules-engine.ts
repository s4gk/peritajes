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
  let level: RiskLevel = "low";
  if (
    score >= 40 ||
    counters.structuralHits >= 2 ||
    counters.poorlyRepaired >= 2 ||
    counters.criticalLeaks >= 1 ||
    counters.brakingIssues >= 1 ||
    counters.tiresCritical >= 2
  ) {
    level = "high";
  } else if (
    score >= 15 ||
    counters.damaged >= 1 ||
    counters.mechanicalBad >= 2 ||
    counters.repaired >= 2 ||
    counters.tiresCritical >= 1
  ) {
    level = "medium";
  }

  const headline =
    level === "high"
      ? "Riesgo alto — se recomienda intervención previa a la compra"
      : level === "medium"
        ? "Riesgo moderado — atender observaciones"
        : "Riesgo bajo — vehículo en condiciones aceptables";

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
