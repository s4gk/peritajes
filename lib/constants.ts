import type { InspectionSectionDef, PeritajeKind, VehicleType } from "./types";

/* -------------------------------------------------------------------------
 *  Wizard steps (UI) vs Data sections (buckets de InspectionData + PDF)
 *  -----------------------------------------------------------------------
 *  El wizard del perito ahora corre 4 pantallas: Vehículo → Recorrido →
 *  Prueba de ruta → Resumen. El "Recorrido" cubre en una sola pantalla todo
 *  el walkaround físico (carrocería + suspensión + llantas + motor + chasis
 *  + eléctrico + interior + accesorios) en orden de inspección.
 *
 *  Aparte, los DATOS siguen guardándose por sección (data.bodywork,
 *  data.suspension, etc.). El PDF se arma con esas secciones agrupadas, en
 *  un orden técnico distinto al recorrido. Por eso separamos:
 *    - StepId  → IDs de pantallas del wizard (4)
 *    - SectionId → IDs de buckets de datos (8-9), usados en PDF
 * ----------------------------------------------------------------------- */

export const WIZARD_STEPS = [
  { id: "vehicle", label: "Vehículo", short: "Datos" },
  // Etapas del recorrido (cada una es un step top-level). Aplican según el
  // tipo de vehículo: car_5doors, suv_*, pickup_* usan las 6 etapas físicas
  // (front/left/rear/right/engine/underside). El resto cae en "general".
  { id: "front", label: "Frente y delantero izquierdo", short: "Frente" },
  { id: "left", label: "Costado izquierdo", short: "Izquierda" },
  { id: "rear", label: "Parte trasera", short: "Trasera" },
  { id: "right", label: "Costado derecho", short: "Derecha" },
  { id: "engine", label: "Motor y accesorios", short: "Motor" },
  { id: "leaks", label: "Fugas de fluidos", short: "Fugas" },
  { id: "underside", label: "Estructura e iluminación", short: "Estructura" },
  { id: "general", label: "Recorrido", short: "Recorrido" },
  { id: "roadTest", label: "Prueba de ruta", short: "Ruta" },
  { id: "extraPhotos", label: "Fotografías adicionales", short: "Fotos" },
  { id: "summary", label: "Resumen y conclusión", short: "Resumen" },
] as const;

export type StepId = (typeof WIZARD_STEPS)[number]["id"];

/** IDs de step que corresponden a etapas del recorrido. */
export const WALKAROUND_STAGE_STEP_IDS = [
  "front",
  "left",
  "rear",
  "right",
  "engine",
  "underside",
  "general",
] as const satisfies readonly StepId[];

export type WalkaroundStageStepId = (typeof WALKAROUND_STAGE_STEP_IDS)[number];

export function isWalkaroundStageStep(s: StepId): s is WalkaroundStageStepId {
  return (WALKAROUND_STAGE_STEP_IDS as readonly StepId[]).includes(s);
}

/** IDs de secciones de datos. Cada uno corresponde a una key de
 *  `InspectionData` (excepto que `tires` y `accessories` tienen su propio
 *  shape custom — ver lib/types.ts). El PDF agrupa hallazgos por estas
 *  secciones; el wizard los captura todos dentro del paso "walkaround"
 *  (más el step roadTest aparte). */
