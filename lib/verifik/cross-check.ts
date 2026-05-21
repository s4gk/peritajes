import type { VehicleInfo } from "@/lib/types";

import type { VerifikSnapshot } from "./types";

/**
 * Cross-check VIN / chasis / motor / placa / marca / año contra lo que devolvió
 * el RUNT. Discrepancias son señal típica de gemeleo, fraude documental o
 * simplemente errores de tipeo. Las mostramos como advertencia visible — la
 * decisión final la toma el perito.
 */

export type MismatchField =
  | "plate"
  | "vin"
  | "chassisNumber"
  | "engineNumber"
  | "make"
  | "year";

export type Mismatch = {
  field: MismatchField;
  label: string;
  capturedLabel: string;
  captured: string;
  expected: string;
};

const FIELD_LABELS: Record<MismatchField, string> = {
  plate: "Placa",
  vin: "VIN / No. Serial",
  chassisNumber: "No. Chasis",
  engineNumber: "No. Motor",
  make: "Marca",
  year: "Año",
};

function norm(s: string | undefined | null): string {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** Para marca aceptamos comparación más laxa — quitamos espacios pero no
 *  letras/números (manteniendo caracteres). RUNT trae "MAZDA" y el perito
 *  pudo escribir "Mazda" — normalizamos a uppercase y comparamos sin espacios. */
function normLoose(s: string | undefined | null): string {
  return (s ?? "").toString().trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Devuelve la lista de discrepancias. Si no hay snapshot o snapshot sin RUNT,
 * devuelve []. No comparamos contra campos vacíos en ningún lado — la
 * advertencia exige que ambos valores existan.
 */
export function crossCheckVerifik(
  vehicle: VehicleInfo,
  snapshot: VerifikSnapshot | undefined | null,
): Mismatch[] {
  const runt = snapshot?.runt?.data?.informacionGeneral;
  if (!runt) return [];

  const out: Mismatch[] = [];

  function checkExact(
    field: MismatchField,
    capturedRaw: string,
    expectedRaw: string,
  ) {
    const captured = norm(capturedRaw);
    const expected = norm(expectedRaw);
    if (!captured || !expected) return;
    if (captured !== expected) {
      out.push({
        field,
        label: FIELD_LABELS[field],
        capturedLabel: capturedRaw,
        captured,
        expected: expectedRaw,
      });
    }
  }

  function checkLoose(
    field: MismatchField,
    capturedRaw: string,
    expectedRaw: string,
  ) {
    const captured = normLoose(capturedRaw);
    const expected = normLoose(expectedRaw);
    if (!captured || !expected) return;
    if (captured !== expected) {
      out.push({
        field,
        label: FIELD_LABELS[field],
        capturedLabel: capturedRaw,
        captured,
        expected: expectedRaw,
      });
    }
  }

  checkExact("plate", vehicle.plate, runt.noPlaca);
  checkExact("vin", vehicle.vin, runt.noVin);
  checkExact("chassisNumber", vehicle.chassisNumber, runt.noChasis);
  checkExact("engineNumber", vehicle.engineNumber, runt.noMotor);
  checkLoose("make", vehicle.make, runt.marca);
  // RUNT.modelo es el año en Colombia.
  checkExact("year", vehicle.year, runt.modelo);

  return out;
}
