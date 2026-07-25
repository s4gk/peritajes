import {
  activeSectionsFor,
  bodyworkSectionFor,
  CHASSIS_BODYWORK_GROUP,
  CHASSIS_STRUCTURAL_SECTION,
  COMFORT_SECTION,
  ELECTRICAL_SECTION,
  FALLBACK_VEHICLE_TYPE,
  LEAKS_SECTION,
  ROAD_TEST_SECTION,
  SUSPENSION_SECTION,
} from "./constants";
import { findOption, type FindingOption, type RiskTag } from "./findings-catalog";
import {
  computePillars,
  economicLevelFromFindings,
  estimateRepairCost,
  riskLevelFromPillars,
} from "./scoring";
import type {
  EconomicImpactLevel,
  InspectionData,
  InspectionEntry,
  InspectionSectionDef,
  RepairCostRange,
  RiskLevel,
} from "./types";

export type RiskFinding = {
  /** Severidad de display (tono de la fila en UI/PDF). */
  level: "info" | "warning" | "critical";
  section: string;
  item: string;
  message: string;
  /** Riesgo para el comprador (dimensión 1). Derivado por `classifyFinding`. */
  riskLevel: RiskLevel;
  /** Impacto económico esperado (dimensión 2). Derivado por `classifyFinding`. */
  economicImpact: EconomicImpactLevel;
  /** Costo capturado a mano por el perito, si lo hubiera (scaffolding). */
  estimatedCost?: RepairCostRange;
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
    /** Airbags / sistema de retención comprometidos. SCAFFOLDING: hoy no hay
     *  ítem que lo capture, así que siempre es 0; el gate crítico ya lo lee. */
    airbagsCompromised: number;
  };
  /** Indicador económico agregado (dimensión independiente del riesgo). */
  economicImpact: EconomicImpactLevel;
  /** Rango estimado de costo de reparación en COP (scaffolding por bandas). */
  estimatedRepairCost: RepairCostRange | null;
  headline: string;
  conditionSummary: string;
  /** Párrafo descriptivo que combina salud técnica + riesgo + impacto económico. */
  executiveSummary: string;
};

/* -----------------------------------------------------------
 *  CLASIFICACIÓN POR HALLAZGO — riesgo + impacto económico.
 *  El catálogo COMMON es compartido (carrocería/chasis/mecánica), así que el
 *  mismo `opt` significa cosas distintas según la sección. Por eso la
 *  clasificación es CONTEXTUAL (igual que `chassisExtraPenalty`): se deriva del
 *  tono/severidad/tags + la sección, salvo override explícito en la opción.
 * --------------------------------------------------------- */
