import type { ItemKind } from "./types";

export type Tone = "success" | "warning" | "danger" | "neutral";

export type RiskTag =
  | "original"
  | "repainted"
  | "repaired"
  | "poor_repair"
  | "damage"
  | "structural"
  | "rust"
  | "glass"
  | "light"
  | "leak_light"
  | "leak_heavy"
  | "paint_issue"
  | "fit"
  | "missing"
  | "replaced"
  | "mechanical_issue"
  | "mechanical_fail"
  | "braking_fail"
  | "electrical_fail"
  | "na";

export type FindingOption = {
  value: string;
  label: string;
  tone: Tone;
  severity?: 1 | 2 | 3;
  risks?: RiskTag[];
};

export type FindingCategory = {
  label: string;
  options: FindingOption[];
};

export type FindingCatalog = {
  /** Common quick-picks shown as chips. First item is the "default OK" value for bulk actions. */
  quick: FindingOption[];
  categories: FindingCategory[];
};

/* -----------------------------------------------------------
 *  BODYWORK — exterior panels, glass, lights
 * --------------------------------------------------------- */
const BODYWORK_CATALOG: FindingCatalog = {
  quick: [
    { value: "original", label: "Original", tone: "success", risks: ["original"] },
    { value: "na", label: "N/A", tone: "neutral", risks: ["na"] },
  ],
  categories: [
    {
      label: "Pintura",
      options: [
        { value: "repainted_full", label: "Repintado total de pieza", tone: "warning", severity: 1, risks: ["repainted"] },
        { value: "repainted_partial", label: "Repintado parcial (detalle)", tone: "warning", severity: 1, risks: ["repainted"] },
        { value: "paint_mismatch_mild", label: "Diferencia de tono leve", tone: "warning", severity: 1, risks: ["paint_issue"] },
        { value: "paint_mismatch_strong", label: "Diferencia de tono marcada", tone: "warning", severity: 2, risks: ["paint_issue", "poor_repair"] },
        { value: "orange_peel", label: "Piel de naranja", tone: "warning", severity: 1, risks: ["paint_issue"] },
        { value: "paint_runs", label: "Chorreo / corrido", tone: "warning", severity: 2, risks: ["paint_issue", "poor_repair"] },
        { value: "polish_halo", label: "Pulida con halo", tone: "warning", severity: 1, risks: ["paint_issue"] },
        { value: "overspray", label: "Overspray (sobrepintado)", tone: "warning", severity: 2, risks: ["paint_issue", "poor_repair"] },
        { value: "paint_peeling", label: "Pintura descascarada", tone: "danger", severity: 2, risks: ["paint_issue", "damage"] },
      ],
    },
    {
      label: "Rayones",
      options: [
        { value: "scratch_surface", label: "Rayón superficial", tone: "warning", severity: 1, risks: ["damage"] },
        { value: "scratch_deep", label: "Rayón profundo (marca base)", tone: "danger", severity: 2, risks: ["damage"] },
        { value: "scratches_multiple", label: "Múltiples rayones", tone: "danger", severity: 2, risks: ["damage"] },
      ],
    },
    {
      label: "Abolladuras",
      options: [
        { value: "dent_mild", label: "Abolladura leve (< 5 cm)", tone: "warning", severity: 1, risks: ["damage"] },
        { value: "dent_moderate", label: "Abolladura moderada", tone: "warning", severity: 2, risks: ["damage"] },
        { value: "dent_deep", label: "Abolladura profunda", tone: "danger", severity: 3, risks: ["damage"] },
        { value: "dent_creased", label: "Abolladura con arruga", tone: "danger", severity: 3, risks: ["damage"] },
      ],
    },
    {
      label: "Reparaciones",
      options: [
        { value: "repair_good", label: "Reparación correcta", tone: "warning", severity: 1, risks: ["repaired"] },
        { value: "repair_poor", label: "Reparación deficiente", tone: "danger", severity: 3, risks: ["poor_repair", "repaired"] },
        { value: "panel_replaced_ok", label: "Pieza reemplazada correctamente", tone: "warning", severity: 1, risks: ["replaced"] },
        { value: "panel_replaced_bad", label: "Pieza reemplazada incorrectamente", tone: "danger", severity: 3, risks: ["poor_repair", "replaced"] },
      ],
    },
    {
      label: "Golpes",
      options: [
        { value: "impact_deformation", label: "Golpe con deformación", tone: "danger", severity: 3, risks: ["damage"] },
        { value: "impact_crease", label: "Golpe con arruga larga", tone: "danger", severity: 3, risks: ["damage"] },
      ],
    },
    {
      label: "Óxido",
      options: [
        { value: "rust_surface", label: "Óxido superficial", tone: "warning", severity: 1, risks: ["rust"] },
        { value: "rust_deep", label: "Óxido profundo", tone: "danger", severity: 2, risks: ["rust", "damage"] },
        { value: "rust_perforating", label: "Óxido perforante", tone: "danger", severity: 3, risks: ["rust", "damage"] },
      ],
    },
    {
      label: "Vidrios y faros",
      options: [
        { value: "glass_chip", label: "Vidrio con trizadura leve", tone: "warning", severity: 1, risks: ["glass"] },
        { value: "glass_crack", label: "Vidrio con fisura larga", tone: "danger", severity: 2, risks: ["glass", "damage"] },
        { value: "glass_broken", label: "Vidrio roto", tone: "danger", severity: 3, risks: ["glass", "damage"] },
        { value: "light_foggy", label: "Faro opaco / amarillento", tone: "warning", severity: 1, risks: ["light"] },
        { value: "light_cracked", label: "Faro trizado", tone: "warning", severity: 2, risks: ["light", "damage"] },
        { value: "light_broken", label: "Faro roto", tone: "danger", severity: 3, risks: ["light", "damage"] },
      ],
    },
    {
      label: "Otros",
      options: [
        { value: "loose_fit", label: "Desajuste / encaje irregular", tone: "warning", severity: 2, risks: ["fit", "poor_repair"] },
        { value: "crack", label: "Fisura / grieta", tone: "danger", severity: 2, risks: ["damage"] },
        { value: "missing_part", label: "Pieza faltante", tone: "danger", severity: 2, risks: ["missing"] },
      ],
    },
  ],
};

