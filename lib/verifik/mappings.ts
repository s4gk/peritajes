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