export function classifyFinding(
  sectionKey: string,
  opt: FindingOption,
): { riskLevel: RiskLevel; economicImpact: EconomicImpactLevel } {
  const sev = opt.severity ?? 1;
  const danger = opt.tone === "danger";
  const has = (t: RiskTag) => !!opt.risks?.includes(t);

  let risk: RiskLevel = "low";
  let econ: EconomicImpactLevel = "low";

  if (sectionKey === "chassis" || has("structural")) {
    // Estructura: lo que compromete la integridad es crítico y caro. Pero el
    // chasis usa el catálogo COMÚN, así que por acá también pasan hallazgos
    // meramente cosméticos (un repintado en un estribo). Graduarlo importa
    // porque el impacto económico alimenta un rango en COP que se le muestra
    // al cliente: antes CUALQUIER marca en el chasis —repintado incluido—
    // estimaba 6.000.000–20.000.000.
    risk = danger ? "critical" : "medium";
    if (danger || has("structural")) {
      econ = "critical";
    } else if (isCosmeticWarning(opt)) {
      // Repintado / bien reparado / tema de pintura, sin daño: es trabajo de
      // latonería, no de enderezada de estructura.
      risk = "low";
      econ = "medium";
    } else {
      // Advertencia con daño (rayón, sumido, regular) sobre la estructura.
      econ = sev >= 2 ? "high" : "medium";
    }
  } else if (sectionKey === "roadTest") {
    if (has("braking_fail")) {
      risk = danger ? "critical" : "medium";
      econ = danger ? "high" : "medium";
    } else if (has("mechanical_fail") || danger) {
      risk = "high";
      econ = "high";
    } else {
      risk = "medium";
      econ = "medium";
    }
  } else if (sectionKey === "leaks") {
    if (has("leak_heavy")) {
      risk = "high";
      econ = "medium";
    } else {
      risk = sev >= 2 ? "medium" : "low";
      econ = "low";
    }
  } else if (
    sectionKey === "engine" ||
    sectionKey === "suspension" ||
    sectionKey === "electrical"
  ) {
    if (has("braking_fail")) {
      risk = danger ? "critical" : "medium";
      econ = "high";
    } else if (danger || has("mechanical_fail")) {
      risk = "high";
      econ = "high";
    } else {
      risk = sev >= 2 ? "medium" : "low";
      econ = "medium";
    }
  } else if (sectionKey === "bodywork") {
    if (danger) {
      risk = "medium";
      econ = "medium";
    } else {
      risk = "low";
      // Repintes y reparaciones cosméticas cuestan más que un rayón suelto.
      econ = has("repainted") || has("repaired") || has("replaced") ? "medium" : "low";
    }
  } else if (sectionKey === "tires") {
    risk = "high";
    econ = "medium";
  } else if (sectionKey === "comfort" || sectionKey === "accessories") {
    // Informativos: cuentan en la lista de hallazgos pero pesan poco.
    risk = "low";
    econ = "low";
  } else {
    risk = danger ? "high" : sev >= 2 ? "medium" : "low";
    econ = danger ? "high" : "low";
  }

  return {
    riskLevel: opt.riskLevel ?? risk,
    economicImpact: opt.economicImpact ?? econ,
  };
}

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

/** Riesgos que implican DAÑO real (no solo pintura/repinte). Si un hallazgo los
 *  lleva, NO es cosmético aunque también esté repintado. */
const DAMAGE_RISKS: RiskTag[] = [
  "damage",
  "poor_repair",
  "structural",
  "rust",
  "replaced",
  "missing",
];

/**
 * Una advertencia es "cosmética" cuando solo refleja pintura / repinte / retoque
 * previo (repintado, bien reparado, tema de pintura) SIN daño estructural ni de
 * chapa. En el chasis un repinte es muy común en usados y no compromete la
 * estructura, así que pesa mucho menos que un golpe o un larguero sumido.
 */
function isCosmeticWarning(opt: FindingOption): boolean {
  if (opt.tone !== "warning") return false;
  if (DAMAGE_RISKS.some((r) => hasRisk(opt, r))) return false;
  return (
    hasRisk(opt, "repainted") ||
    hasRisk(opt, "repaired") ||
    hasRisk(opt, "paint_issue")
  );
}

/**
 * Tratamiento estructural en el CHASIS. Los ítems del chasis usan el catálogo
 * COMMON (compartido con carrocería/mecánica), cuyas opciones de daño NO llevan
 * la etiqueta `structural`. Pero sobre la estructura del vehículo esos mismos
 * hallazgos SÍ son estructurales, así que aquí se reinterpretan según el
 * contexto (sección chasis):
 *  - tono `danger` ("Deformado", "Mal reparado") o etiqueta `structural`
 *    explícita (catálogo STRUCTURAL legacy) → daño estructural confirmado:
 *    dispara el gate duro de "Daño estructural" (fuerza Riesgo Alto) y pesa al
 *    máximo del ítem.
 *  - tono `warning` ("Regular", etc.) → penalización media: pesa más que en una
 *    pieza cosmética, pero NO es estructural ni fuerza Riesgo Alto.
 * Los pesos (5 / 3) son del negocio; tocarlos aquí impacta el % de TODO chasis.
 */
function isChassisStructuralHit(opt: FindingOption): boolean {
  return opt.tone === "danger" || hasRisk(opt, "structural");
}

