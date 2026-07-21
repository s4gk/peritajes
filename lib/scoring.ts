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

import type { HealthReport, RiskFinding, RiskReport, SectionHealth } from "./rules-engine";
import type { EconomicImpactLevel, RepairCostRange, RiskLevel } from "./types";

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
      "Chasis, estructura, largueros, torres y prueba de ruta de seguridad (frenado, ABS, manejo). Define la viabilidad técnica del vehículo y su seguridad para circular.",
    weight: 0.45,
    sections: ["chassis", "roadTest"],
  },
  {
    key: "mechanical",
    title: "Mecánica",
    description:
      "Motor, transmisión, suspensión, dirección, frenos, refrigeración, sistema eléctrico y fugas mecánicas (aceite, refrigerante, frenos). Determina el costo de mantenimiento y reparación esperado.",
    weight: 0.3,
    sections: ["engine", "suspension", "electrical", "leaks"],
  },
  {
    key: "bodywork",
    title: "Carrocería y pintura",
    description:
      "Puertas, guardabarros, capó, techo, pintura, repintes y reparaciones estéticas. Afecta el valor comercial del vehículo.",
    weight: 0.15,
    sections: ["bodywork"],
  },
  {
    key: "equipment",
    title: "Llantas y accesorios",
    description:
      "Llantas, rines y accesorios. Las llantas con desgaste crítico activan además un gate de seguridad. Los accesorios son informativos y casi no afectan la nota.",
    weight: 0.1,
    sections: ["tires", "accessories"],
  },
];
// Los pesos suman 1.0 (0.45 + 0.30 + 0.15 + 0.10). Estructura y seguridad
// domina (0.45) por ser lo más crítico para el comprador; mecánica sube a 0.30
// (incluye fugas, que migraron desde seguridad); carrocería baja a 0.15 (es
// estética / valor comercial, no seguridad); llantas y accesorios 0.10.
//
// NOTA: "confort" (volante, tapicería, pedales…) YA NO pondera en ningún pilar
// — es informativo, igual que los accesorios sueltos. Sigue capturándose y
// mostrándose en el informe, pero no entra en la Salud General.

/** Cuánto puede el global superar a la PEOR sección inspeccionada de SEGURIDAD/
 *  MECÁNICA. Mantiene la nota honesta: un único sistema catastrófico (p. ej. un
 *  motor al 30%) arrastra el global aunque su pilar pese poco. */
const WORST_SECTION_MARGIN = 25;

/** Secciones cuyo mal estado SÍ debe arrastrar el global por "piso" — son las
 *  de seguridad y mecánica, donde un solo sistema catastrófico vuelve el
 *  vehículo riesgoso. Carrocería (estético) y confort/accesorios
 *  (informativos) quedan FUERA: afectan el global únicamente por su peso de
 *  pilar, NO hunden la nota. Así un carro mecánicamente sano pero con
 *  carrocería golpeada no se desploma por debajo de lo que merece. */
const FLOOR_SECTIONS = new Set<string>([
  "chassis",
  "roadTest",
  "engine",
  "suspension",
  "electrical",
  "leaks",
  "tires",
]);

/** Techo del % de un PILAR cuando tiene un gate activo de esa severidad. Hace
 *  que un hallazgo crítico (daño estructural, frenos, fuga crítica…) HUNDA la
 *  barra del pilar responsable, en vez de diluirse entre los demás ítems. Como
 *  el global es el promedio de los pilares, esto también baja el global de forma
 *  coherente (sin topes separados que descuadren). Un gate "medium" (1 llanta)
 *  solo sube el piso de riesgo, no hunde la barra. */
const PILLAR_GATE_CAP: Record<"high" | "critical", number> = {
  high: 65,
  critical: 45,
};

/** Orden de severidad de gate, para quedarnos con el más fuerte por pilar. */
const GATE_ORDER: Record<GateSeverity, number> = { medium: 0, high: 1, critical: 2 };

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