export const SECTION_IDS = [
  "bodywork",
  "chassis",
  "suspension",
  "engine",
  "electrical",
  "comfort",
  "leaks",
  "roadTest",
  "tires",
  "accessories",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** Secciones cubiertas por el paso "walkaround". roadTest y leaks van en sus
 *  propios steps — uno requiere conducir, el otro es un checklist focalizado
 *  de líquidos del motor que se hace estático, sin recorrido. */
export const WALKAROUND_SECTIONS: readonly SectionId[] = [
  "bodywork",
  "chassis",
  "suspension",
  "engine",
  "electrical",
  "comfort",
  "tires",
  "accessories",
];

export type PeritajeKindDef = {
  id: PeritajeKind;
  label: string;
  short: string;
  description: string;
  /** Secciones de datos activas para este tipo de peritaje. Filtran qué
   *  items aparecen en el recorrido y qué secciones se renderizan en el PDF. */
  sections: readonly SectionId[];
};

export const PERITAJE_KINDS: Record<PeritajeKind, PeritajeKindDef> = {
  complete: {
    id: "complete",
    label: "Peritaje completo",
    short: "Completo",
    description:
      "Inspección integral: recorrido completo del vehículo + prueba de ruta. Para entregas formales.",
    sections: [
      "bodywork",
      "chassis",
      "suspension",
      "engine",
      "electrical",
      "comfort",
      "leaks",
      "roadTest",
      "tires",
      "accessories",
    ],
  },
  quick: {
    id: "quick",
    label: "Peritaje rápido",
    short: "Rápido",
    description:
      "Pre-compra ágil. Carrocería, llantas, motor y prueba de ruta — lo justo para decidir si el carro vale la pena.",
    sections: ["bodywork", "tires", "engine", "roadTest"],
  },
  appraisal: {
    id: "appraisal",
    label: "Peritaje de avalúo",
    short: "Avalúo",
    description:
      "Enfoque en valor comercial. Estado visual, llantas, motor y accesorios que mueven el precio.",
    sections: ["bodywork", "tires", "engine", "accessories"],
  },
};

export const DEFAULT_PERITAJE_KIND: PeritajeKind = "complete";

export function sectionsForKind(kind: PeritajeKind): readonly SectionId[] {
  return (PERITAJE_KINDS[kind] ?? PERITAJE_KINDS[DEFAULT_PERITAJE_KIND]).sections;
}

/* -------------------------------------------------------------------------
 *  Tipos de vehículo
 * ----------------------------------------------------------------------- */

export type VehicleTypeDef = {
  id: VehicleType;
  label: string;
  short: string;
  description: string;
  /** Secciones que aplican a este tipo. Se intersecta con las del peritaje
   *  (`PERITAJE_KINDS[kind].sections`). */
  sections: readonly SectionId[];
};

const ALL_SECTION_IDS: readonly SectionId[] = SECTION_IDS;

export const VEHICLE_TYPES: Record<VehicleType, VehicleTypeDef> = {
  car_5doors: {
    id: "car_5doors",
    label: "Sedán",
    short: "Sedán",
    description:
      "Carrocería autoportante: 4 puertas y tapa de baúl, o hatchback.",
    sections: ALL_SECTION_IDS,
  },
  car_coupe: {
    id: "car_coupe",
    label: "Coupé",
    short: "Coupé",
    description:
      "Carrocería autoportante de 2 puertas. Sin puertas traseras.",
    sections: ALL_SECTION_IDS,
  },
  suv_2doors: {
    id: "suv_2doors",
    label: "Campero 3 Puertas",
    short: "Campero 3P",
    description:
      "Chasis separado con 2 puertas laterales y portón trasero (3 puertas).",
    sections: ALL_SECTION_IDS,
  },
  suv_5doors: {
    id: "suv_5doors",
    label: "Campero 5 Puertas",
    short: "Campero 5P",
    description:
      "Chasis separado con 4 puertas y portón trasero.",
    sections: ALL_SECTION_IDS,
  },
  pickup_single: {
    id: "pickup_single",
    label: "Pick Up Sencilla",
    short: "Pick Up",
    description:
      "Camioneta con chasis separado, platón y cabina sencilla (piloto + copiloto).",
    sections: ALL_SECTION_IDS,
  },
  pickup_double: {
    id: "pickup_double",
    label: "Pick Up Doble Cabina",
    short: "Doble Cabina",
    description:
      "Camioneta con chasis separado, platón y cabina de dos plazas (2 ó 4 puertas).",
    sections: ALL_SECTION_IDS,
  },
  bus: {
    id: "bus",
    label: "Bus",
    short: "Bus",
    description:
      "Vehículos para más de 19 pasajeros, incluye buses con estructura autoportante (multitubular).",
    sections: ALL_SECTION_IDS,
  },
  heavy_panel: {
    id: "heavy_panel",
    label: "Pesado Panel",
    short: "Pesado Panel",
    description:
      "Vehículos pesados con cabina adelantada o cabina montada sobre el motor.",
    sections: ALL_SECTION_IDS,
  },
  heavy_conventional: {
    id: "heavy_conventional",
    label: "Pesado Conjunto",
    short: "Pesado Conjunto",
    description:
      "Vehículos pesados con cabina convencional (motor en habitáculo independiente).",
    sections: ALL_SECTION_IDS,
  },
  motorcycle: {
    id: "motorcycle",
    label: "Moto",
    short: "Moto",
    description:
      "Motos, motocarros y cuatrimotos. No usa chasis/suspensión por separado ni confort.",
    sections: [
      "bodywork",
      "engine",
      "electrical",
      "roadTest",
      "tires",
      "accessories",
    ],
  },
  trailer: {
    id: "trailer",
    label: "Tráiler",
    short: "Tráiler",
    description:
      "Remolques (no comparten peso con el camión) y semirremolques (sí comparten peso). Sin motor, eléctrica simplificada.",
    sections: [
      "bodywork",
      "chassis",
      "suspension",
      "tires",
      "accessories",
    ],
  },
};

export const VEHICLE_TYPE_ORDER: VehicleType[] = [
  "car_5doors",
  "car_coupe",
  "suv_2doors",
  "suv_5doors",
  "pickup_single",
  "pickup_double",
  "bus",
  "heavy_panel",
  "heavy_conventional",
  "motorcycle",
  "trailer",
];

/** Fallback usado solo para hidratar peritajes históricos sin `vehicleType`.
 *  El intake fuerza al perito a elegir uno explícitamente. */
export const FALLBACK_VEHICLE_TYPE: VehicleType = "car_5doors";

export function sectionsForVehicleType(type: VehicleType): readonly SectionId[] {
  return (VEHICLE_TYPES[type] ?? VEHICLE_TYPES[FALLBACK_VEHICLE_TYPE]).sections;
}

/** Secciones de datos activas para este peritaje (intersección de kind y
 *  vehicleType). Drives el PDF y el filtro de items del recorrido. */
export function activeSectionsFor(
  kind: PeritajeKind,
  vehicleType: VehicleType,
): readonly SectionId[] {
  const kindSet = new Set(sectionsForKind(kind));
  const vTypeSet = new Set(sectionsForVehicleType(vehicleType));
  return SECTION_IDS.filter((id) => kindSet.has(id) && vTypeSet.has(id));
}

/** Pasos visibles del wizard. Arranca con vehicle; suma cada etapa del
 *  recorrido que tenga al menos un item para el peritaje actual; suma
 *  roadTest si está activa; cierra con summary. */
export function activeStepsFor(
  kind: PeritajeKind,
  vehicleType: VehicleType,
): readonly StepId[] {
  const active = activeSectionsFor(kind, vehicleType);
  const sequence = walkaroundSequenceFor(vehicleType, active);
  const stagesWithEntries = new Set(sequence.map((e) => e.stage));

  const activeSet = new Set(active);
  const steps: StepId[] = ["vehicle"];
  // Mantener el orden de WIZARD_STEPS al expandir etapas. "leaks" ya no es
  // parte del recorrido (es checklist estático aparte) — lo insertamos
  // explícitamente después de "engine" para conservar el orden lógico
  // motor → líquidos → estructura.
  for (const s of WALKAROUND_STAGE_STEP_IDS) {
    if (stagesWithEntries.has(s)) steps.push(s);
    if (s === "engine" && activeSet.has("leaks")) steps.push("leaks");
  }
  // Fallback: si la etapa "engine" no tuvo entries (raro en algunos tipos
  // de vehículo), igual insertamos "leaks" antes de roadTest para no perderlo.
  if (activeSet.has("leaks") && !steps.includes("leaks")) steps.push("leaks");
  if (activeSet.has("roadTest")) steps.push("roadTest");
  // El paso de fotos adicionales aparece siempre — es una galería libre, no
  // depende del tipo de peritaje ni del vehículo. Mejor pedirle al perito que
  // lo confirme (aunque sea vacío) que esconderlo.
  steps.push("extraPhotos");
  steps.push("summary");
  return steps;
}

/* -------------------------------------------------------------------------
 *  Recorrido (walkaround)
 *  -----------------------------------------------------------------------
 *  Secuencia ordenada de items a inspeccionar en el paso "walkaround". Cada
 *  entry apunta a un (sectionId, itemId) — el hallazgo se guarda en el
 *  bucket de datos correspondiente (data.bodywork[itemId], etc.). El PDF
 *  sigue agrupando por sección.
 *
 *  Hay 3 kinds de entrada:
 *   - "item": item regular (carrocería, suspensión, motor, chasis, eléctrico).
 *   - "tire": llanta — abre row inline con profundidad + hallazgo + fotos,
 *     guardado en data.tires (profundidad) + data.tires.findings (resto).
 *   - "compound": ítem compuesto que abre drill-down inline (interior delantero,
 *     accesorios).
 * ----------------------------------------------------------------------- */

import type { TirePosition } from "./types";

/** Etapas del recorrido — agrupan los items físicamente para que el perito
 *  no vea 60 cards apilados, sino zonas del vehículo (frente, costados,
 *  trasera, motor, bajos). El sub-stepper interno del paso "walkaround"
 *  navega entre ellas. */
export type WalkaroundStageId =
  | "front"
  | "left"
  | "rear"
  | "right"
  | "engine"
  | "leaks"
  | "underside"
  | "general";

export type WalkaroundStageDef = {
  id: WalkaroundStageId;
  label: string;
  short: string;
  description: string;
};

export const WALKAROUND_STAGES: readonly WalkaroundStageDef[] = [
  {
    id: "front",
    label: "Frente y delantero izquierdo",
    short: "Frente",
    description: "Capó, punta y guardafangos izquierdos, suspensión y llanta delantera izq.",
  },
  {
    id: "left",
    label: "Costado izquierdo",
    short: "Izquierda",
    description: "De adelante hacia atrás: retrovisor, puertas, parales, estribo, costado, llanta tras. izq.",
  },
  {
    id: "rear",
    label: "Parte trasera",
    short: "Trasera",
    description: "Tapabaúl, bomper, panel y piso, llanta de repuesto, stops y puntas traseras.",
  },
  {
    id: "right",
    label: "Costado derecho",
    short: "Derecha",
    description: "De atrás hacia adelante: costado, parales, puertas, retrovisor, suspensión y llanta del. der.",
  },
  {
    id: "engine",
    label: "Motor y accesorios",
    short: "Motor",
    description: "Estado motor, accesorios, suspensión central, soportes, cárter, bloque, culata.",
  },
  {
    id: "leaks",
    label: "Fugas de fluidos",
    short: "Fugas",
    description: "Aceite motor / caja, refrigerante, líquido de frenos, hidráulico de dirección, AC y diferenciales.",
  },
  {
    id: "underside",
    label: "Estructura e iluminación",
    short: "Estructura",
    description: "Piso y refuerzos de carrocería, iluminación general.",
  },
  // Etapa de fallback usada por el derivador genérico (bus, pesados, moto, tráiler).
  {
    id: "general",
    label: "Recorrido",
    short: "Recorrido",
    description: "Inspección integral del vehículo.",
  },
];

export type WalkaroundEntry =
  | { kind: "item"; stage: WalkaroundStageId; label: string; sectionId: SectionId; itemId: string }
  | { kind: "tire"; stage: WalkaroundStageId; label: string; position: TirePosition }
  | {
      kind: "compound";
      stage: WalkaroundStageId;
      label: string;
      compoundKey: "interior_delantera" | "accessories";
    };

/** Secuencia canónica de 65 items para carro 5p, agrupados en 6 etapas. */
export const WALKAROUND_SEQUENCE_CAR_5DOORS: readonly WalkaroundEntry[] = [
  // ───── Etapa 1: Frente y delantero izquierdo ─────
  { kind: "item", stage: "front", label: "Capó", sectionId: "bodywork", itemId: "hood" },
  { kind: "item", stage: "front", label: "Bomper delantero", sectionId: "bodywork", itemId: "bumper_front" },
  { kind: "item", stage: "front", label: "Punta delantera izquierda", sectionId: "bodywork", itemId: "front_corner_l" },
  { kind: "item", stage: "front", label: "Guardapolvo metálico delantero izquierdo", sectionId: "bodywork", itemId: "inner_fender_fl" },
  { kind: "item", stage: "front", label: "Torre delantera izquierda", sectionId: "suspension", itemId: "strut_tower_l" },
  { kind: "item", stage: "front", label: "Guardafangos delantero izquierdo", sectionId: "bodywork", itemId: "fender_fl" },
  { kind: "item", stage: "front", label: "Amortiguador delantero izquierdo", sectionId: "suspension", itemId: "shock_fl" },
  { kind: "tire", stage: "front", label: "Llanta delantera izquierda", position: "fl" },

  // ───── Etapa 2: Costado izquierdo ─────
  { kind: "item", stage: "left", label: "Retrovisor izquierdo", sectionId: "bodywork", itemId: "mirror_l" },
  { kind: "item", stage: "left", label: "Panorámico delantero (vista izquierda)", sectionId: "bodywork", itemId: "windshield_l" },
  { kind: "item", stage: "left", label: "Puerta delantera izquierda (sellante, carteras, estado interno)", sectionId: "bodywork", itemId: "door_fl" },
  { kind: "item", stage: "left", label: "Paral puerta delantera izquierda", sectionId: "bodywork", itemId: "door_pillar_fl" },
  { kind: "item", stage: "left", label: "Paral panorámico izquierdo", sectionId: "bodywork", itemId: "windshield_pillar_l" },
  { kind: "item", stage: "left", label: "Larguero capota izquierdo", sectionId: "bodywork", itemId: "roof_rail_l" },
  { kind: "item", stage: "left", label: "Techo lado izquierdo", sectionId: "bodywork", itemId: "roof" },
  { kind: "item", stage: "left", label: "Paral central izquierdo", sectionId: "bodywork", itemId: "pillar_b_l" },
  { kind: "compound", stage: "left", label: "Estado interior sección delantera", compoundKey: "interior_delantera" },
  { kind: "item", stage: "left", label: "Estribo izquierdo", sectionId: "bodywork", itemId: "rocker_l" },
  { kind: "item", stage: "left", label: "Puerta trasera izquierda", sectionId: "bodywork", itemId: "door_rl" },
  { kind: "item", stage: "left", label: "Costado izquierdo", sectionId: "bodywork", itemId: "quarter_l" },
  { kind: "item", stage: "left", label: "Guardapolvo metálico trasero izquierdo", sectionId: "bodywork", itemId: "inner_fender_rl" },
  { kind: "item", stage: "left", label: "Amortiguador trasero izquierdo", sectionId: "suspension", itemId: "shock_rl" },
  { kind: "tire", stage: "left", label: "Llanta trasera izquierda", position: "rl" },

  // ───── Etapa 3: Parte trasera ─────
  { kind: "item", stage: "rear", label: "Tapabaúl con puerta", sectionId: "bodywork", itemId: "trunk" },
  { kind: "item", stage: "rear", label: "Panorámico trasero", sectionId: "bodywork", itemId: "rear_window" },
  { kind: "item", stage: "rear", label: "Bomper trasero", sectionId: "bodywork", itemId: "bumper_rear" },
  { kind: "item", stage: "rear", label: "Panel trasero", sectionId: "bodywork", itemId: "rear_panel" },
  { kind: "item", stage: "rear", label: "Piso baúl", sectionId: "bodywork", itemId: "trunk_floor" },
  { kind: "tire", stage: "rear", label: "Llanta de repuesto", position: "spare" },
  { kind: "item", stage: "rear", label: "Stop izquierdo", sectionId: "bodywork", itemId: "taillight_l" },
  { kind: "item", stage: "rear", label: "Stop derecho", sectionId: "bodywork", itemId: "taillight_r" },
  { kind: "item", stage: "rear", label: "Punta trasera izquierda", sectionId: "bodywork", itemId: "rear_corner_l" },
  { kind: "item", stage: "rear", label: "Punta trasera derecha", sectionId: "bodywork", itemId: "rear_corner_r" },

  // ───── Etapa 4: Costado derecho ─────
  { kind: "item", stage: "right", label: "Costado derecho", sectionId: "bodywork", itemId: "quarter_r" },
  { kind: "item", stage: "right", label: "Amortiguador trasero derecho", sectionId: "suspension", itemId: "shock_rr" },
  { kind: "tire", stage: "right", label: "Llanta trasera derecha", position: "rr" },
  { kind: "item", stage: "right", label: "Larguero capota derecho", sectionId: "bodywork", itemId: "roof_rail_r" },
  { kind: "item", stage: "right", label: "Capó (verificación lado derecho)", sectionId: "bodywork", itemId: "hood_2nd" },
  { kind: "item", stage: "right", label: "Paral central derecho", sectionId: "bodywork", itemId: "pillar_b_r" },
  { kind: "item", stage: "right", label: "Puerta trasera derecha", sectionId: "bodywork", itemId: "door_rr" },
  { kind: "item", stage: "right", label: "Paral panorámico derecho", sectionId: "bodywork", itemId: "windshield_pillar_r" },
  { kind: "item", stage: "right", label: "Paral puerta derecha", sectionId: "bodywork", itemId: "door_pillar_fr" },
  { kind: "item", stage: "right", label: "Estribo derecho", sectionId: "bodywork", itemId: "rocker_r" },
  { kind: "item", stage: "right", label: "Puerta delantera derecha", sectionId: "bodywork", itemId: "door_fr" },
  { kind: "item", stage: "right", label: "Retrovisor derecho", sectionId: "bodywork", itemId: "mirror_r" },
  { kind: "item", stage: "right", label: "Panorámico delantero (vista derecha)", sectionId: "bodywork", itemId: "windshield_r" },
  { kind: "item", stage: "right", label: "Guardafangos derecho", sectionId: "bodywork", itemId: "fender_fr" },
  { kind: "item", stage: "right", label: "Torre suspensión delantera derecha", sectionId: "suspension", itemId: "strut_tower_r" },
  { kind: "item", stage: "right", label: "Guardapolvo metálico delantero derecho", sectionId: "bodywork", itemId: "inner_fender_fr" },
  { kind: "item", stage: "right", label: "Amortiguador delantero derecho", sectionId: "suspension", itemId: "shock_fr" },
  { kind: "tire", stage: "right", label: "Llanta delantera derecha", position: "fr" },
  { kind: "item", stage: "right", label: "Punta delantera derecha", sectionId: "bodywork", itemId: "front_corner_r" },

  // ───── Etapa 5: Motor y accesorios ─────
  { kind: "item", stage: "engine", label: "Estado motor (fugas, ruidos, aceite, filtros, líquidos)", sectionId: "engine", itemId: "general_check" },
  { kind: "compound", stage: "engine", label: "Accesorios", compoundKey: "accessories" },
  { kind: "item", stage: "engine", label: "Barra estabilizadora", sectionId: "suspension", itemId: "stabilizer" },
  { kind: "item", stage: "engine", label: "Cuna del motor", sectionId: "engine", itemId: "cradle" },
  { kind: "item", stage: "engine", label: "Soporte de motor", sectionId: "engine", itemId: "engine_mounts" },
  { kind: "item", stage: "engine", label: "Cárter", sectionId: "engine", itemId: "oil_pan" },
  { kind: "item", stage: "engine", label: "Farola delantera izquierda", sectionId: "bodywork", itemId: "headlight_l" },
  { kind: "item", stage: "engine", label: "Farola delantera derecha", sectionId: "bodywork", itemId: "headlight_r" },
  { kind: "item", stage: "engine", label: "Bloque", sectionId: "engine", itemId: "block" },
  { kind: "item", stage: "engine", label: "Culata", sectionId: "engine", itemId: "head" },
  { kind: "item", stage: "engine", label: "Tapaválvula", sectionId: "engine", itemId: "valve_cover" },

  // Nota: "Fugas de fluidos" se sacó del recorrido — ahora es un step propio
  // (LeaksStep) que se inserta después de "engine" en activeStepsFor.

  // ───── Etapa 7: Estructura e iluminación ─────
  { kind: "item", stage: "underside", label: "Piso de carrocería", sectionId: "chassis", itemId: "floor" },
  { kind: "item", stage: "underside", label: "Refuerzos de carrocería", sectionId: "chassis", itemId: "reinforcements" },
  { kind: "item", stage: "underside", label: "Estado iluminación vehículo", sectionId: "electrical", itemId: "lighting_overall" },
];

/** Secuencia canónica de 63 items para camionetas, camperos y pickups de
 *  chasis independiente (suv_2doors, suv_5doors, pickup_single,
 *  pickup_double). Difiere de car_5doors en que recorre los largueros de
 *  chasis, el paral trasero de cabina y reemplaza la cuna del motor por el
 *  puente de suspensión. Las variantes 2p filtran las puertas traseras desde
 *  walkaroundSequenceFor. */
export const WALKAROUND_SEQUENCE_CHASSIS_INDEPENDENT: readonly WalkaroundEntry[] = [
  // ───── Etapa 1: Frente y delantero izquierdo ─────
  { kind: "item", stage: "front", label: "Capó", sectionId: "bodywork", itemId: "hood" },
  { kind: "item", stage: "front", label: "Bomper delantero", sectionId: "bodywork", itemId: "bumper_front" },
  { kind: "item", stage: "front", label: "Larguero chasis izquierdo", sectionId: "chassis", itemId: "chassis_rail_l" },
  { kind: "item", stage: "front", label: "Guardapolvo metálico delantero izquierdo", sectionId: "bodywork", itemId: "inner_fender_fl" },
  { kind: "item", stage: "front", label: "Torre delantera izquierda", sectionId: "suspension", itemId: "strut_tower_l" },
  { kind: "item", stage: "front", label: "Amortiguador delantero izquierdo", sectionId: "suspension", itemId: "shock_fl" },
  { kind: "item", stage: "front", label: "Guardafango delantero izquierdo", sectionId: "bodywork", itemId: "fender_fl" },
  { kind: "tire", stage: "front", label: "Llanta delantera izquierda", position: "fl" },

  // ───── Etapa 2: Costado izquierdo ─────
  { kind: "item", stage: "left", label: "Retrovisor izquierdo", sectionId: "bodywork", itemId: "mirror_l" },
  { kind: "item", stage: "left", label: "Panorámico delantero (vista izquierda)", sectionId: "bodywork", itemId: "windshield_l" },
  { kind: "item", stage: "left", label: "Puerta delantera izquierda", sectionId: "bodywork", itemId: "door_fl" },
  { kind: "item", stage: "left", label: "Paral puerta izquierda", sectionId: "bodywork", itemId: "door_pillar_fl" },
  { kind: "item", stage: "left", label: "Paral parabrisas izquierdo", sectionId: "bodywork", itemId: "windshield_pillar_l" },
  { kind: "item", stage: "left", label: "Larguero capota izquierdo", sectionId: "bodywork", itemId: "roof_rail_l" },
  { kind: "item", stage: "left", label: "Techo lado izquierdo", sectionId: "bodywork", itemId: "roof" },
  { kind: "item", stage: "left", label: "Paral central izquierdo", sectionId: "bodywork", itemId: "pillar_b_l" },
  { kind: "item", stage: "left", label: "Paral trasero cabina izquierdo", sectionId: "bodywork", itemId: "cabin_pillar_rear_l" },
  { kind: "compound", stage: "left", label: "Estado interior sección delantera", compoundKey: "interior_delantera" },
  { kind: "item", stage: "left", label: "Estribo izquierdo", sectionId: "bodywork", itemId: "rocker_l" },
  { kind: "item", stage: "left", label: "Puerta trasera izquierda", sectionId: "bodywork", itemId: "door_rl" },
  { kind: "item", stage: "left", label: "Costado izquierdo", sectionId: "bodywork", itemId: "quarter_l" },
  { kind: "item", stage: "left", label: "Guardapolvo metálico trasero izquierdo", sectionId: "bodywork", itemId: "inner_fender_rl" },
  { kind: "item", stage: "left", label: "Amortiguador trasero izquierdo", sectionId: "suspension", itemId: "shock_rl" },
  { kind: "tire", stage: "left", label: "Llanta trasera izquierda", position: "rl" },

  // ───── Etapa 3: Parte trasera ─────
  { kind: "item", stage: "rear", label: "Tapa platón / portón trasero", sectionId: "bodywork", itemId: "tailgate" },
  { kind: "item", stage: "rear", label: "Panorámico trasero", sectionId: "bodywork", itemId: "rear_window" },
  { kind: "item", stage: "rear", label: "Bomper trasero", sectionId: "bodywork", itemId: "bumper_rear" },
  { kind: "item", stage: "rear", label: "Panel trasero / panel platón", sectionId: "bodywork", itemId: "rear_panel" },
  { kind: "item", stage: "rear", label: "Piso platón / piso de carga", sectionId: "bodywork", itemId: "bed_floor" },
  { kind: "tire", stage: "rear", label: "Llanta de repuesto", position: "spare" },
  { kind: "item", stage: "rear", label: "Stop izquierdo", sectionId: "bodywork", itemId: "taillight_l" },
  { kind: "item", stage: "rear", label: "Stop derecho", sectionId: "bodywork", itemId: "taillight_r" },

  // ───── Etapa 4: Costado derecho ─────
  { kind: "tire", stage: "right", label: "Llanta trasera derecha", position: "rr" },
  { kind: "item", stage: "right", label: "Guardapolvo metálico trasero derecho", sectionId: "bodywork", itemId: "inner_fender_rr" },
  { kind: "item", stage: "right", label: "Costado derecho", sectionId: "bodywork", itemId: "quarter_r" },
  { kind: "item", stage: "right", label: "Paral trasero cabina derecho", sectionId: "bodywork", itemId: "cabin_pillar_rear_r" },
  { kind: "item", stage: "right", label: "Larguero capota derecho", sectionId: "bodywork", itemId: "roof_rail_r" },
  { kind: "item", stage: "right", label: "Capó (verificación lado derecho)", sectionId: "bodywork", itemId: "hood_2nd" },
  { kind: "item", stage: "right", label: "Paral central derecho", sectionId: "bodywork", itemId: "pillar_b_r" },
  { kind: "item", stage: "right", label: "Puerta trasera derecha", sectionId: "bodywork", itemId: "door_rr" },
  { kind: "item", stage: "right", label: "Puerta delantera derecha", sectionId: "bodywork", itemId: "door_fr" },
  { kind: "item", stage: "right", label: "Paral parabrisas derecho", sectionId: "bodywork", itemId: "windshield_pillar_r" },
  { kind: "item", stage: "right", label: "Paral puerta derecho", sectionId: "bodywork", itemId: "door_pillar_fr" },
  { kind: "item", stage: "right", label: "Estribo derecho", sectionId: "bodywork", itemId: "rocker_r" },
  { kind: "item", stage: "right", label: "Retrovisor derecho", sectionId: "bodywork", itemId: "mirror_r" },
  { kind: "item", stage: "right", label: "Panorámico delantero (vista derecha)", sectionId: "bodywork", itemId: "windshield_r" },
  { kind: "item", stage: "right", label: "Guardafango delantero derecho", sectionId: "bodywork", itemId: "fender_fr" },
  { kind: "item", stage: "right", label: "Torre suspensión delantera derecha", sectionId: "suspension", itemId: "strut_tower_r" },
  { kind: "item", stage: "right", label: "Guardapolvo metálico delantero derecho", sectionId: "bodywork", itemId: "inner_fender_fr" },
  { kind: "item", stage: "right", label: "Amortiguador delantero derecho", sectionId: "suspension", itemId: "shock_fr" },
  { kind: "tire", stage: "right", label: "Llanta delantera derecha", position: "fr" },
  { kind: "item", stage: "right", label: "Larguero chasis derecho", sectionId: "chassis", itemId: "chassis_rail_r" },

  // ───── Etapa 5: Motor y accesorios ─────
  { kind: "item", stage: "engine", label: "Estado motor (fugas, ruidos, aceite, filtros, líquidos)", sectionId: "engine", itemId: "general_check" },
  { kind: "compound", stage: "engine", label: "Accesorios", compoundKey: "accessories" },
  { kind: "item", stage: "engine", label: "Barra estabilizadora", sectionId: "suspension", itemId: "stabilizer" },
  { kind: "item", stage: "engine", label: "Puente de suspensión", sectionId: "engine", itemId: "suspension_bridge" },
  { kind: "item", stage: "engine", label: "Soporte de motor", sectionId: "engine", itemId: "engine_mounts" },
  { kind: "item", stage: "engine", label: "Cárter", sectionId: "engine", itemId: "oil_pan" },
  { kind: "item", stage: "engine", label: "Farola delantera izquierda", sectionId: "bodywork", itemId: "headlight_l" },
  { kind: "item", stage: "engine", label: "Farola delantera derecha", sectionId: "bodywork", itemId: "headlight_r" },
  { kind: "item", stage: "engine", label: "Bloque motor", sectionId: "engine", itemId: "block" },
  { kind: "item", stage: "engine", label: "Culata", sectionId: "engine", itemId: "head" },
  { kind: "item", stage: "engine", label: "Tapa válvulas", sectionId: "engine", itemId: "valve_cover" },

  // Nota: "Fugas de fluidos" se sacó del recorrido — ahora es un step propio
  // (LeaksStep) que se inserta después de "engine" en activeStepsFor.

  // ───── Etapa 7: Estructura e iluminación ─────
  { kind: "item", stage: "underside", label: "Piso de carrocería", sectionId: "chassis", itemId: "floor" },
  { kind: "item", stage: "underside", label: "Iluminación del vehículo", sectionId: "electrical", itemId: "lighting_overall" },
];

/** Construye el recorrido para un tipo de vehículo. Para car_5doors usa la
 *  secuencia canónica de carrocería autoportante. Para SUVs y pickups (chasis
 *  independiente) usa una secuencia distinta que incluye largueros de chasis,
 *  paral trasero de cabina y puente de suspensión. Para tipos muy distintos
 *  (bus, pesado, moto, tráiler), genera un recorrido derivado linealizando
 *  bodywork + suspension + tires + engine + chassis + electrical en orden. */
export function walkaroundSequenceFor(
  vehicleType: VehicleType,
  activeSections: readonly SectionId[],
): WalkaroundEntry[] {
  const activeSet = new Set(activeSections);
  const filter = (e: WalkaroundEntry): boolean => {
    if (e.kind === "tire") return activeSet.has("tires");
    if (e.kind === "compound") {
      return e.compoundKey === "accessories"
        ? activeSet.has("accessories")
        : activeSet.has("comfort");
    }
    return activeSet.has(e.sectionId);
  };

  if (vehicleType === "car_5doors" || vehicleType === "car_coupe") {
    const noRearDoors = vehicleType === "car_coupe";
    return WALKAROUND_SEQUENCE_CAR_5DOORS.filter((e) => {
      if (!filter(e)) return false;
      if (
        noRearDoors &&
        e.kind === "item" &&
        e.sectionId === "bodywork" &&
        (e.itemId === "door_rl" || e.itemId === "door_rr")
      ) {
        return false;
      }
      return true;
    });
  }

  // SUVs y pickups comparten una secuencia única de chasis independiente. Para
  // las variantes de 2 puertas (suv_2doors, pickup_single) filtramos las
  // puertas traseras del recorrido — el perito no las ve aunque la secuencia
  // base las incluya.
  const chassisIndependent: readonly VehicleType[] = [
    "suv_5doors",
    "suv_2doors",
    "pickup_single",
    "pickup_double",
  ];
  if (chassisIndependent.includes(vehicleType)) {
    const noRearDoors =
      vehicleType === "suv_2doors" || vehicleType === "pickup_single";
    return WALKAROUND_SEQUENCE_CHASSIS_INDEPENDENT.filter((e) => {
      if (!filter(e)) return false;
      if (
        noRearDoors &&
        e.kind === "item" &&
        e.sectionId === "bodywork" &&
        (e.itemId === "door_rl" || e.itemId === "door_rr")
      ) {
        return false;
      }
      return true;
    });
  }

  // Derivador genérico para bus/pesados/moto/tráiler: bodywork → suspension
  // → tires → engine → chassis → electrical → comfort → accessories. Cada
  // uno se incluye solo si la sección está activa. Todos van bajo etapa
  // "general" (un solo bloque, sin sub-stepper físico).
  const seq: WalkaroundEntry[] = [];
  const body = bodyworkSectionFor(vehicleType);
  if (activeSet.has("bodywork")) {
    for (const g of body.groups) {
      for (const item of g.items) {
        seq.push({
          kind: "item",
          stage: "general",
          label: item.label,
          sectionId: "bodywork",
          itemId: item.id,
        });
      }
    }
  }
  if (activeSet.has("suspension")) {
    for (const g of SUSPENSION_SECTION.groups) {
      for (const item of g.items) {
        seq.push({
          kind: "item",
          stage: "general",
          label: item.label,
          sectionId: "suspension",
          itemId: item.id,
        });
      }
    }
  }
  if (activeSet.has("tires")) {
    seq.push(
      { kind: "tire", stage: "general", label: "Llanta delantera izquierda", position: "fl" },
      { kind: "tire", stage: "general", label: "Llanta delantera derecha", position: "fr" },
      { kind: "tire", stage: "general", label: "Llanta trasera izquierda", position: "rl" },
      { kind: "tire", stage: "general", label: "Llanta trasera derecha", position: "rr" },
      { kind: "tire", stage: "general", label: "Llanta de repuesto", position: "spare" },
    );
  }
  if (activeSet.has("engine")) {
    for (const g of ENGINE_SECTION.groups) {
      if (g.id === "compression") continue;
      for (const item of g.items) {
        seq.push({
          kind: "item",
          stage: "general",
          label: item.label,
          sectionId: "engine",
          itemId: item.id,
        });
      }
    }
  }
  if (activeSet.has("chassis")) {
    for (const g of CHASSIS_SECTION.groups) {
      for (const item of g.items) {
        seq.push({
          kind: "item",
          stage: "general",
          label: item.label,
          sectionId: "chassis",
          itemId: item.id,
        });
      }
    }
  }
  if (activeSet.has("electrical")) {
    for (const g of ELECTRICAL_SECTION.groups) {
      for (const item of g.items) {
        seq.push({
          kind: "item",
          stage: "general",
          label: item.label,
          sectionId: "electrical",
          itemId: item.id,
        });
      }
    }
  }
  if (activeSet.has("comfort")) {
    seq.push({
      kind: "compound",
      stage: "general",
      label: "Estado interior sección delantera",
      compoundKey: "interior_delantera",
    });
  }
  if (activeSet.has("accessories")) {
    seq.push({
      kind: "compound",
      stage: "general",
      label: "Accesorios",
      compoundKey: "accessories",
    });
  }
  return seq;
}

export const BODYWORK_SECTION: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Frente",
      items: [
        { id: "hood", label: "Capó", kind: "bodywork" },
        { id: "bumper_front", label: "Bomper delantero", kind: "bodywork" },
        { id: "hood_2nd", label: "Capó (verificación lado derecho)", kind: "bodywork" },
        { id: "front_corner_l", label: "Punta delantera izquierda", kind: "bodywork" },
        { id: "front_corner_r", label: "Punta delantera derecha", kind: "bodywork" },
        { id: "inner_fender_fl", label: "Guardapolvo metálico delantero izquierdo", kind: "bodywork" },
        { id: "inner_fender_fr", label: "Guardapolvo metálico delantero derecho", kind: "bodywork" },
        { id: "fender_fl", label: "Guardafangos delantero izquierdo", kind: "bodywork" },
        { id: "fender_fr", label: "Guardafangos delantero derecho", kind: "bodywork" },
        { id: "headlight_l", label: "Farola delantera izquierda", kind: "light_unit" },
        { id: "headlight_r", label: "Farola delantera derecha", kind: "light_unit" },
      ],
    },
    {
      id: "sides",
      label: "Costados",
      items: [
        { id: "mirror_l", label: "Retrovisor izquierdo", kind: "bodywork" },
        { id: "mirror_r", label: "Retrovisor derecho", kind: "bodywork" },
        { id: "windshield_l", label: "Panorámico delantero (vista izquierda)", kind: "panoramic" },
        { id: "windshield_r", label: "Panorámico delantero (vista derecha)", kind: "panoramic" },
        { id: "door_fl", label: "Puerta delantera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_fr", label: "Puerta delantera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "door_rl", label: "Puerta trasera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_rr", label: "Puerta trasera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "door_pillar_fl", label: "Paral puerta delantera izquierda", kind: "bodywork" },
        { id: "door_pillar_fr", label: "Paral puerta delantera derecha", kind: "bodywork" },
        { id: "windshield_pillar_l", label: "Paral panorámico izquierdo", kind: "bodywork" },
        { id: "windshield_pillar_r", label: "Paral panorámico derecho", kind: "bodywork" },
        { id: "roof_rail_l", label: "Larguero capota izquierdo", kind: "bodywork" },
        { id: "roof_rail_r", label: "Larguero capota derecho", kind: "bodywork" },
        { id: "pillar_b_l", label: "Paral central izquierdo", kind: "bodywork" },
        { id: "pillar_b_r", label: "Paral central derecho", kind: "bodywork" },
        { id: "rocker_l", label: "Estribo izquierdo", kind: "bodywork" },
        { id: "rocker_r", label: "Estribo derecho", kind: "bodywork" },
        { id: "quarter_l", label: "Costado izquierdo", kind: "bodywork" },
        { id: "quarter_r", label: "Costado derecho", kind: "bodywork" },
        { id: "inner_fender_rl", label: "Guardapolvo metálico trasero izquierdo", kind: "bodywork" },
      ],
    },
    {
      id: "roof",
      label: "Techo",
      items: [{ id: "roof", label: "Techo", kind: "bodywork" }],
    },
    {
      id: "rear",
      label: "Parte trasera",
      items: [
        { id: "trunk", label: "Tapabaúl / portón", kind: "bodywork" },
        { id: "rear_window", label: "Panorámico trasero", kind: "panoramic" },
        { id: "bumper_rear", label: "Bomper trasero", kind: "bodywork" },
        { id: "rear_panel", label: "Panel trasero", kind: "bodywork" },
        { id: "trunk_floor", label: "Piso del baúl", kind: "bodywork" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" },
        { id: "taillight_r", label: "Stop derecho", kind: "light_unit" },
        { id: "rear_corner_l", label: "Punta trasera izquierda", kind: "bodywork" },
        { id: "rear_corner_r", label: "Punta trasera derecha", kind: "bodywork" },
      ],
    },
  ],
};