function chassisExtraPenalty(opt: FindingOption): number {
  if (isChassisStructuralHit(opt)) return 5; // daño estructural confirmado
  if (opt.tone === "warning") return 3; // p.ej. "Regular": penalización media
  return 0;
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

/**
 * Inventario de carrocería que le corresponde a ESTE peritaje.
 *
 * Es obligatorio resolverlo por `vehicleType`: el wizard y el PDF ya lo hacen
 * (`bodyworkSectionFor`), y `entriesOf` itera los ítems de la *definición*, así
 * que usar la variante de sedán contra los datos de una moto hacía que los 18
 * paneles capturados no coincidieran con ningún id y se ignoraran en silencio
 * — una moto con todo deformado calificaba 100 %.
 */
function bodyworkDefFor(data: InspectionData) {
  return bodyworkSectionFor(data.vehicleType ?? FALLBACK_VEHICLE_TYPE);
}

/**
 * Secciones que este peritaje realmente inspecciona (intersección de `kind` y
 * `vehicleType`), que es lo único que debe calificar.
 *
 * Importa porque `emptySection()` pre-rellena TODAS las secciones del catálogo
 * con su valor "Óptimo", incluidas las que el wizard nunca muestra. El caso
 * vivo es `engine`: no está en ningún kind (ver COMMON_SECTIONS), el wizard la
 * oculta y el PDF no la imprime, pero sus 7 ítems fantasma entraban al pilar
 * de mecánica al 100 % y diluían los hallazgos reales de suspensión,
 * eléctrica y fugas.
 */
function activeSectionSet(data: InspectionData): Set<string> {
  return new Set(
    activeSectionsFor(data.kind, data.vehicleType ?? FALLBACK_VEHICLE_TYPE),
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
    airbagsCompromised: 0,
  };
  let score = 0;

  // Helper: arma un RiskFinding clasificándolo (riesgo + impacto económico)
  // según la sección y la opción del catálogo.
  const pushFinding = (
    sectionKey: string,
    level: "info" | "warning" | "critical",
    section: string,
    item: string,
    message: string,
    opt: FindingOption,
  ) => {
    const cls = classifyFinding(sectionKey, opt);
    findings.push({
      level,
      section,
      item,
      message,
      riskLevel: cls.riskLevel,
      economicImpact: cls.economicImpact,
    });
  };

  const active = activeSectionSet(data);

  // --- Bodywork ---
  // Piso y refuerzos de carrocería viven en data.chassis (se capturan en la
  // etapa de estructura) pero califican como carrocería (decisión de producto,
  // ver CHASSIS_ITEMS_SCORED_AS_BODYWORK): mismos counters y severidad que el
  // resto de la carrocería, sin bono estructural ni gate de chasis.
  const bodyworkSources: {
    def: InspectionSectionDef;
    record?: Record<string, InspectionEntry>;
  }[] = [
    { def: bodyworkDefFor(data), record: data.bodywork },
    { def: CHASSIS_BODYWORK_GROUP, record: data.chassis },
  ];
  for (const src of bodyworkSources) {
    for (const { opt, label } of entriesOf(src.def, src.record)) {
      if (!opt) continue;
      if (hasRisk(opt, "repainted")) counters.repainted += 1;
      if (hasRisk(opt, "repaired")) counters.repaired += 1;
      if (hasRisk(opt, "poor_repair")) counters.poorlyRepaired += 1;
      if (hasRisk(opt, "damage")) counters.damaged += 1;
      if (hasRisk(opt, "rust")) counters.rustHits += 1;

      const lvl = catalogLevel(opt);
      if (lvl) {
        pushFinding("bodywork", lvl, "Carrocería", label, opt.label, opt);
        score += catalogSeverityScore(opt);
      }
    }
  }

  // --- Structural / chassis ---
  for (const { opt, label } of entriesOf(CHASSIS_STRUCTURAL_SECTION, data.chassis)) {
    if (!opt) continue;
    if (isChassisStructuralHit(opt)) counters.structuralHits += 1;
    if (hasRisk(opt, "poor_repair")) counters.poorlyRepaired += 1;
    if (hasRisk(opt, "rust")) counters.rustHits += 1;

    const lvl = catalogLevel(opt);
    if (lvl) {
      pushFinding("chassis", lvl, "Chasis / Estructura", label, opt.label, opt);
      // En el chasis los hallazgos pesan extra (estructural +5, advertencia +3).
      score += catalogSeverityScore(opt) + chassisExtraPenalty(opt);
    }
  }

  // --- Leaks (ahora parte del pilar de mecánica) ---
  for (const { opt, label } of entriesOf(LEAKS_SECTION, data.leaks)) {
    if (!opt) continue;
    if (hasRisk(opt, "leak_heavy")) counters.criticalLeaks += 1;

    const lvl = catalogLevel(opt);
    if (lvl) {
      pushFinding("leaks", lvl, "Fugas", label, opt.label, opt);
      score += catalogSeverityScore(opt);
    }
  }

  // --- Mechanical sections (engine, suspension, electrical, comfort) ---
  const mechanicalSources: {
    section: InspectionSectionDef;
    data?: Record<string, InspectionEntry>;
    sectionLabel: string;
    sectionKey: string;
  }[] = [
    { section: SUSPENSION_SECTION, data: data.suspension, sectionLabel: "Suspensión / Dirección", sectionKey: "suspension" },
    { section: ELECTRICAL_SECTION, data: data.electrical, sectionLabel: "Eléctrico", sectionKey: "electrical" },
    { section: COMFORT_SECTION, data: data.comfort, sectionLabel: "Confort", sectionKey: "comfort" },
  ];
  for (const src of mechanicalSources) {
    if (!active.has(src.sectionKey)) continue;
    for (const { opt, label } of entriesOf(src.section, src.data)) {
      if (!opt) continue;
      if (hasRisk(opt, "mechanical_fail")) counters.mechanicalBad += 1;
      else if (hasRisk(opt, "mechanical_issue")) counters.mechanicalRegular += 1;
      if (hasRisk(opt, "leak_heavy")) counters.criticalLeaks += 1;

      const lvl = catalogLevel(opt);
      if (lvl) {
        pushFinding(src.sectionKey, lvl, src.sectionLabel, label, opt.label, opt);
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
        pushFinding(
          "roadTest",
          isBrakingCritical ? "critical" : lvl,
          "Prueba de ruta",
          label,
          isBrakingCritical && itemId === "braking"
            ? `${opt.label} — riesgo de seguridad`
            : opt.label,
          opt,
        );
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
      // Llanta lisa: riesgo alto (seguridad), impacto económico medio (cambio).
      findings.push({
        level: "critical",
        section: "Llantas",
        item: t.name,
        message: `Desgaste crítico (${t.v}%)`,
        riskLevel: "high",
        economicImpact: "medium",
      });
      score += 8;
    } else if (t.v <= 50) {
      findings.push({
        level: "warning",
        section: "Llantas",
        item: t.name,
        message: `Desgaste moderado (${t.v}%)`,
        riskLevel: "low",
        economicImpact: "low",
      });
      score += 2;
    }
  }

  // --- Risk level ---
  // FUENTE ÚNICA: el nivel se deriva del MISMO % global ponderado que muestra el
  // PDF (computePillars) más los gates de seguridad. Así el número y el veredicto
  // (Bajo/Medio/Alto) nunca se contradicen. computePillars solo necesita los
  // counters para evaluar los gates.
  const health = computeHealth(data);
  const pillars = computePillars(health, { counters });
  let level: RiskLevel = riskLevelFromPillars(pillars.globalPct, pillars.gates);
  // Complemento: unos pocos contadores GRAVES escalan a medio aunque el % global
  // salga alto (p. ej. 2 fallas mecánicas confirmadas en un carro por lo demás
  // sano). Los daños ESTÉTICOS (carrocería/pintura) NO escalan el riesgo — la
  // carrocería es valor comercial, no seguridad — así que `damaged` ya no entra
  // aquí. Solo mueven el riesgo la mecánica y las llantas.
  const graveCounters =
    counters.mechanicalBad >= 2 ||
    counters.tiresCritical >= 1;
  if (level === "low" && graveCounters) level = "medium";

  // Headline puramente descriptivo: el perito reporta hallazgos, NO opina sobre
  // riesgo ni recomienda comprar/no comprar. Esa interpretación la hace la
  // aseguradora o el cliente con los datos del peritaje.
  const headline =
    level === "critical"
      ? "Hallazgos de seguridad críticos detectados en la inspección"
      : level === "high"
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

  // Dimensión económica: independiente del riesgo. Un repinte sube costo pero
  // no riesgo; una llanta lisa sube riesgo y algo de costo.
  const economicImpact = economicLevelFromFindings(findings);
  const estimatedRepairCost = estimateRepairCost(findings);

  const executiveSummary = buildExecutiveSummary(
    pillars.globalPct,
    level,
    economicImpact,
  );

  findings.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 } as const;
    return order[a.level] - order[b.level];
  });

  return {
    level,
    score,
    findings,
    counters,
    economicImpact,
    estimatedRepairCost,
    headline,
    conditionSummary,
    executiveSummary,
  };
}