/**
 * Severidad de un gate. Define el PISO de riesgo que impone:
 *  - "critical": fuerza Riesgo Crítico (estructura, frenos, fuga crítica…).
 *  - "high":     fuerza al menos Riesgo Alto (p.ej. 2 llantas críticas).
 *  - "medium":   fuerza al menos Riesgo Medio (p.ej. 1 llanta crítica).
 */
export type GateSeverity = "medium" | "high" | "critical";

export type HardGate = {
  reason: string;
  detail: string;
  pillar: PillarKey;
  severity: GateSeverity;
};

export function computePillars(
  health: HealthReport,
  report: Pick<RiskReport, "counters">,
): PillarReport {
  const gates = evaluateHardGates(report);
  // Severidad de gate más fuerte que apunta a cada pilar, para hundir su barra.
  const pillarGateSeverity = new Map<PillarKey, GateSeverity>();
  for (const g of gates) {
    const cur = pillarGateSeverity.get(g.pillar);
    if (!cur || GATE_ORDER[g.severity] > GATE_ORDER[cur]) {
      pillarGateSeverity.set(g.pillar, g.severity);
    }
  }

  const pillars: PillarHealth[] = PILLARS.map((p) => {
    const aggregate: SectionHealth = {
      inspected: 0,
      ok: 0,
      warning: 0,
      danger: 0,
      warnSeverity: 0,
      warnSeverityCosmetic: 0,
      penalty: 0,
      maxPenalty: 0,
      healthPct: null,
    };
    // El % del pilar es el promedio de la salud de sus secciones (ya calculada
    // con anti-dilución + techo por críticos en computeHealth), ponderado por
    // la cantidad de ítems inspeccionados de cada sección.
    let weightedSum = 0;
    let weightTotal = 0;
    for (const sectionKey of p.sections) {
      const s = health.bySection[sectionKey];
      if (!s) continue;
      aggregate.inspected += s.inspected;
      aggregate.ok += s.ok;
      aggregate.warning += s.warning;
      aggregate.danger += s.danger;
      aggregate.warnSeverity += s.warnSeverity;
      aggregate.warnSeverityCosmetic += s.warnSeverityCosmetic;
      aggregate.penalty += s.penalty;
      aggregate.maxPenalty += s.maxPenalty;
      if (s.healthPct !== null && s.inspected > 0) {
        weightedSum += s.healthPct * s.inspected;
        weightTotal += s.inspected;
      }
    }
    let healthPct = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;
    // Si un gate ALTO o CRÍTICO apunta a este pilar, su barra se hunde al techo
    // correspondiente — así un crítico de seguridad/mecánica se VE en el pilar,
    // no se diluye entre los ítems sanos.
    const sev = pillarGateSeverity.get(p.key);
    if (healthPct !== null && (sev === "high" || sev === "critical")) {
      healthPct = Math.min(healthPct, PILLAR_GATE_CAP[sev]);
    }
    aggregate.healthPct = healthPct;
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
  let globalPct = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

  if (globalPct !== null) {
    // "Todo lo de seguridad/mecánica afecta el global si lo amerita": la PEOR
    // sección inspeccionada de FLOOR_SECTIONS arrastra la nota. El global no
    // puede quedar muy por encima de ella, así un sistema catastrófico hunde la
    // nota aunque su pilar pese poco. Carrocería/confort NO entran aquí: solo
    // pesan por su pilar (ver FLOOR_SECTIONS).
    let worstSection: number | null = null;
    for (const [key, s] of Object.entries(health.bySection)) {
      if (!FLOOR_SECTIONS.has(key)) continue;
      if (s.healthPct === null || s.inspected === 0) continue;
      worstSection = worstSection === null ? s.healthPct : Math.min(worstSection, s.healthPct);
    }
    if (worstSection !== null) {
      globalPct = Math.min(globalPct, worstSection + WORST_SECTION_MARGIN);
    }
    // NO se topa el global por gate. El "Estado general" debe CUADRAR con las
    // barras de pilares (es la salud técnica). Que haya un hallazgo crítico se
    // comunica por el NIVEL DE RIESGO (riskLevelFromPillars → "Crítico") y por
    // el bloque de gates — no hundiendo el porcentaje, que confundía al no
    // coincidir con los pilares mostrados.
    globalPct = Math.max(0, Math.round(globalPct));
  }

  return { pillars, globalPct, gates };
}

/**
 * Reglas que imponen un piso de riesgo sin importar el agregado de pilares. Cada
 * gate apunta al pilar responsable y declara su severidad (el piso que fuerza).
 *
 * Taxonomía (decisión de negocio):
 *  - CRÍTICO: daño estructural, reparación estructural deficiente, falla de
 *    frenos, airbags comprometidos, fuga crítica con riesgo operativo.
 *  - ALTO:    2+ llantas en estado crítico.
 *  - MEDIO:   1 llanta en estado crítico (nunca puede quedar en riesgo bajo).
 */
export function evaluateHardGates(report: Pick<RiskReport, "counters">): HardGate[] {
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
      severity: "critical",
    });
  }
  if (c.brakingIssues >= 1) {
    gates.push({
      reason: "Falla en frenos",
      detail: "El sistema de frenos presenta deficiencias — riesgo de seguridad.",
      pillar: "safety",
      severity: "critical",
    });
  }
  if (c.airbagsCompromised >= 1) {
    gates.push({
      reason: "Airbags comprometidos",
      detail:
        "Sistema de airbags / retención reportado como comprometido — riesgo de seguridad.",
      pillar: "safety",
      severity: "critical",
    });
  }
  if (c.criticalLeaks >= 1) {
    // Las fugas migraron al pilar de mecánica; el gate sigue siendo crítico por
    // el riesgo operativo (quedarse sin frenos, fundir el motor, etc.).
    gates.push({
      reason: "Fuga crítica de fluidos",
      detail:
        c.criticalLeaks === 1
          ? "Fuga crítica reportada — riesgo operativo, requiere intervención inmediata."
          : `${c.criticalLeaks} fugas críticas reportadas — riesgo operativo, requieren intervención inmediata.`,
      pillar: "mechanical",
      severity: "critical",
    });
  }
  if (c.tiresCritical >= 2) {
    gates.push({
      reason: "Llantas en estado crítico",
      detail: `${c.tiresCritical} llantas con desgaste ≤25% — reemplazar antes de circular.`,
      pillar: "equipment",
      severity: "high",
    });
  } else if (c.tiresCritical === 1) {
    gates.push({
      reason: "Llanta en estado crítico",
      detail: "1 llanta con desgaste ≤25% — reemplazar antes de circular.",
      pillar: "equipment",
      severity: "medium",
    });
  }
  // NOTA: carrocería NO tiene gate. Las "reparaciones deficientes" estéticas
  // (paneles mal repintados/reparados) se cuentan en `poorlyRepaired` para el
  // texto descriptivo, pero NO topan la barra del pilar ni fuerzan riesgo —
  // carrocería es valor comercial, no seguridad, y no debe mover la nota
  // (decisión de negocio). El "mal reparado" en CHASIS sí pesa: entra por el
  // gate de "Daño estructural" (severity critical) vía `structuralHits`.

  return gates;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** El piso de riesgo más alto que imponen los gates activos (null si no hay). */
