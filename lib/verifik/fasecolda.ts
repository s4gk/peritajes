import type { VehicleInfo } from "@/lib/types";
import type { FasecoldaResponse } from "./types";
import {
  mapBodyType,
  mapFuel,
  mapNationality,
  mapServiceType,
  mapVehicleClass,
  titleCase,
} from "./mappings";

/**
 * Convert a FASECOLDA response into a partial VehicleInfo seed.
 * FASECOLDA does NOT provide vin, year, color, or owner — those come from RUNT.
 */
export function fasecoldaToVehicleSeed(res: FasecoldaResponse): Partial<VehicleInfo> {
  const d = res.data;
  const seed: Partial<VehicleInfo> = {};

  if (d.plate) seed.plate = d.plate.trim().toUpperCase();
  if (d.marke) seed.make = titleCase(d.marke);

  // FASECOLDA splits the model name across line1/2/3 — concatenate to get the
  // full trim ("SANDERO [FL] AUTHENTIQUE MT 1600CC 8V AA"). Falls back to
  // whatever pieces are available.
  const modelParts = [d.line1, d.line2, d.line3]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  if (modelParts.length > 0) seed.model = modelParts.join(" ");

  if (d.cylinderCapacity) seed.cylinderCapacity = d.cylinderCapacity.trim();

  const fuel = mapFuel(d.fuel);
  if (fuel) seed.fuel = fuel;

  const body = mapBodyType(d.typology);
  if (body) seed.bodyType = body;

  const klass = mapVehicleClass(d.class);
  if (klass) seed.vehicleClass = klass;

  const service = mapServiceType(d.service);
  if (service) seed.serviceType = service;

  const nationality = mapNationality(d.importedShow);
  if (nationality) seed.nationality = nationality;

  return seed;
}

/**
 * Best-effort latest market value in COP, computed from `valueModel` (which is
 * an array of historical values per model year, expressed in THOUSANDS of COP
 * — the API's `64200` means $64,200,000 COP).
 *
 * Returns null when no valuation rows are present.
 */
export function fasecoldaLatestValueCop(res: FasecoldaResponse): number | null {
  const arr = res.data.valueModel;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => Number(b.modelo) - Number(a.modelo));
  const top = sorted[0];
  if (!top || typeof top.valor !== "number") return null;
  return top.valor * 1000;
}
