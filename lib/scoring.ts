/**
 * Calificación por pilares — define cómo se combinan las secciones del peritaje
 * en una nota global defendible.
 *
 * El cálculo crudo (`computeHealth` en rules-engine.ts) saca un `healthPct` por
 * sección usando la severidad del catálogo. Aquí agrupamos esas secciones en 4
 * pilares con pesos explícitos, y aplicamos *gates duros*: condiciones que
 * fuerzan riesgo alto sin importar el agregado (un golpe estructural confirmado
 * tira el peritaje a "alto" aunque el resto esté en 100%).
 *
 * Los pesos los define el negocio. Para auditarlos basta con leer este archivo —
 * cada pilar tiene su justificación al lado.
 */

import type { HealthReport, RiskReport, SectionHealth } from "./rules-engine";

export type PillarKey = "safety" | "mechanical" | "bodywork" | "equipment";

export type PillarDef = {
  key: PillarKey;
  title: string;
  description: string;
  /** Peso en el agregado global (0-1, deben sumar 1). */
  weight: number;
  /** Claves de `HealthReport.bySection` que componen este pilar. */
  sections: string[];
};

/**
 * Pesos del peritaje. Cualquier cambio aquí impacta la nota global de TODOS los
 * peritajes futuros — discutir con el equipo antes de tocarlos.
 */
export const PILLARS: PillarDef[] = [
  {
    key: "safety",
    title: "Estructura y seguridad",
    description:
      "Chasis, fugas críticas y prueba de ruta. Define la viabilidad técnica del vehículo y su seguridad para circular.",
    weight: 0.4,
    sections: ["chassis", "leaks", "roadTest"],
  },
  {
    key: "mechanical",
    title: "Mecánica",
    description:
      "Motor, suspensión, sistema eléctrico y confort. Determina el costo de mantenimiento esperado.",
    weight: 0.3,
    sections: ["engine", "suspension", "electrical", "comfort"],
  },
  {
    key: "bodywork",
    title: "Carrocería y pintura",
    description:
      "Estado estético, repintes y reparaciones cosméticas. Afecta el valor comercial del vehículo.",
    weight: 0.2,
    sections: ["bodywork"],
  },
  {
    key: "equipment",
    title: "Llantas y accesorios",
    description:
      "Llantas y accesorios complementarios. Las llantas con desgaste crítico activan además un gate de seguridad.",
    weight: 0.1,
    sections: ["tires", "accessories"],
  },
];

export type PillarHealth = SectionHealth & {
  key: PillarKey;
  title: string;
  description: string;
  weight: number;
};

export type PillarReport = {
  pillars: PillarHealth[];
  /** Promedio ponderado de los `healthPct` de cada pilar inspeccionado. */
  globalPct: number | null;
  gates: HardGate[];
};

export type HardGate = {
  reason: string;
  detail: string;
  pillar: PillarKey;
};

function pctFromPenalty(penalty: number, maxPenalty: number): number | null {
  if (maxPenalty === 0) return null;
  return Math.max(0, Math.min(100, Math.round(100 - (penalty / maxPenalty) * 100)));
}

export function computePillars(health: HealthReport, report: RiskReport): PillarReport {
  const pillars: PillarHealth[] = PILLARS.map((p) => {
    const aggregate: SectionHealth = {
      inspected: 0,
      ok: 0,
      warning: 0,
      danger: 0,
      penalty: 0,
      maxPenalty: 0,
      healthPct: null,
    };
    for (const sectionKey of p.sections) {
      const s = health.bySection[sectionKey];
      if (!s) continue;
      aggregate.inspected += s.inspected;
      aggregate.ok += s.ok;
      aggregate.warning += s.warning;
      aggregate.danger += s.danger;
      aggregate.penalty += s.penalty;
      aggregate.maxPenalty += s.maxPenalty;
    }
    aggregate.healthPct = pctFromPenalty(aggregate.penalty, aggregate.maxPenalty);
    return {
      ...aggregate,
      key: p.key,
      title: p.title,
      description: p.description,
      weight: p.weight,
    };
  });

  // Promedio ponderado: solo cuentan los pilares con ítems inspeccionados,
  // así una sección no llenada no arrastra la nota global hacia abajo.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const p of pillars) {
    if (p.healthPct === null) continue;
    weightedSum += p.healthPct * p.weight;
    weightTotal += p.weight;
  }
  const globalPct =
    weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

  return { pillars, globalPct, gates: evaluateHardGates(report) };
}

/**
 * Reglas que fuerzan riesgo alto sin importar el agregado de pilares. Cada gate
 * apunta al pilar responsable para que el reporte explique de dónde viene.
 */
export function evaluateHardGates(report: RiskReport): HardGate[] {
  const gates: HardGate[] = [];
  const c = report.counters;

  if (c.structuralHits >= 1) {
    gates.push({
      reason: "Daño estructural",
      detail:
        c.structuralHits === 1
          ? "Se identificó 1 ítem con afectación estructural."
          : `Se identificaron ${c.structuralHits} ítems con afectación estructural.`,
      pillar: "safety",
    });
  }
  if (c.criticalLeaks >= 1) {
    gates.push({
      reason: "Fuga crítica de fluidos",
      detail:
        c.criticalLeaks === 1
          ? "Fuga crítica reportada — requiere intervención inmediata."
          : `${c.criticalLeaks} fugas críticas reportadas — requieren intervención inmediata.`,
      pillar: "safety",
    });
  }
  if (c.brakingIssues >= 1) {
    gates.push({
      reason: "Falla en frenos",
      detail: "El sistema de frenos presenta deficiencias — riesgo de seguridad.",
      pillar: "safety",
    });
  }
  if (c.tiresCritical >= 2) {
    gates.push({
      reason: "Llantas en estado crítico",
      detail: `${c.tiresCritical} llantas con desgaste ≤25% — reemplazar antes de circular.`,
      pillar: "safety",
    });
  }
  if (c.poorlyRepaired >= 2) {
    gates.push({
      reason: "Reparaciones deficientes múltiples",
      detail: `${c.poorlyRepaired} ítems con reparaciones mal ejecutadas — afectan integridad.`,
      pillar: "bodywork",
    });
  }

  return gates;
}

/**
 * Mapea un `globalPct` ponderado y los gates al nivel de riesgo final.
 * Si hay gates activos, fuerza alto sin importar el porcentaje.
 */
export function riskLevelFromPillars(
  globalPct: number | null,
  gates: HardGate[],
): "low" | "medium" | "high" {
  if (gates.length > 0) return "high";
  if (globalPct === null) return "low";
  if (globalPct < 60) return "high";
  if (globalPct < 80) return "medium";
  return "low";
}