function gateRiskFloor(gates: HardGate[]): RiskLevel | null {
  let floor: RiskLevel | null = null;
  for (const g of gates) {
    const lvl: RiskLevel = g.severity; // GateSeverity ⊂ RiskLevel
    if (floor === null || RISK_ORDER[lvl] > RISK_ORDER[floor]) floor = lvl;
  }
  return floor;
}

/**
 * Mapea un `globalPct` ponderado + los gates al nivel de riesgo final (4
 * niveles). El riesgo NO depende solo del porcentaje: los gates imponen un piso
 * y se toma el MÁXIMO entre el riesgo por porcentaje y el piso de los gates.
 */
export function riskLevelFromPillars(
  globalPct: number | null,
  gates: HardGate[],
): RiskLevel {
  let fromPct: RiskLevel;
  if (globalPct === null) fromPct = "low";
  else if (globalPct < 60) fromPct = "high";
  else if (globalPct < 80) fromPct = "medium";
  else fromPct = "low";

  const floor = gateRiskFloor(gates);
  if (floor !== null && RISK_ORDER[floor] > RISK_ORDER[fromPct]) return floor;
  return fromPct;
}

/* ============================================================
 *  IMPACTO ECONÓMICO — dimensión independiente del riesgo.
 * ============================================================ */

