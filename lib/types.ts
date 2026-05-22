import type { VerifikSnapshot } from "./verifik/types";

export type RiskLevel = "low" | "medium" | "high";

export type PeritajeKind = "complete" | "quick" | "appraisal";

/** Categoría comercial del vehículo. Determina qué pasos del wizard aplican y
 *  qué inventario de carrocería se usa. */
export type VehicleType =
  | "car_5doors"          // Carrocería 5 Puertas (sedán/hatchback autoportante).
  | "car_coupe"           // Coupé autoportante: 2 puertas, sin puertas traseras.
  | "suv_2doors"          // Campero 3 Puertas (2 laterales + portón trasero).
  | "suv_5doors"          // Campero 5 Puertas.
  | "pickup_single"       // Pick Up Sencilla (cabina sencilla + platón).
  | "pickup_double"       // Pick Up Doble Cabina.
  | "bus"                 // Bus (>19 pasajeros).
  | "heavy_panel"         // Pesado con cabina adelantada (cab-over).
  | "heavy_conventional"  // Pesado con cabina convencional.
  | "motorcycle"          // Moto, motocarro, cuatrimoto.
  | "trailer";            // Remolque o semirremolque.

export type ItemKind = "bodywork" | "structural" | "mechanical" | "road_test" | "leak" | "light_unit" | "panoramic";

export type InspectedImage = {
  id: string;
  dataUrl: string;
  caption?: string;
};

/** Estado del sellante del marco de puerta. Aplica solo a items marcados con
 *  `hasSealantCheck: true` (puertas de los catálogos de carrocería). */
export type SealantState = "original" | "generic";

export type InspectionEntry = {
  /** finding value from findings-catalog */
  status?: string;
  notes?: string;
  images: InspectedImage[];
  /** Sellante del marco. Solo se muestra/persiste para items que lo soportan
   *  (puertas). undefined = aún no calificado. */
  sealant?: SealantState;
};

export type AccessoryEntry = {
  id: string;
  name: string;
  notes?: string;
};

export type TirePosition = "fl" | "fr" | "rl" | "rr" | "spare";

/** Material constructivo del rin. Relevante para valuación y para identificar
 *  reemplazos (un Ford de fábrica con rines de magnesio = aftermarket). */
export type RimMaterial = "steel" | "aluminum" | "magnesium";

/** Origen del rin: si vino con el carro o se cambió después. */
export type RimOrigin = "original" | "replica" | "aftermarket";

/** Estado y características del rin de una rueda. Las fotos/observaciones
 *  visuales se comparten con `tires.findings[pos]` (el perito está parado
 *  frente a la misma rueda), así que acá guardamos solo lo que es propio
 *  del rin: material, origen y hallazgo. */
export type RimEntry = {
  material?: RimMaterial;
  origin?: RimOrigin;
  /** finding value del RIM_CATALOG en findings-catalog */
  status?: string;
};

/** Lectura de compresión de un cilindro individual. El perito los agrega
 *  dinámicamente en el grupo "Compresión" del paso Motor. `status` reusa el
 *  catálogo mecánico (Óptimo / Funcional / Hallazgo). */
export type CylinderEntry = {
  id: string;
  label: string;
  status?: string;
  notes?: string;
  images: InspectedImage[];
};