/**
 * Resumen ejecutivo descriptivo (no aconseja comprar/no comprar). Combina las
 * tres lecturas que el comprador necesita: condición técnica (Salud General),
 * riesgo operativo y costo potencial de reparación.
 */
function buildExecutiveSummary(
  globalPct: number | null,
  level: RiskLevel,
  econ: EconomicImpactLevel,
): string {
  const condicion =
    globalPct === null
      ? "El vehículo aún no tiene suficientes ítems inspeccionados para una nota técnica."
      : globalPct >= 80
        ? `El vehículo presenta una condición técnica buena (${globalPct}%).`
        : globalPct >= 60
          ? `El vehículo presenta una condición técnica aceptable (${globalPct}%).`
          : `El vehículo presenta una condición técnica deficiente (${globalPct}%).`;

  const riesgo =
    level === "critical"
      ? "Se detectaron hallazgos de seguridad críticos que comprometen la operación del vehículo."
      : level === "high"
        ? "Se detectaron hallazgos que elevan el riesgo operativo."
        : level === "medium"
          ? "Se detectaron hallazgos relevantes a tener en cuenta."
          : "No se detectaron hallazgos que eleven el riesgo de forma significativa.";

  const costo =
    econ === "critical"
      ? "El impacto económico potencial de reparación es crítico."
      : econ === "high"
        ? "El impacto económico potencial de reparación es alto."
        : econ === "medium"
          ? "El impacto económico potencial de reparación es moderado."
          : "El impacto económico potencial de reparación es bajo.";

  return `${condicion} ${riesgo} ${costo}`;
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
  /** Suma de severidades (catálogo) de los hallazgos con tono `warning`. Permite
   *  que el modo "flat" descuente por severidad (repintado sev1 pesa menos que
   *  sumido sev2) en vez de un −N plano por conteo. */
  warnSeverity: number;
  /** Subconjunto de `warnSeverity` aportado por advertencias COSMÉTICAS (solo
   *  pintura/repinte, sin daño — ver `isCosmeticWarning`). El modo "flat"
   *  severity-weighted lo descuenta con un peso menor (`cosmeticDrop`). */
  warnSeverityCosmetic: number;
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
  return { inspected: 0, ok: 0, warning: 0, danger: 0, warnSeverity: 0, warnSeverityCosmetic: 0, penalty: 0, maxPenalty: 0, healthPct: null };
}