export const CHASSIS_SECTION: InspectionSectionDef = {
  id: "chassis",
  label: "Chasis y estructura",
  groups: [
    {
      id: "structure",
      label: "Estructura",
      items: [
        { id: "floor", label: "Piso de carrocería", kind: "structural" },
        { id: "reinforcements", label: "Refuerzos de carrocería", kind: "structural" },
        { id: "chassis_rail_l", label: "Larguero chasis izquierdo", kind: "structural" },
        { id: "chassis_rail_r", label: "Larguero chasis derecho", kind: "structural" },
      ],
    },
  ],
};

export const SUSPENSION_SECTION: InspectionSectionDef = {
  id: "suspension",
  label: "Suspensión",
  groups: [
    {
      id: "shocks",
      label: "Amortiguadores",
      items: [
        { id: "shock_fl", label: "Amortiguador delantero izquierdo", kind: "mechanical" },
        { id: "shock_fr", label: "Amortiguador delantero derecho", kind: "mechanical" },
        { id: "shock_rl", label: "Amortiguador trasero izquierdo", kind: "mechanical" },
        { id: "shock_rr", label: "Amortiguador trasero derecho", kind: "mechanical" },
      ],
    },
    {
      id: "structure",
      label: "Estructura de suspensión",
      items: [
        { id: "strut_tower_l", label: "Torre delantera izquierda", kind: "mechanical" },
        { id: "strut_tower_r", label: "Torre delantera derecha", kind: "mechanical" },
        { id: "stabilizer", label: "Barra estabilizadora", kind: "mechanical" },
      ],
    },
  ],
};

