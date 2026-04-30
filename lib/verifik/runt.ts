import type { VehicleInfo } from "@/lib/types";
import type { RuntResponse } from "./types";
import { mapBodyType, mapFuel, titleCase } from "./mappings";

/**
 * Convert a RUNT response into a partial VehicleInfo seed.
 * RUNT is authoritative for vin, year, color, motor — fields FASECOLDA can't
 * provide. Note: in Colombian terminology `informacionGeneral.modelo` is the
 * AÑO of the vehicle, not its make/model.
 */
export function runtToVehicleSeed(res: RuntResponse): Partial<VehicleInfo> {
  const ig = res.data.informacionGeneral;
  const seed: Partial<VehicleInfo> = {};

  if (ig.noPlaca) seed.plate = ig.noPlaca.trim().toUpperCase();
  if (ig.noVin) seed.vin = ig.noVin.trim().toUpperCase();
  if (ig.marca) seed.make = titleCase(ig.marca);
  if (ig.linea) seed.model = ig.linea.trim();
  if (ig.modelo) seed.year = ig.modelo.trim();
  if (ig.color) seed.color = titleCase(ig.color);

  const fuel = mapFuel(ig.tipoCombustible);
  if (fuel) seed.fuel = fuel;

  const body = mapBodyType(ig.tipoCarroceria);
  if (body) seed.bodyType = body;

  return seed;
}