/**
 * Calibración de la salud por sección (decisión de negocio).
 *
 * A diferencia del cálculo anterior, la salud NO se diluye por la cantidad de
 * ítems OK: cada punto de penalización del catálogo resta porcentaje en
 * términos absolutos, así muchas advertencias acumuladas o pocos críticos
 * hunden la sección sin importar cuántos ítems sanos la acompañen. Además, cada
 * hallazgo crítico (tono `danger`) impone un techo a la salud de la sección.
 *
 * `maxPenalty`/`inspected` siguen guardándose como dato de auditoría, pero ya no
 * definen el porcentaje. Tocar PENALTY_DIVISOR o los techos impacta el % de
 * TODOS los peritajes — discutir con el equipo antes de ajustarlos.
 */
const PENALTY_DIVISOR = 2; // cada punto de penalización resta 1/2 punto porcentual

function criticalCap(danger: number): number {
  if (danger >= 4) return 30;
  if (danger === 3) return 45;
  if (danger === 2) return 60;
  if (danger === 1) return 80;
  return 100;
}

/**
 * Calibración del % por sección (decisión de negocio). Tres modos:
 *  - "flat" (ESTRUCTURA Y SEGURIDAD — chasis, prueba de ruta): descuento PLANO
 *    por hallazgo, fácil de explicar: cada advertencia −10, cada crítico −20.
 *    Aquí las advertencias SÍ pesan (antes apenas restaban) y un crítico duele.
 *  - "flat" suave (CARROCERÍA, estético): descuento plano leve — cada
 *    advertencia −1, cada crítico −3. Un golpe cosmético no debe desplomar la
 *    sección (es valor comercial, no seguridad).
 *  - default (resto: motor, suspensión, eléctrico, fugas, llantas, etc.):
 *    penalización absoluta por severidad + techo por # de críticos.
 * Tocar estos números impacta el % de TODOS los peritajes — discutir antes.
 */