export const ENGINE_SECTION: InspectionSectionDef = {
  id: "engine",
  label: "Motor",
  groups: [
    {
      id: "general",
      label: "Estado general",
      items: [
        {
          id: "general_check",
          label: "Estado motor (fugas, ruidos, aceite, filtros, líquidos)",
          kind: "mechanical",
        },
      ],
    },
    {
      id: "components",
      label: "Componentes",
      items: [
        { id: "cradle", label: "Cuna del motor", kind: "mechanical" },
        { id: "suspension_bridge", label: "Puente de suspensión", kind: "mechanical" },
        { id: "engine_mounts", label: "Soporte de motor", kind: "mechanical" },
        { id: "oil_pan", label: "Cárter", kind: "mechanical" },
        { id: "block", label: "Bloque", kind: "mechanical" },
        { id: "head", label: "Culata", kind: "mechanical" },
        { id: "valve_cover", label: "Tapaválvula", kind: "mechanical" },
      ],
    },
    {
      id: "compression",
      label: "Compresión",
      // Items dinámicos — el perito agrega cilindros desde el wizard y se
      // guardan en data.engineCompression (no en data.engine).
      items: [],
    },
  ],
};

export const ELECTRICAL_SECTION: InspectionSectionDef = {
  id: "electrical",
  label: "Sistema eléctrico",
  groups: [
    {
      id: "lights",
      label: "Iluminación",
      items: [
        {
          id: "lighting_overall",
          label: "Estado iluminación vehículo",
          kind: "mechanical",
        },
      ],
    },
  ],
};

