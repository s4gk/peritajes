import type { VehicleInfo } from "@/lib/types";

/** Title-case a SCREAMING_TEXT or "lowercase" string into "Title Case". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const FUEL_MAP: Record<string, VehicleInfo["fuel"]> = {
  GASOLINA: "gasoline",
  DIESEL: "diesel",
  "DIÉSEL": "diesel",
  HIBRIDO: "hybrid",
  "HÍBRIDO": "hybrid",
  ELECTRICO: "electric",
  "ELÉCTRICO": "electric",
  GAS: "gas",
  GNV: "gas",
};

export function mapFuel(raw: string | undefined): VehicleInfo["fuel"] | undefined {
  if (!raw) return undefined;
  return FUEL_MAP[raw.trim().toUpperCase()];
}

/**
 * Map the wide variety of body labels both APIs use into the small enum the
 * existing Select offers ("Sedán", "Hatchback", "SUV", "Pickup", "Van",
 * "Coupé", "Convertible"). Returns undefined when the label has no clean home,
 * so the form leaves the field empty instead of showing a broken value.
 */
const BODY_MAP: Record<string, string> = {
  HATCHBACK: "Hatchback",
  SEDAN: "Sedán",
  "SEDÁN": "Sedán",
  AUTOMOVIL: "Sedán",
  WAGON: "SUV",
  SUV: "SUV",
  CAMIONETA: "SUV",
  PICKUP: "Pickup",
  VAN: "Van",
  COUPE: "Coupé",
  "COUPÉ": "Coupé",
  CONVERTIBLE: "Convertible",
};

export function mapBodyType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return BODY_MAP[raw.trim().toUpperCase()];
}

const CLASS_MAP: Record<string, string> = {
  AUTOMOVIL: "Automóvil",
  "AUTOMÓVIL": "Automóvil",
  CAMIONETA: "Camioneta",
  CAMPERO: "Campero",
  PICKUP: "Pickup",
  MOTOCICLETA: "Motocicleta",
  MOTOCARRO: "Motocarro",
  CAMION: "Camión",
  "CAMIÓN": "Camión",
  BUS: "Bus",
  BUSETA: "Buseta",
  MICROBUS: "Microbús",
  CUATRIMOTO: "Cuatrimoto",
};

export function mapVehicleClass(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toUpperCase();
  return CLASS_MAP[key] ?? titleCase(raw);
}

const SERVICE_MAP: Record<string, string> = {
  PARTICULAR: "Particular",
  PUBLICO: "Público",
  "PÚBLICO": "Público",
  OFICIAL: "Oficial",
  DIPLOMATICO: "Diplomático",
  "DIPLOMÁTICO": "Diplomático",
};

export function mapServiceType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toUpperCase();
  return SERVICE_MAP[key] ?? titleCase(raw);
}

export function mapNationality(importedShow: string | undefined): string | undefined {
  if (!importedShow) return undefined;
  const v = importedShow.trim().toUpperCase();
  if (v === "SI" || v === "SÍ") return "Importado";
  if (v === "NO") return "Nacional";
  return undefined;
}