type SectionCalib =
  | {
      mode: "flat";
      warningDrop: number;
      criticalDrop: number;
      /** Si es true, `warningDrop` se multiplica por la SEVERIDAD del hallazgo
       *  (sev1×drop, sev2×2·drop…) en vez de aplicarse plano por advertencia.
       *  Así un "Repintado" (sev1) pesa menos que un "Sumido" (sev2), y una
       *  sección con muchos ítems no se desploma a 0% por advertencias leves. */
      severityWeighted?: boolean;
      /** Descuento por punto de severidad para advertencias COSMÉTICAS (solo
       *  pintura/repinte, sin daño). Solo aplica con `severityWeighted`. Si se
       *  omite, las cosméticas pesan igual que las demás (`warningDrop`). Un
       *  repinte de chasis es común y no compromete la estructura → pesa poco. */
      cosmeticDrop?: number;
    }
  | { mode: "penalty"; divisor?: number; applyCriticalCap?: boolean };

const SECTION_CALIBRATION: Record<string, SectionCalib> = {
  // Estructura (chasis): descuento por SEVERIDAD (no plano por conteo). Antes era
  // −10 plano por cada advertencia, lo que hundía a 0% cualquier chasis con
  // ≥10 ítems marcados aunque fueran repintes cosméticos (sev1). Ahora:
  //  - advertencia con DAÑO (sumido, regular, rayón): −3 por punto de severidad
  //    → sumido (sev2) −6.
  //  - advertencia COSMÉTICA (repintado, bien reparado): −1 por punto → un
  //    repinte (sev1) resta solo 1. Un repinte de chasis es común en usados y no
  //    compromete la estructura, no debe hundir la nota.
  //  - daño real (deformado / mal reparado) es tono `danger` → criticalDrop −20.
  chassis: { mode: "flat", warningDrop: 3, criticalDrop: 20, severityWeighted: true, cosmeticDrop: 1 },
  roadTest: { mode: "flat", warningDrop: 10, criticalDrop: 20 },
  // Carrocería/pintura: descuento plano SUAVE (estético) — advertencia −1,
  // crítico −3. Un golpe/repinte resta poco; no debe hundir la sección
  // (es valor comercial, no seguridad). Decisión de negocio.
  bodywork: { mode: "flat", warningDrop: 1, criticalDrop: 3 },
};

/** Salud de una sección por penalización absoluta (anti-dilución) + techo por #
 *  de críticos. La calibración puede suavizar el divisor o desactivar el techo. */
export function sectionHealthPct(
  penalty: number,
  danger: number,
  opts?: { divisor?: number; applyCriticalCap?: boolean },
): number {
  const divisor = opts?.divisor ?? PENALTY_DIVISOR;
  const applyCap = opts?.applyCriticalCap ?? true;
  const fromPenalty = 100 - penalty / divisor;
  const capped = applyCap ? Math.min(fromPenalty, criticalCap(danger)) : fromPenalty;
  return Math.max(0, Math.min(100, Math.round(capped)));
}

/** Resuelve el % de una sección según su calibración. El modo "flat" usa los
 *  CONTEOS de advertencias/críticos (descuento plano); los demás usan
 *  `sectionHealthPct` (penalización por severidad). */
