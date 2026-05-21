import { z } from "zod";

/**
 * Schema de validación de InspectionData para el borde de la API. Antes de
 * insertar JSONB en Postgres pasamos el body por acá para evitar:
 *   - Strings de cientos de KB que atragantan el INSERT.
 *   - Arrays gigantes (DoS por payload).
 *   - Forms con tipos sorpresa que después rompen el render del PDF o el
 *     análisis de riesgo.
 *
 * Es deliberadamente *permisivo* en valores (la mayoría de los strings son
 * libres con un cap) y *estricto* en estructura (tipos de los enums, longitud
 * de arrays). Así un campo nuevo que el wizard agregue río arriba pasa, pero
 * un objeto malicioso o gigante se rechaza.
 */

const STR = (max: number) => z.string().max(max);

const InspectedImage = z.object({
  id: STR(128),
  // Cap a 8MB de base64 — mismo orden que MIN_REQUIRED_PHOTOS * tope cliente.
  dataUrl: z.string().max(8 * 1024 * 1024),
  caption: STR(500).optional(),
});

const Images = z.array(InspectedImage).max(20);

const InspectionEntry = z.object({
  status: STR(128).optional(),
  notes: STR(5000).optional(),
  images: Images.default([]),
  sealant: z.enum(["original", "generic"]).optional(),
});

const SectionRecord = z.record(InspectionEntry).refine(
  (r) => Object.keys(r).length <= 200,
  { message: "Demasiados items en la sección (máx. 200)." },
);

const AccessoryEntry = z.object({
  id: STR(128),
  name: STR(200),
  notes: STR(2000).optional(),
});

const CylinderEntry = z.object({
  id: STR(128),
  label: STR(64),
  status: STR(128).optional(),
  notes: STR(2000).optional(),
  images: Images.default([]),
});

const PeritajeKind = z.enum(["complete", "quick", "appraisal"]);

const VehicleType = z.enum([
  "car_5doors",
  "suv_2doors",
  "suv_5doors",
  "pickup_single",
  "pickup_double",
  "bus",
  "heavy_panel",
  "heavy_conventional",
  "motorcycle",
  "trailer",
]);

const VehicleInfo = z
  .object({
    plate: STR(20).default(""),
    vin: STR(64).default(""),
    chassisNumber: STR(64).default(""),
    engineNumber: STR(64).default(""),
    make: STR(80).default(""),
    model: STR(120).default(""),
    year: STR(8).default(""),
    color: STR(40).default(""),
    vehicleClass: STR(80).default(""),
    nationality: STR(40).default(""),
    cylinderCapacity: STR(16).default(""),
    serviceType: STR(40).default(""),
    paintCondition: STR(80).default(""),
    mileage: STR(16).default(""),
    fuel: z
      .enum(["gasoline", "diesel", "hybrid", "electric", "gas", ""])
      .default(""),
    transmission: z.enum(["manual", "automatic", "cvt", "dct", ""]).default(""),
    bodyType: STR(80).default(""),
    owner: STR(200).default(""),
    ownerDocument: STR(40).default(""),
    ownerPhone: STR(40).default(""),
    insurer: STR(120).default(""),
    hasClaimsHistory: STR(8).default(""),
    claimsCount: STR(8).default(""),
    claimsValue: STR(24).default(""),
    propertyCardStatus: STR(40).default(""),
    sibgaCode: STR(40).default(""),
    depreciationPct: STR(8).default(""),
    depreciationNotes: STR(2000).default(""),
    inspector: STR(200).default(""),
    inspectorId: STR(64).default(""),
    location: STR(200).default(""),
    date: STR(32).default(""),
  })
  .passthrough();

const TirePositionKey = z.enum(["fl", "fr", "rl", "rr", "spare"]);

const RimEntry = z.object({
  material: z.enum(["steel", "aluminum", "magnesium"]).optional(),
  origin: z.enum(["original", "replica", "aftermarket"]).optional(),
  status: STR(128).optional(),
});

const Tires = z.object({
  frontLeft: z.number().min(0).max(100),
  frontRight: z.number().min(0).max(100),
  rearLeft: z.number().min(0).max(100),
  rearRight: z.number().min(0).max(100),
  spare: z.number().min(0).max(100),
  notes: STR(2000).optional(),
  images: Images.default([]),
  findings: z.record(TirePositionKey, InspectionEntry).optional(),
  rims: z.record(TirePositionKey, RimEntry).optional(),
});

const Conclusion = z
  .object({
    generalCondition: STR(128).default(""),
    observations: STR(8000).default(""),
    recommendation: STR(8000).default(""),
    inspectorSignature: z.string().max(1024 * 1024).optional(),
    clientSignature: z.string().max(1024 * 1024).optional(),
  })
  .passthrough();

// VerifikSnapshot lo tomamos como permisivo — el módulo verifik ya valida.
const Verifik = z
  .object({
    queriedAt: STR(64),
    documentType: STR(16).optional(),
    documentNumber: STR(40).optional(),
    fasecolda: z.unknown().nullable().optional(),
    runt: z.unknown().nullable().optional(),
  })
  .passthrough();

export const InspectionDataSchema = z
  .object({
    kind: PeritajeKind,
    vehicleType: VehicleType,
    vehicle: VehicleInfo,
    documents: z
      .object({
        ownershipCardFront: z.array(InspectedImage).max(10).default([]),
        ownershipCardBack: z.array(InspectedImage).max(10).default([]),
      })
      .default({ ownershipCardFront: [], ownershipCardBack: [] }),
    bodywork: SectionRecord.default({}),
    chassis: SectionRecord.default({}),
    suspension: SectionRecord.default({}),
    tires: Tires,
    engine: SectionRecord.default({}),
    engineCompression: z.array(CylinderEntry).max(16).default([]),
    electrical: SectionRecord.default({}),
    leaks: SectionRecord.default({}),
    comfort: SectionRecord.default({}),
    roadTest: SectionRecord.default({}),
    roadTestSkipped: z.boolean().optional(),
    extraPhotos: z.array(InspectedImage).max(60).default([]),
    mandatoryPhotos: z
      .object({
        diagonalFrontLeft: z.array(InspectedImage).max(10).default([]),
        diagonalRearRight: z.array(InspectedImage).max(10).default([]),
        innerCabin: z.array(InspectedImage).max(10).default([]),
        chassisNumber: z.array(InspectedImage).max(10).default([]),
        engineNumber: z.array(InspectedImage).max(10).default([]),
        idPlate: z.array(InspectedImage).max(10).default([]),
      })
      .default({
        diagonalFrontLeft: [],
        diagonalRearRight: [],
        innerCabin: [],
        chassisNumber: [],
        engineNumber: [],
        idPlate: [],
      }),
    accessories: z.array(AccessoryEntry).max(100).default([]),
    confirmedSteps: z.array(STR(64)).max(50).default([]),
    status: z.enum(["draft", "completed"]).default("draft"),
    completedAt: STR(64).optional(),
    conclusion: Conclusion,
    verifik: Verifik.optional(),
  })
  .passthrough();

export type InspectionDataParsed = z.infer<typeof InspectionDataSchema>;