export const LEAKS_SECTION: InspectionSectionDef = {
  id: "leaks",
  label: "Fugas de fluidos",
  groups: [
    {
      id: "fluid_levels",
      label: "Niveles de fluidos",
      items: [
        { id: "level_engine_oil", label: "Aceite motor", kind: "fluid_level" },
        { id: "level_transmission_oil", label: "Aceite caja", kind: "fluid_level" },
        { id: "level_power_steering", label: "Hidráulico caja dirección", kind: "fluid_level" },
        { id: "level_coolant", label: "Refrigerante", kind: "fluid_level" },
        { id: "level_brake_fluid", label: "Líquido de frenos", kind: "fluid_level" },
        { id: "level_washer_fluid", label: "Lava parabrisas", kind: "fluid_level" },
      ],
    },
    {
      id: "leaks",
      label: "Fugas de fluidos",
      items: [
        { id: "engine_oil", label: "Fuga de aceite motor", kind: "leak" },
        { id: "transmission_oil", label: "Fuga de aceite caja", kind: "leak" },
        { id: "power_steering_fluid", label: "Fuga de hidráulico dirección", kind: "leak" },
        { id: "coolant", label: "Fuga de refrigerante", kind: "leak" },
        { id: "brake_fluid", label: "Fuga líquido de frenos", kind: "leak" },
        { id: "ac_compressor", label: "Fuga en compresor de aire acondicionado", kind: "leak" },
        { id: "differential_front", label: "Fuga diferencial delantero", kind: "leak" },
        { id: "differential_rear", label: "Fuga diferencial trasero", kind: "leak" },
      ],
    },
  ],
};