function sectionPct(s: SectionHealth, calib: SectionCalib | undefined): number {
  if (calib?.mode === "flat") {
    let warnDrop: number;
    if (calib.severityWeighted) {
      // Las advertencias cosméticas (repinte) pesan con `cosmeticDrop`; el resto
      // (daño) con `warningDrop`, ambas escaladas por severidad.
      const cosmeticSeverity = s.warnSeverityCosmetic;
      const damageSeverity = s.warnSeverity - cosmeticSeverity;
      const cosmeticDrop = calib.cosmeticDrop ?? calib.warningDrop;
      warnDrop = damageSeverity * calib.warningDrop + cosmeticSeverity * cosmeticDrop;
    } else {
      warnDrop = s.warning * calib.warningDrop;
    }
    const drop = warnDrop + s.danger * calib.criticalDrop;
    return Math.max(0, Math.min(100, Math.round(100 - drop)));
  }
  return sectionHealthPct(
    s.penalty,
    s.danger,
    calib?.mode === "penalty"
      ? { divisor: calib.divisor, applyCriticalCap: calib.applyCriticalCap }
      : undefined,
  );
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
    if (opt.tone === "warning") {
      target.warning += 1;
      const sev = opt.severity ?? 1;
      target.warnSeverity += sev;
      if (isCosmeticWarning(opt)) target.warnSeverityCosmetic += sev;
    } else if (opt.tone === "danger") target.danger += 1;
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

  // Solo se califica lo que este peritaje realmente inspecciona. Una sección
  // inactiva queda con inspected = 0 y por lo tanto healthPct = null, así no
  // entra al promedio del pilar (ver activeSectionSet).
  const active = activeSectionSet(data);
  const scores = (key: string) => active.has(key);

  if (scores("bodywork")) {
    processSectionInto(sections.bodywork, bodyworkDefFor(data), data.bodywork);
  }
  if (scores("chassis")) {
    // Piso y refuerzos: capturados con el chasis, calificados como carrocería
    // (ver CHASSIS_ITEMS_SCORED_AS_BODYWORK) — entran a la salud de bodywork
    // con su calibración estética, sin el bono de penalización del chasis.
    processSectionInto(sections.bodywork, CHASSIS_BODYWORK_GROUP, data.chassis);
    processSectionInto(sections.chassis, CHASSIS_STRUCTURAL_SECTION, data.chassis, chassisExtraPenalty);
  }
  if (scores("suspension")) {
    processSectionInto(sections.suspension, SUSPENSION_SECTION, data.suspension);
  }
  if (scores("electrical")) {
    processSectionInto(sections.electrical, ELECTRICAL_SECTION, data.electrical);
  }
  if (scores("leaks")) {
    processSectionInto(sections.leaks, LEAKS_SECTION, data.leaks);
  }
  if (scores("comfort")) {
    processSectionInto(sections.comfort, COMFORT_SECTION, data.comfort);
  }
  if (scores("roadTest") && !data.roadTestSkipped) {
    processSectionInto(sections.roadTest, ROAD_TEST_SECTION, data.roadTest, (opt) =>
      hasRisk(opt, "braking_fail") && opt.tone === "danger" ? 5 : 0,
    );
  }

  // Tires: same buckets and weights analyze() uses (8 critical, 2 moderate)
  if (scores("tires")) {
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
  }

  // Accesorios: ahora son informativos (solo presencia, sin estado), así que
  // no contribuyen al cálculo de salud ni al pillar de equipo. Quedan en el
  // mapa con healthPct = null para que el pilar `equipment` solo dependa de
  // las llantas.

  for (const key of Object.keys(sections)) {
    const s = sections[key];
    const perItemMax = MAX_PENALTY_PER_ITEM[key] ?? 15;
    s.maxPenalty = s.inspected * perItemMax; // referencia/auditoría — ya no define el %
    s.healthPct = s.inspected === 0 ? null : sectionPct(s, SECTION_CALIBRATION[key]);
  }

  // Salud global: promedio de las secciones inspeccionadas ponderado por la
  // cantidad de ítems (una sección con más ítems pesa más). No vuelve a poolear
  // penalizaciones, para que el techo por críticos de cada sección se respete.
  const global = emptyHealth();
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of Object.values(sections)) {
    global.inspected += s.inspected;
    global.ok += s.ok;
    global.warning += s.warning;
    global.danger += s.danger;
    global.warnSeverity += s.warnSeverity;
    global.warnSeverityCosmetic += s.warnSeverityCosmetic;
    global.penalty += s.penalty;
    global.maxPenalty += s.maxPenalty;
    if (s.healthPct !== null) {
      weightedSum += s.healthPct * s.inspected;
      weightTotal += s.inspected;
    }
  }
  global.healthPct = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

  return { global, bySection: sections };
}
