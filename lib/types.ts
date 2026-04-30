import type { VerifikSnapshot } from "./verifik/types";

export type RiskLevel = "low" | "medium" | "high";

export type ItemKind = "bodywork" | "structural" | "mechanical" | "road_test" | "leak";

export type InspectedImage = {
  id: string;
  dataUrl: string;
  caption?: string;
};

export type InspectionEntry = {
  /** finding value from findings-catalog */
  status?: string;
  notes?: string;
  images: InspectedImage[];
};

export type AccessoryEntry = {
  id: string;
  name: string;
  status: string; // finding value from mechanical catalog (or simple good/regular/bad)
  notes?: string;
};

export type VehicleInfo = {
  plate: string;
  vin: string;
  make: string;
  model: string;
  year: string;
  color: string;
  mileage: string;
  fuel: "gasoline" | "diesel" | "hybrid" | "electric" | "gas" | "";
  transmission: "manual" | "automatic" | "cvt" | "dct" | "";
  bodyType: string;
  owner: string;
  inspector: string;
  inspectorId: string;
  location: string;
  date: string; // ISO yyyy-mm-dd
};

export type InspectionData = {
  vehicle: VehicleInfo;
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
  };
  engine: Record<string, InspectionEntry>;
  electrical: Record<string, InspectionEntry>;
  leaks: Record<string, InspectionEntry>;
  comfort: Record<string, InspectionEntry>;
  roadTest: Record<string, InspectionEntry>;
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
  data: InspectionData;
};