export const COMFORT_SECTION: InspectionSectionDef = {
  id: "comfort",
  label: "Interior delantero",
  groups: [
    {
      id: "interior_delantera",
      label: "Estado interior sección delantera",
      // Sub-items del item compuesto "Estado Interior Sección Delantera"
      // del recorrido (drill-down inline desde el step Recorrido).
      items: [
        { id: "volante", label: "Volante", kind: "mechanical" },
        { id: "millare", label: "Millare", kind: "mechanical" },
        { id: "panel_instrumentos", label: "Panel de instrumentos", kind: "mechanical" },
        { id: "pedales", label: "Estado de pedales", kind: "mechanical" },
        { id: "tapiceria", label: "Tapicería", kind: "mechanical" },
        { id: "piso_interior", label: "Piso interior", kind: "mechanical" },
        { id: "techo_interior", label: "Techo interior", kind: "mechanical" },
      ],
    },
  ],
};

export const ROAD_TEST_SECTION: InspectionSectionDef = {
  id: "roadTest",
  label: "Prueba de ruta",
  groups: [
    {
      id: "drive",
      label: "Conducción",
      items: [
        { id: "start", label: "Arranque en frío", kind: "road_test" },
        { id: "acceleration", label: "Aceleración y respuesta", kind: "road_test" },
        { id: "shifting", label: "Cambios de marcha", kind: "road_test" },
        { id: "braking", label: "Sistema de frenos", kind: "road_test" },
        { id: "handling", label: "Estabilidad y manejo", kind: "road_test" },
        { id: "steering_feel", label: "Comportamiento de dirección", kind: "road_test" },
        { id: "suspension_feel", label: "Respuesta de suspensión", kind: "road_test" },
        { id: "noise_on_road", label: "Ruidos en ruta", kind: "road_test" },
        { id: "abs_traction", label: "ABS / control de tracción", kind: "road_test" },
      ],
    },
  ],
};

export const ALL_SECTIONS: InspectionSectionDef[] = [
  BODYWORK_SECTION,
  CHASSIS_SECTION,
  SUSPENSION_SECTION,
  ENGINE_SECTION,
  ELECTRICAL_SECTION,
  LEAKS_SECTION,
  COMFORT_SECTION,
  ROAD_TEST_SECTION,
];

/* -------------------------------------------------------------------------
 *  Variantes de carrocería por tipo de vehículo
 *  -----------------------------------------------------------------------
 *  Cada tipo tiene un inventario de items distinto. El wizard y el PDF
 *  resuelven la sección con `bodyworkSectionFor(vehicleType)` y los datos se
 *  guardan en el mismo `bodywork: Record<string, InspectionEntry>`. Las
 *  llaves no se solapan entre variantes — si se cambia el tipo a mitad de
 *  edición las entradas viejas quedan ignoradas (no se renderizan, no se
 *  imprimen).
 * ----------------------------------------------------------------------- */

const BODYWORK_5DOORS = BODYWORK_SECTION; // Carrocería 5 Puertas — base original.

/* Items estructurales compartidos por todos los vehículos de chasis
 * independiente (SUVs 2p/5p, pickups sencilla y doble). Se inyectan como un
 * grupo extra en cada bodywork section para que el wizard del recorrido los
 * capture y el PDF los renderice. Los ítems específicos al tipo (bed_floor,
 * quarter_l/r, door_rl/rr) se agregan aparte por variante. */
const CHASSIS_INDEPENDENT_STRUCTURAL_ITEMS = [
  { id: "windshield_l", label: "Panorámico delantero (vista izquierda)", kind: "panoramic" as const },
  { id: "windshield_r", label: "Panorámico delantero (vista derecha)", kind: "panoramic" as const },
  { id: "hood_2nd", label: "Capó (verificación lado derecho)", kind: "bodywork" as const },
  { id: "door_pillar_fl", label: "Paral puerta delantera izquierda", kind: "bodywork" as const },
  { id: "door_pillar_fr", label: "Paral puerta delantera derecha", kind: "bodywork" as const },
  { id: "windshield_pillar_l", label: "Paral panorámico izquierdo", kind: "bodywork" as const },
  { id: "windshield_pillar_r", label: "Paral panorámico derecho", kind: "bodywork" as const },
  { id: "roof_rail_l", label: "Larguero capota izquierdo", kind: "bodywork" as const },
  { id: "roof_rail_r", label: "Larguero capota derecho", kind: "bodywork" as const },
  { id: "pillar_b_l", label: "Paral central izquierdo", kind: "bodywork" as const },
  { id: "pillar_b_r", label: "Paral central derecho", kind: "bodywork" as const },
  { id: "cabin_pillar_rear_l", label: "Paral trasero cabina izquierdo", kind: "bodywork" as const },
  { id: "cabin_pillar_rear_r", label: "Paral trasero cabina derecho", kind: "bodywork" as const },
  { id: "inner_fender_fl", label: "Guardapolvo metálico delantero izquierdo", kind: "bodywork" as const },
  { id: "inner_fender_fr", label: "Guardapolvo metálico delantero derecho", kind: "bodywork" as const },
  { id: "inner_fender_rl", label: "Guardapolvo metálico trasero izquierdo", kind: "bodywork" as const },
  { id: "inner_fender_rr", label: "Guardapolvo metálico trasero derecho", kind: "bodywork" as const },
  { id: "rear_panel", label: "Panel trasero", kind: "bodywork" as const },
];

export const BODYWORK_SUV_5DOORS: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Parte delantera",
      items: [
        { id: "bumper_front", label: "Bomper delantero", kind: "bodywork" },
        { id: "hood", label: "Capó", kind: "bodywork" },
        { id: "fender_fl", label: "Guardafango delantero izquierdo", kind: "bodywork" },
        { id: "fender_fr", label: "Guardafango delantero derecho", kind: "bodywork" },
        { id: "grille", label: "Parrilla", kind: "bodywork" },
        { id: "headlight_l", label: "Faro izquierdo", kind: "light_unit" },
        { id: "headlight_r", label: "Faro derecho", kind: "light_unit" },
      ],
    },
    {
      id: "sides",
      label: "Laterales",
      items: [
        { id: "door_fl", label: "Puerta delantera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_fr", label: "Puerta delantera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "door_rl", label: "Puerta trasera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_rr", label: "Puerta trasera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "rocker_l", label: "Estribo izquierdo", kind: "bodywork" },
        { id: "rocker_r", label: "Estribo derecho", kind: "bodywork" },
        { id: "mirror_l", label: "Espejo izquierdo", kind: "bodywork" },
        { id: "mirror_r", label: "Espejo derecho", kind: "bodywork" },
        { id: "quarter_l", label: "Costado izquierdo", kind: "bodywork" },
        { id: "quarter_r", label: "Costado derecho", kind: "bodywork" },
      ],
    },
    {
      id: "rear",
      label: "Parte trasera",
      items: [
        { id: "bumper_rear", label: "Bomper trasero", kind: "bodywork" },
        { id: "tailgate", label: "Tapa platón / portón trasero", kind: "bodywork" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" },
        { id: "taillight_r", label: "Stop derecho", kind: "light_unit" },
        { id: "spare_holder", label: "Soporte de repuesto trasero", kind: "bodywork" },
        { id: "bed_floor", label: "Piso del baúl / piso de carga", kind: "bodywork" },
      ],
    },
    {
      id: "roof_glass",
      label: "Techo y vidrios",
      items: [
        { id: "roof", label: "Techo", kind: "bodywork" },
        { id: "windshield", label: "Parabrisas", kind: "panoramic" },
        { id: "rear_window", label: "Panorámico trasero", kind: "panoramic" },
        { id: "sunroof", label: "Techo corredizo", kind: "bodywork" },
      ],
    },
    {
      id: "pillars_structure",
      label: "Pilares y estructura",
      items: CHASSIS_INDEPENDENT_STRUCTURAL_ITEMS,
    },
  ],
};