const ECON_ORDER: Record<EconomicImpactLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Peso de cada nivel de impacto para acumular un "score económico". */
const ECON_WEIGHT: Record<EconomicImpactLevel, number> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 15,
};

/**
 * Banda de costo de reparación (COP) por nivel de impacto. SCAFFOLDING: son
 * rangos gruesos por defecto, pensados para reemplazarse luego por un cálculo
 * fino (tarifario por ítem/repuesto). Si el perito captura un costo explícito
 * en el `InspectionEntry`, ese gana sobre la banda.
 */
export const COST_BANDS: Record<EconomicImpactLevel, RepairCostRange> = {
  low: { min: 0, max: 300_000 },
  medium: { min: 300_000, max: 1_500_000 },
  high: { min: 1_500_000, max: 6_000_000 },
  critical: { min: 6_000_000, max: 20_000_000 },
};

/**
 * Indicador agregado de impacto económico a partir de los hallazgos. Cualquier
 * hallazgo "critical" lleva el agregado a crítico; si no, se escala por el score
 * acumulado para que muchos hallazgos medios sumen.
 */
export function economicLevelFromFindings(findings: RiskFinding[]): EconomicImpactLevel {
  let score = 0;
  let max: EconomicImpactLevel = "low";
  for (const f of findings) {
    const lvl = f.economicImpact;
    score += ECON_WEIGHT[lvl];
    if (ECON_ORDER[lvl] > ECON_ORDER[max]) max = lvl;
  }
  if (max === "critical") return "critical";
  if (score >= 14 || max === "high") return "high";
  if (score >= 5 || max === "medium") return "medium";
  return "low";
}

/**
 * Rango estimado de costo de reparación, sumando bandas por hallazgo (o el costo
 * explícito si el perito lo capturó). Devuelve null si no hay hallazgos con
 * impacto económico. Arquitectura lista; los números son una estimación gruesa.
 */
export function estimateRepairCost(findings: RiskFinding[]): RepairCostRange | null {
  let min = 0;
  let max = 0;
  let any = false;
  for (const f of findings) {
    if (f.economicImpact === "low" && !f.estimatedCost) continue;
    any = true;
    if (f.estimatedCost) {
      min += f.estimatedCost.min;
      max += f.estimatedCost.max;
    } else {
      const band = COST_BANDS[f.economicImpact];
      min += band.min;
      max += band.max;
    }
  }
  return any ? { min, max } : null;
}

/* ============================================================
 *  Etiquetas en español para UI / PDF / exportaciones.
 * ============================================================ */

export function riskLevelLabel(level: RiskLevel): string {
  return level === "low"
    ? "Bajo"
    : level === "medium"
      ? "Medio"
      : level === "high"
        ? "Alto"
        : "Crítico";
}

export function economicLevelLabel(level: EconomicImpactLevel): string {
  return level === "low"
    ? "Bajo"
    : level === "medium"
      ? "Medio"
      : level === "high"
        ? "Alto"
        : "Crítico";
}

/** Tono visual para un nivel de riesgo (4 niveles → 3 tonos del design system). */
export function riskLevelTone(level: RiskLevel): "success" | "warning" | "danger" {
  return level === "low" ? "success" : level === "medium" ? "warning" : "danger";
}

/** COP sin decimales, formato colombiano: $3.000.000. */
export function formatCop(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCostRange(range: RepairCostRange | null): string {
  if (!range) return "—";
  if (range.min === range.max) return formatCop(range.max);
  return `${formatCop(range.min)} – ${formatCop(range.max)}`;
}