/* -----------------------------------------------------------
 *  STRUCTURAL — chassis, pillars, rails, welds
 * --------------------------------------------------------- */
const STRUCTURAL_CATALOG: FindingCatalog = {
  quick: [
    { value: "structural_original", label: "Sin intervención", tone: "success", risks: ["original"] },
    { value: "na", label: "N/A", tone: "neutral", risks: ["na"] },
  ],
  categories: [
    {
      label: "Reparación estructural",
      options: [
        { value: "struct_repair_bench", label: "Reparación con bancada", tone: "warning", severity: 2, risks: ["structural", "repaired"] },
        { value: "struct_welded_later", label: "Soldadura posterior (no original)", tone: "warning", severity: 2, risks: ["structural", "repaired"] },
        { value: "struct_panel_replaced", label: "Pieza reemplazada correctamente", tone: "warning", severity: 2, risks: ["structural", "replaced"] },
        { value: "struct_panel_replaced_bad", label: "Pieza reemplazada incorrectamente", tone: "danger", severity: 3, risks: ["structural", "poor_repair", "replaced"] },
        { value: "struct_weld_bad", label: "Soldadura deficiente", tone: "danger", severity: 3, risks: ["structural", "poor_repair"] },
      ],
    },
    {
      label: "Deformación",
      options: [
        { value: "struct_deform_mild", label: "Deformación leve", tone: "warning", severity: 2, risks: ["structural", "damage"] },
        { value: "struct_deform_moderate", label: "Deformación moderada", tone: "danger", severity: 3, risks: ["structural", "damage"] },
        { value: "struct_deform_severe", label: "Deformación severa", tone: "danger", severity: 3, risks: ["structural", "damage"] },
      ],
    },
    {
      label: "Corrosión",
      options: [
        { value: "struct_rust_surface", label: "Óxido superficial", tone: "warning", severity: 2, risks: ["structural", "rust"] },
        { value: "struct_rust_deep", label: "Óxido estructural profundo", tone: "danger", severity: 3, risks: ["structural", "rust", "damage"] },
        { value: "struct_material_loss", label: "Pérdida de material", tone: "danger", severity: 3, risks: ["structural", "damage"] },
      ],
    },
  ],
};