export const BODYWORK_SUV_2DOORS: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Parte delantera",
      items: [
        { id: "bumper_front", label: "Bomper delantero", kind: "bodywork" },
        { id: "hood", label: "Capó", kind: "bodywork" },
        { id: "fender_fl", label: "Guardafango delantero izquierdo", kind: "bodywork" },
        { id: "fender_fr", label: "Guardafango delantero derecho", kind: "bodywork" },
        { id: "grille", label: "Parrilla", kind: "bodywork" },
        { id: "headlight_l", label: "Faro izquierdo", kind: "light_unit" },
        { id: "headlight_r", label: "Faro derecho", kind: "light_unit" },
      ],
    },
    {
      id: "sides",
      label: "Laterales",
      items: [
        { id: "door_fl", label: "Puerta delantera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_fr", label: "Puerta delantera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "rocker_l", label: "Estribo izquierdo", kind: "bodywork" },
        { id: "rocker_r", label: "Estribo derecho", kind: "bodywork" },
        { id: "mirror_l", label: "Espejo izquierdo", kind: "bodywork" },
        { id: "mirror_r", label: "Espejo derecho", kind: "bodywork" },
        { id: "quarter_l", label: "Costado izquierdo", kind: "bodywork" },
        { id: "quarter_r", label: "Costado derecho", kind: "bodywork" },
      ],
    },
    {
      id: "rear",
      label: "Parte trasera",
      items: [
        { id: "bumper_rear", label: "Bomper trasero", kind: "bodywork" },
        { id: "tailgate", label: "Tapa platón / portón trasero", kind: "bodywork" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" },
        { id: "taillight_r", label: "Stop derecho", kind: "light_unit" },
        { id: "spare_holder", label: "Soporte de repuesto trasero", kind: "bodywork" },
        { id: "bed_floor", label: "Piso del baúl / piso de carga", kind: "bodywork" },
      ],
    },
    {
      id: "roof_glass",
      label: "Techo y vidrios",
      items: [
        { id: "roof", label: "Techo", kind: "bodywork" },
        { id: "windshield", label: "Parabrisas", kind: "panoramic" },
        { id: "rear_window", label: "Panorámico trasero", kind: "panoramic" },
        { id: "sunroof", label: "Techo corredizo", kind: "bodywork" },
      ],
    },
    {
      id: "pillars_structure",
      label: "Pilares y estructura",
      items: CHASSIS_INDEPENDENT_STRUCTURAL_ITEMS,
    },
  ],
};

export const BODYWORK_PICKUP_SINGLE: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Parte delantera",
      items: [
        { id: "bumper_front", label: "Bomper delantero", kind: "bodywork" },
        { id: "hood", label: "Capó", kind: "bodywork" },
        { id: "fender_fl", label: "Guardafango delantero izquierdo", kind: "bodywork" },
        { id: "fender_fr", label: "Guardafango delantero derecho", kind: "bodywork" },
        { id: "grille", label: "Parrilla", kind: "bodywork" },
        { id: "headlight_l", label: "Faro izquierdo", kind: "light_unit" },
        { id: "headlight_r", label: "Faro derecho", kind: "light_unit" },
      ],
    },
    {
      id: "cabin",
      label: "Cabina",
      items: [
        { id: "door_fl", label: "Puerta delantera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_fr", label: "Puerta delantera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "rocker_l", label: "Estribo izquierdo", kind: "bodywork" },
        { id: "rocker_r", label: "Estribo derecho", kind: "bodywork" },
        { id: "mirror_l", label: "Espejo izquierdo", kind: "bodywork" },
        { id: "mirror_r", label: "Espejo derecho", kind: "bodywork" },
        { id: "cabin_rear", label: "Pared trasera de cabina", kind: "bodywork" },
        { id: "quarter_l", label: "Costado izquierdo", kind: "bodywork" },
        { id: "quarter_r", label: "Costado derecho", kind: "bodywork" },
      ],
    },
    {
      id: "bed",
      label: "Platón",
      items: [
        { id: "bed_floor", label: "Piso del platón", kind: "bodywork" },
        { id: "bed_side_l", label: "Costado izquierdo del platón", kind: "bodywork" },
        { id: "bed_side_r", label: "Costado derecho del platón", kind: "bodywork" },
        { id: "tailgate", label: "Tapa platón / compuerta", kind: "bodywork" },
        { id: "rear_panel", label: "Panel trasero del platón", kind: "bodywork" },
        { id: "bumper_rear", label: "Bomper trasero", kind: "bodywork" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" },
        { id: "taillight_r", label: "Stop derecho", kind: "light_unit" },
      ],
    },
    {
      id: "roof_glass",
      label: "Techo y vidrios",
      items: [
        { id: "roof", label: "Techo de cabina", kind: "bodywork" },
        { id: "windshield", label: "Parabrisas", kind: "panoramic" },
        { id: "rear_window", label: "Panorámico trasero de cabina", kind: "panoramic" },
      ],
    },
    {
      id: "pillars_structure",
      label: "Pilares y estructura",
      items: CHASSIS_INDEPENDENT_STRUCTURAL_ITEMS.filter((i) => i.id !== "rear_panel"),
    },
  ],
};

export const BODYWORK_PICKUP_DOUBLE: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Parte delantera",
      items: [
        { id: "bumper_front", label: "Bomper delantero", kind: "bodywork" },
        { id: "hood", label: "Capó", kind: "bodywork" },
        { id: "fender_fl", label: "Guardafango delantero izquierdo", kind: "bodywork" },
        { id: "fender_fr", label: "Guardafango delantero derecho", kind: "bodywork" },
        { id: "grille", label: "Parrilla", kind: "bodywork" },
        { id: "headlight_l", label: "Faro izquierdo", kind: "light_unit" },
        { id: "headlight_r", label: "Faro derecho", kind: "light_unit" },
      ],
    },
    {
      id: "cabin",
      label: "Cabina",
      items: [
        { id: "door_fl", label: "Puerta delantera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_fr", label: "Puerta delantera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "door_rl", label: "Puerta trasera izquierda", kind: "bodywork", hasSealantCheck: true },
        { id: "door_rr", label: "Puerta trasera derecha", kind: "bodywork", hasSealantCheck: true },
        { id: "rocker_l", label: "Estribo izquierdo", kind: "bodywork" },
        { id: "rocker_r", label: "Estribo derecho", kind: "bodywork" },
        { id: "mirror_l", label: "Espejo izquierdo", kind: "bodywork" },
        { id: "mirror_r", label: "Espejo derecho", kind: "bodywork" },
        { id: "cabin_rear", label: "Pared trasera de cabina", kind: "bodywork" },
        { id: "quarter_l", label: "Costado izquierdo", kind: "bodywork" },
        { id: "quarter_r", label: "Costado derecho", kind: "bodywork" },
      ],
    },
    {
      id: "bed",
      label: "Platón",
      items: [
        { id: "bed_floor", label: "Piso del platón", kind: "bodywork" },
        { id: "bed_side_l", label: "Costado izquierdo del platón", kind: "bodywork" },
        { id: "bed_side_r", label: "Costado derecho del platón", kind: "bodywork" },
        { id: "tailgate", label: "Tapa platón / compuerta", kind: "bodywork" },
        { id: "rear_panel", label: "Panel trasero del platón", kind: "bodywork" },
        { id: "bumper_rear", label: "Bomper trasero", kind: "bodywork" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" },
        { id: "taillight_r", label: "Stop derecho", kind: "light_unit" },
      ],
    },
    {
      id: "roof_glass",
      label: "Techo y vidrios",
      items: [
        { id: "roof", label: "Techo de cabina", kind: "bodywork" },
        { id: "windshield", label: "Parabrisas", kind: "panoramic" },
        { id: "rear_window", label: "Panorámico trasero de cabina", kind: "panoramic" },
      ],
    },
    {
      id: "pillars_structure",
      label: "Pilares y estructura",
      items: CHASSIS_INDEPENDENT_STRUCTURAL_ITEMS.filter((i) => i.id !== "rear_panel"),
    },
  ],
};