export type VehicleInfo = {
  plate: string;
  /** No. Serial — en Colombia es lo mismo que el VIN. */
  vin: string;
  /** No. Chasis físico estampado. Suele coincidir con el VIN pero el RUNT lo
   * trae aparte, así que lo guardamos aparte. */
  chassisNumber: string;
  /** No. Motor estampado en el bloque. */
  engineNumber: string;
  make: string;
  /** Línea / trim: "Corolla XEi 1.8". */
  model: string;
  /** Modelo (año del vehículo en terminología colombiana). */
  year: string;
  color: string;
  /** Clase de vehículo: "Automóvil", "Camioneta", "Campero", etc. */
  vehicleClass: string;
  /** "Nacional" | "Importado" | "" */
  nationality: string;
  /** Cilindraje en cc, almacenado como string (igual que mileage). */
  cylinderCapacity: string;
  /** "Particular" | "Público" | "Oficial" | "" */
  serviceType: string;
  /** Estado de la pintura — concepto de peritaje, no del RUNT.
   * "Original" | "Repintada parcial" | "Repintada total" | "" */
  paintCondition: string;
  mileage: string;
  fuel: "gasoline" | "diesel" | "hybrid" | "electric" | "gas" | "";
  transmission: "manual" | "automatic" | "cvt" | "dct" | "";
  bodyType: string;
  owner: string;
  /** Documento o NIT del propietario. */
  ownerDocument: string;
  /** Teléfono de contacto del propietario (para WhatsApp / contacto). */
  ownerPhone: string;
  /** Aseguradora particular (todo riesgo, no la del SOAT). */
  insurer: string;
  /** "Sí" | "No" | "" — reporte de siniestros declarado por el propietario. */
  hasClaimsHistory: string;
  /** Cantidad de siniestros reportados (string para alinearse con el resto). */
  claimsCount: string;
  /** Valor total de reclamaciones en COP, almacenado como string. */
  claimsValue: string;
  /** Estado de la tarjeta de propiedad: "Original" | "Duplicado" | "". */
  propertyCardStatus: string;
  /** Código Sibga (ingreso manual — no lo trae Verifik). */
  sibgaCode: string;
  /** % de depreciación calculado por el perito (string para alinearse con el resto). */
  depreciationPct: string;
  /** Notas / justificación del cálculo de depreciación. */
  depreciationNotes: string;
  inspector: string;
  inspectorId: string;
  location: string;
  date: string; // ISO yyyy-mm-dd
};