/* -----------------------------------------------------------
 *  MECHANICAL — engine, suspension, electrical, comfort
 * --------------------------------------------------------- */
const MECHANICAL_CATALOG: FindingCatalog = {
  quick: [
    { value: "mech_optimal", label: "Óptimo", tone: "success" },
    { value: "na", label: "N/A", tone: "neutral", risks: ["na"] },
  ],
  categories: [
    {
      label: "Observaciones",
      options: [
        { value: "mech_noise_light", label: "Ruido leve, operación normal", tone: "warning", severity: 1, risks: ["mechanical_issue"] },
        { value: "mech_vibration", label: "Vibración detectable", tone: "warning", severity: 1, risks: ["mechanical_issue"] },
        { value: "mech_play_in_tolerance", label: "Holgura dentro de tolerancia", tone: "warning", severity: 1, risks: ["mechanical_issue"] },
        { value: "mech_wear_light", label: "Desgaste leve", tone: "warning", severity: 1, risks: ["mechanical_issue"] },
        { value: "mech_dirty", label: "Suciedad / obstrucción acumulada", tone: "warning", severity: 1, risks: ["mechanical_issue"] },
        { value: "mech_loose_belt", label: "Correa floja", tone: "warning", severity: 1, risks: ["mechanical_issue"] },
        { value: "mech_fluid_low", label: "Nivel de fluido bajo", tone: "warning", severity: 1, risks: ["mechanical_issue"] },
      ],
    },
    {
      label: "Fallas",
      options: [
        { value: "mech_play_out_tolerance", label: "Holgura fuera de tolerancia", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "mech_leak_seal", label: "Fuga leve por sello", tone: "warning", severity: 2, risks: ["mechanical_issue", "leak_light"] },
        { value: "mech_leak_active", label: "Fuga activa", tone: "danger", severity: 3, risks: ["mechanical_fail", "leak_heavy"] },
        { value: "mech_noise_metal", label: "Ruido metálico / golpeteo", tone: "danger", severity: 2, risks: ["mechanical_fail"] },
        { value: "mech_vibration_severe", label: "Vibración severa", tone: "danger", severity: 2, risks: ["mechanical_fail"] },
        { value: "mech_smoke", label: "Humo anormal", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "mech_overheat", label: "Sobrecalentamiento", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "mech_warning_light", label: "Testigo encendido", tone: "danger", severity: 2, risks: ["mechanical_fail", "electrical_fail"] },
        { value: "mech_intermittent", label: "Operación intermitente", tone: "warning", severity: 2, risks: ["mechanical_issue"] },
        { value: "mech_no_response", label: "No responde / no funciona", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "mech_wear_severe", label: "Desgaste severo", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
      ],
    },
  ],
};

/* -----------------------------------------------------------
 *  ROAD TEST — how the vehicle performs on a drive
 * --------------------------------------------------------- */
const ROAD_TEST_CATALOG: FindingCatalog = {
  quick: [
    { value: "road_optimal", label: "Sin observaciones", tone: "success" },
  ],
  categories: [
    {
      label: "Observaciones",
      options: [
        { value: "road_pulls_left", label: "Jala a la izquierda", tone: "warning", severity: 2, risks: ["mechanical_issue"] },
        { value: "road_pulls_right", label: "Jala a la derecha", tone: "warning", severity: 2, risks: ["mechanical_issue"] },
        { value: "road_vibration_high_speed", label: "Vibración a alta velocidad", tone: "warning", severity: 2, risks: ["mechanical_issue"] },
        { value: "road_pedal_low", label: "Pedal de freno bajo", tone: "warning", severity: 2, risks: ["braking_fail"] },
        { value: "road_pedal_spongy", label: "Pedal de freno esponjoso", tone: "warning", severity: 2, risks: ["braking_fail"] },
        { value: "road_abs_intermittent", label: "ABS interviene intermitente", tone: "warning", severity: 2, risks: ["braking_fail"] },
        { value: "road_noise_metal", label: "Ruido metálico en marcha", tone: "warning", severity: 2, risks: ["mechanical_issue"] },
        { value: "road_shift_delay", label: "Cambios con demora", tone: "warning", severity: 2, risks: ["mechanical_issue"] },
        { value: "road_loss_power_mild", label: "Leve pérdida de potencia", tone: "warning", severity: 2, risks: ["mechanical_issue"] },
      ],
    },
    {
      label: "Fallas",
      options: [
        { value: "road_braking_deficient", label: "Frenado deficiente (no detiene adecuado)", tone: "danger", severity: 3, risks: ["braking_fail", "mechanical_fail"] },
        { value: "road_brake_pulls", label: "Jala al frenar (peligroso)", tone: "danger", severity: 3, risks: ["braking_fail"] },
        { value: "road_shift_hard", label: "Cambios golpean", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "road_shift_slip", label: "Cambios patinan", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "road_no_start", label: "No enciende / arranque fallido", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "road_vibration_severe", label: "Vibración severa", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "road_loss_power_severe", label: "Pérdida de potencia severa", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
        { value: "road_overheat", label: "Sobrecalentamiento en marcha", tone: "danger", severity: 3, risks: ["mechanical_fail"] },
      ],
    },
  ],
};

/* -----------------------------------------------------------
 *  LEAKS — by location + rhythm
 * --------------------------------------------------------- */
const LEAK_CATALOG: FindingCatalog = {
  quick: [
    { value: "leak_none", label: "Sin fugas", tone: "success" },
  ],
  categories: [
    {
      label: "Humedad",
      options: [
        { value: "leak_humid", label: "Húmedo sin goteo", tone: "warning", severity: 1, risks: ["leak_light"] },
        { value: "leak_sweating", label: "Sellos sudados", tone: "warning", severity: 1, risks: ["leak_light"] },
      ],
    },
    {
      label: "Goteo",
      options: [
        { value: "leak_slow", label: "Goteo lento (< 1 gota / min)", tone: "warning", severity: 2, risks: ["leak_light"] },
        { value: "leak_active", label: "Goteo activo", tone: "danger", severity: 2, risks: ["leak_heavy"] },
        { value: "leak_puddle", label: "Charco visible bajo vehículo", tone: "danger", severity: 3, risks: ["leak_heavy"] },
        { value: "leak_fuel", label: "Fuga de combustible (riesgo)", tone: "danger", severity: 3, risks: ["leak_heavy"] },
      ],
    },
  ],
};

export const FINDING_CATALOGS: Record<ItemKind, FindingCatalog> = {
  bodywork: BODYWORK_CATALOG,
  structural: STRUCTURAL_CATALOG,
  mechanical: MECHANICAL_CATALOG,
  road_test: ROAD_TEST_CATALOG,
  leak: LEAK_CATALOG,
};

/** Flat lookup across all catalogs — useful for rendering a known value outside of context. */
const ALL_FINDINGS_BY_VALUE = new Map<string, FindingOption>();
for (const catalog of Object.values(FINDING_CATALOGS)) {
  for (const opt of catalog.quick) ALL_FINDINGS_BY_VALUE.set(opt.value, opt);
  for (const cat of catalog.categories) {
    for (const opt of cat.options) ALL_FINDINGS_BY_VALUE.set(opt.value, opt);
  }
}

export function findOption(value: string | undefined): FindingOption | undefined {
  if (!value) return undefined;
  return ALL_FINDINGS_BY_VALUE.get(value);
}

/** The "default OK" finding value for a given item kind. Used by bulk actions. */
export function defaultOkValueFor(kind: ItemKind): string {
  const catalog = FINDING_CATALOGS[kind];
  return catalog.quick.find((q) => q.tone === "success")?.value ?? catalog.quick[0].value;
}

export function isOkFinding(value: string | undefined): boolean {
  const opt = findOption(value);
  return !!opt && (opt.tone === "success" || opt.tone === "neutral");
}

/**
 * Photo is mandatory when the finding carries any observation (warning) or damage (danger).
 * Quick picks like Original / Óptimo / N/A never require a photo.
 */
export function requiresPhoto(value: string | undefined): boolean {
  const opt = findOption(value);
  return !!opt && (opt.tone === "warning" || opt.tone === "danger");
}
