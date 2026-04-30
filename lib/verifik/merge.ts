import type { VehicleInfo } from "@/lib/types";

/**
 * Merge two partial vehicle seeds with explicit precedence per field.
 *
 * RUNT wins for vehicle identity (plate, vin, year, color, owner) — those
 * come from the legal registry and describe THIS specific car.
 *
 * FASECOLDA wins for the model/trim string because it includes the full
 * factory designation ("SANDERO [FL] AUTHENTIQUE MT 1600CC 8V AA") whereas
 * RUNT only carries the short line ("SANDERO"). RUNT model is the fallback
 * when FASECOLDA didn't return.
 *
 * For make/fuel/bodyType either source is fine — RUNT is preferred but
 * FASECOLDA fills the gap.
 */
export function mergeVerifikSeeds(
  fromRunt: Partial<VehicleInfo>,
  fromFasecolda: Partial<VehicleInfo>,
): Partial<VehicleInfo> {
  return prune({
    plate: fromRunt.plate ?? fromFasecolda.plate,
    vin: fromRunt.vin,
    make: fromRunt.make ?? fromFasecolda.make,
    model: fromFasecolda.model ?? fromRunt.model,
    year: fromRunt.year,
    color: fromRunt.color,
    fuel: fromRunt.fuel ?? fromFasecolda.fuel,
    bodyType: fromRunt.bodyType ?? fromFasecolda.bodyType,
  });
}

function prune<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== "") out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