export const BODYWORK_BUS: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Frente",
      items: [
        { id: "bumper_front", label: "Paragolpes delantero", kind: "bodywork" },
        { id: "front_panel", label: "Panel frontal", kind: "bodywork" },
        { id: "windshield", label: "Parabrisas", kind: "panoramic" },
        { id: "headlight_l", label: "Faro izquierdo", kind: "light_unit" },
        { id: "headlight_r", label: "Faro derecho", kind: "light_unit" },
        { id: "mirror_l", label: "Espejo izquierdo", kind: "bodywork" },
        { id: "mirror_r", label: "Espejo derecho", kind: "bodywork" },
      ],
    },
    {
      id: "sides",
      label: "Laterales",
      items: [
        { id: "side_panel_l", label: "Panel lateral izquierdo", kind: "bodywork" },
        { id: "side_panel_r", label: "Panel lateral derecho", kind: "bodywork" },
        { id: "windows_l", label: "Ventanas costado izquierdo", kind: "bodywork" },
        { id: "windows_r", label: "Ventanas costado derecho", kind: "bodywork" },
        { id: "entry_door", label: "Puerta de entrada", kind: "bodywork" },
        { id: "exit_door", label: "Puerta de salida / emergencia", kind: "bodywork" },
        { id: "luggage_doors", label: "Bodegas de equipaje", kind: "bodywork" },
      ],
    },
    {
      id: "rear",
      label: "Parte trasera",
      items: [
        { id: "bumper_rear", label: "Paragolpes trasero", kind: "bodywork" },
        { id: "rear_panel", label: "Panel trasero", kind: "bodywork" },
        { id: "rear_window", label: "Vidrio trasero", kind: "panoramic" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" },
        { id: "taillight_r", label: "Stop derecho", kind: "light_unit" },
      ],
    },
    {
      id: "roof",
      label: "Techo",
      items: [
        { id: "roof", label: "Techo", kind: "bodywork" },
        { id: "skylights", label: "Claraboyas / extractores", kind: "bodywork" },
      ],
    },
  ],
};

const HEAVY_BODYWORK_GROUPS = (withHood: boolean) => [
  {
    id: "front",
    label: withHood ? "Frente y capó" : "Frente",
    items: withHood
      ? [
          { id: "bumper_front", label: "Paragolpes delantero", kind: "bodywork" as const },
          { id: "hood", label: "Capó (motor adelante)", kind: "bodywork" as const },
          { id: "grille", label: "Parrilla", kind: "bodywork" as const },
          { id: "windshield", label: "Parabrisas", kind: "panoramic" as const },
          { id: "headlight_l", label: "Faro izquierdo", kind: "light_unit" as const },
          { id: "headlight_r", label: "Faro derecho", kind: "light_unit" as const },
        ]
      : [
          { id: "bumper_front", label: "Paragolpes delantero", kind: "bodywork" as const },
          { id: "front_panel", label: "Panel frontal de cabina", kind: "bodywork" as const },
          { id: "windshield", label: "Parabrisas", kind: "panoramic" as const },
          { id: "headlight_l", label: "Faro izquierdo", kind: "light_unit" as const },
          { id: "headlight_r", label: "Faro derecho", kind: "light_unit" as const },
        ],
  },
  {
    id: "cabin",
    label: "Cabina",
    items: [
      { id: "door_fl", label: "Puerta izquierda", kind: "bodywork" as const, hasSealantCheck: true },
      { id: "door_fr", label: "Puerta derecha", kind: "bodywork" as const, hasSealantCheck: true },
      { id: "fender_fl", label: "Guardabarros delantero izquierdo", kind: "bodywork" as const },
      { id: "fender_fr", label: "Guardabarros delantero derecho", kind: "bodywork" as const },
      { id: "rocker_l", label: "Estribo izquierdo", kind: "bodywork" as const },
      { id: "rocker_r", label: "Estribo derecho", kind: "bodywork" as const },
      { id: "mirror_l", label: "Espejo izquierdo", kind: "bodywork" as const },
      { id: "mirror_r", label: "Espejo derecho", kind: "bodywork" as const },
      { id: "cabin_rear", label: "Pared trasera de cabina", kind: "bodywork" as const },
      { id: "roof", label: "Techo de cabina", kind: "bodywork" as const },
    ],
  },
  {
    id: "rear_body",
    label: "Carrocería / furgón",
    items: [
      { id: "rear_body_l", label: "Costado izquierdo", kind: "bodywork" as const },
      { id: "rear_body_r", label: "Costado derecho", kind: "bodywork" as const },
      { id: "rear_body_floor", label: "Piso de carga", kind: "bodywork" as const },
      { id: "rear_body_door", label: "Portón / puerta trasera", kind: "bodywork" as const },
      { id: "bumper_rear", label: "Paragolpes trasero", kind: "bodywork" as const },
      { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" as const },
      { id: "taillight_r", label: "Stop derecho", kind: "light_unit" as const },
    ],
  },
];

export const BODYWORK_HEAVY_PANEL: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: HEAVY_BODYWORK_GROUPS(false),
};

export const BODYWORK_HEAVY_CONVENTIONAL: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: HEAVY_BODYWORK_GROUPS(true),
};

export const BODYWORK_MOTORCYCLE: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "front",
      label: "Frente",
      items: [
        { id: "headlight", label: "Faro / óptica delantera", kind: "light_unit" },
        { id: "front_fairing", label: "Carenado / cúpula frontal", kind: "bodywork" },
        { id: "front_fender", label: "Guardabarros delantero", kind: "bodywork" },
        { id: "handlebar", label: "Manubrio y mandos", kind: "bodywork" },
        { id: "instrument_cluster", label: "Tablero / panel de instrumentos", kind: "bodywork" },
        { id: "mirrors", label: "Espejos retrovisores", kind: "bodywork" },
      ],
    },
    {
      id: "body",
      label: "Cuerpo",
      items: [
        { id: "fuel_tank", label: "Tanque de combustible", kind: "bodywork" },
        { id: "side_fairing_l", label: "Carenado lateral izquierdo", kind: "bodywork" },
        { id: "side_fairing_r", label: "Carenado lateral derecho", kind: "bodywork" },
        { id: "seat", label: "Sillín / asiento", kind: "bodywork" },
        { id: "footrests", label: "Estriberas / posapiés", kind: "bodywork" },
        { id: "frame_paint", label: "Pintura del chasis visible", kind: "bodywork" },
      ],
    },
    {
      id: "rear",
      label: "Parte trasera",
      items: [
        { id: "rear_fairing", label: "Carenado trasero / colín", kind: "bodywork" },
        { id: "rear_fender", label: "Guardabarros trasero", kind: "bodywork" },
        { id: "tail_light", label: "Stop / luz trasera", kind: "light_unit" },
        { id: "turn_signals", label: "Direccionales", kind: "bodywork" },
        { id: "exhaust", label: "Escape / mofle", kind: "bodywork" },
        { id: "license_plate_holder", label: "Soporte de placa", kind: "bodywork" },
      ],
    },
  ],
};

export const BODYWORK_TRAILER: InspectionSectionDef = {
  id: "bodywork",
  label: "Carrocería",
  groups: [
    {
      id: "structure",
      label: "Estructura",
      items: [
        { id: "front_panel", label: "Panel frontal", kind: "bodywork" },
        { id: "side_panel_l", label: "Panel lateral izquierdo", kind: "bodywork" },
        { id: "side_panel_r", label: "Panel lateral derecho", kind: "bodywork" },
        { id: "roof", label: "Techo", kind: "bodywork" },
        { id: "floor", label: "Piso de carga", kind: "bodywork" },
      ],
    },
    {
      id: "rear",
      label: "Parte trasera",
      items: [
        { id: "rear_doors", label: "Puertas / portón trasero", kind: "bodywork" },
        { id: "bumper_rear", label: "Paragolpes / barra anti-empotramiento", kind: "bodywork" },
        { id: "taillight_l", label: "Stop izquierdo", kind: "light_unit" },
        { id: "taillight_r", label: "Stop derecho", kind: "light_unit" },
        { id: "license_plate_holder", label: "Soporte de placa", kind: "bodywork" },
      ],
    },
    {
      id: "coupling",
      label: "Acople y conexiones",
      items: [
        { id: "kingpin", label: "Kingpin / lanza de remolque", kind: "bodywork" },
        { id: "landing_gear", label: "Patas de apoyo", kind: "bodywork" },
        { id: "brake_lines", label: "Mangueras de aire / freno", kind: "bodywork" },
        { id: "electrical_connector", label: "Conector eléctrico (7 vías)", kind: "bodywork" },
        { id: "mud_flaps", label: "Faldones / guardafangos", kind: "bodywork" },
      ],
    },
  ],
};

const BODYWORK_BY_VEHICLE_TYPE: Record<VehicleType, InspectionSectionDef> = {
  car_5doors: BODYWORK_5DOORS,
  car_coupe: BODYWORK_5DOORS,
  suv_2doors: BODYWORK_SUV_2DOORS,
  suv_5doors: BODYWORK_SUV_5DOORS,
  pickup_single: BODYWORK_PICKUP_SINGLE,
  pickup_double: BODYWORK_PICKUP_DOUBLE,
  bus: BODYWORK_BUS,
  heavy_panel: BODYWORK_HEAVY_PANEL,
  heavy_conventional: BODYWORK_HEAVY_CONVENTIONAL,
  motorcycle: BODYWORK_MOTORCYCLE,
  trailer: BODYWORK_TRAILER,
};

export function bodyworkSectionFor(type: VehicleType): InspectionSectionDef {
  return BODYWORK_BY_VEHICLE_TYPE[type] ?? BODYWORK_5DOORS;
}