export type InspectionData = {
  /** Tipo de peritaje. Define qué secciones aparecen en el wizard y en el PDF.
   * - complete: inspección integral (default histórico).
   * - quick: pre-compra. Solo carrocería + llantas + motor + fugas + ruta.
   * - appraisal: avalúo comercial. Carrocería + llantas + motor + accesorios. */
  kind: PeritajeKind;
  /** Tipo de carrocería del vehículo. Define el inventario de carrocería y
   *  filtra pasos que no aplican (ej. tráiler no tiene motor, moto no tiene
   *  chasis estructural en el sentido del catálogo de carros). */
  vehicleType: VehicleType;
  vehicle: VehicleInfo;
  /** Fotos de documentos legales: tarjeta de propiedad / licencia de tránsito,
   *  capturadas en el paso 1. Mínimo 1 imagen por cara. */
  documents: {
    ownershipCardFront: InspectedImage[];
    ownershipCardBack: InspectedImage[];
  };
  bodywork: Record<string, InspectionEntry>;
  chassis: Record<string, InspectionEntry>;
  suspension: Record<string, InspectionEntry>;
  tires: {
    frontLeft: number;
    frontRight: number;
    rearLeft: number;
    rearRight: number;
    spare: number;
    notes?: string;
    images: InspectedImage[];
    /** Hallazgos + fotos por llanta capturados en el paso Recorrido. La
     *  profundidad sigue en frontLeft/frontRight/... — esto cubre estado
     *  visual del neumático (desgaste lateral, cortes, etc.). Las fotos y
     *  observaciones de este entry se comparten con la evaluación del rin
     *  de la misma posición (`rims[pos]`). */
    findings?: Partial<Record<TirePosition, InspectionEntry>>;
    /** Material, origen y hallazgo del rin por posición. Capturado en el
     *  mismo acordeón que la llanta porque físicamente se inspecciona la
     *  misma rueda. */
    rims?: Partial<Record<TirePosition, RimEntry>>;
  };
  engine: Record<string, InspectionEntry>;
  /** Cilindros agregados dinámicamente por el perito en el grupo "Compresión"
   *  del paso Motor. Lista vacía si no se midió compresión. */
  engineCompression: CylinderEntry[];
  electrical: Record<string, InspectionEntry>;
  leaks: Record<string, InspectionEntry>;
  comfort: Record<string, InspectionEntry>;
  roadTest: Record<string, InspectionEntry>;
  /** Si el perito decide que la prueba de ruta no aplica (vehículo no rueda,
   *  cliente no autoriza recorrido, etc.). Cuando es true, la etapa se omite
   *  del informe y de las métricas — los datos guardados en `roadTest` se
   *  ignoran pero no se borran, así si se vuelve a "Sí aplica" no se pierden. */
  roadTestSkipped?: boolean;
  /** Galería libre de fotos adicionales que el perito sube en el paso
   *  "extraPhotos" — anexos, detalles que no encajan en ningún ítem específico.
   *  Aparecen en el PDF dentro de la evidencia fotográfica al final. */
  extraPhotos: InspectedImage[];
  /** Seis fotos obligatorias capturadas en el paso "extraPhotos" — vistas
   *  estándar que todo peritaje debe registrar (diagonales del vehículo,
   *  habitáculo y números de identificación). Cada slot requiere al menos una
   *  imagen para poder avanzar al resumen. */
  mandatoryPhotos: {
    diagonalFrontLeft: InspectedImage[];
    diagonalRearRight: InspectedImage[];
    innerCabin: InspectedImage[];
    chassisNumber: InspectedImage[];
    engineNumber: InspectedImage[];
    idPlate: InspectedImage[];
  };
  accessories: AccessoryEntry[];
  /** Step IDs the perito has explicitly advanced past (pressed Siguiente). */
  confirmedSteps: string[];
  /** Lifecycle: "draft" while the perito is filling, "completed" once they've
   * pressed Finalizar in the summary step. Completed peritajes are read-only
   * unless explicitly reopened. Older rows without this field default to
   * "draft" via mergeDefaults. */
  status: "draft" | "completed";
  /** ISO timestamp of when the peritaje was finalized. Undefined for drafts. */
  completedAt?: string;
  conclusion: {
    generalCondition: string; // finding value from mechanical
    observations: string;
    recommendation: string;
    inspectorSignature?: string; // dataUrl
    clientSignature?: string; // dataUrl
  };
  /** Raw Verifik responses kept so the wizard can surface FASECOLDA value,
   * SOAT/RTM, prendas, etc. without paying for a second lookup. */
  verifik?: VerifikSnapshot;
};

export type InspectionItemDef = {
  id: string;
  label: string;
  kind: ItemKind;
  required?: boolean;
  /** Si es true, el row del wizard muestra además un selector de sellante
   *  del marco (Original / Genérico). Se usa para puertas en los catálogos
   *  de carrocería. */
  hasSealantCheck?: boolean;
};

export type InspectionSectionDef = {
  id: keyof Pick<
    InspectionData,
    | "bodywork"
    | "chassis"
    | "suspension"
    | "engine"
    | "electrical"
    | "leaks"
    | "comfort"
    | "roadTest"
  >;
  label: string;
  groups: { id: string; label: string; items: InspectionItemDef[] }[];
};

export type StoredInspection = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Consecutivo oficial (ej. PER-2026-0001). Se asigna recién cuando el
   *  peritaje se finaliza — en borradores es undefined. Inmutable una vez
   *  asignado. */
  reportNumber?: string;
  /** ISO timestamp del momento en que el peritaje quedó finalizado e
   *  inmutable. Si está presente, ninguna mutación (PUT, autosave) puede
   *  alterar `data` — solo admins pueden borrar la fila completa. */
  lockedAt?: string;
  /** SHA-256 hex del PDF persistido al finalizar. Permite verificar que el
   *  archivo en disco no fue alterado fuera del flujo de la app. */
  pdfSha256?: string;
  /** Bytes del PDF stored, para mostrar tamaño en UI sin leer el archivo. */
  pdfSize?: number;
  data: InspectionData;
};
