import {
  ALL_SECTIONS,
  bodyworkSectionFor,
  FALLBACK_VEHICLE_TYPE,
} from "@/lib/constants";
import { defaultOkValueFor, findOption } from "@/lib/findings-catalog";
import type { InspectionData, InspectionEntry, VehicleType } from "@/lib/types";

function okSection(sectionId: string): Record<string, InspectionEntry> {
  const section = ALL_SECTIONS.find((s) => s.id === sectionId);
  if (!section) throw new Error(`unknown section ${sectionId}`);
  const acc: Record<string, InspectionEntry> = {};
  for (const g of section.groups) {
    for (const i of g.items) {
      acc[i.id] = { status: defaultOkValueFor(i.kind), notes: "", images: [] };
    }
  }
  return acc;
}

export function pristineInspection(): InspectionData {
  return {
    kind: "plus",
    vehicleType: FALLBACK_VEHICLE_TYPE,
    vehicle: {
      plate: "ABC123",
      vin: "1HGBH41JXMN109186",
      chassisNumber: "",
      engineNumber: "",
      make: "Toyota",
      model: "Corolla",
      year: "2020",
      color: "Blanco",
      vehicleClass: "",
      nationality: "",
      cylinderCapacity: "",
      serviceType: "",
      paintCondition: "",
      mileage: "40000",
      fuel: "gasoline",
      transmission: "automatic",
      bodyType: "Sedán",
      owner: "Test",
      ownerDocument: "",
      ownerPhone: "",
      insurer: "",
      hasClaimsHistory: "",
      claimsCount: "",
      claimsValue: "",
      propertyCardStatus: "",
      sibgaCode: "",
      fasecoldaValue: "",
      fasecoldaCode: "",
      llanoValue: "",
      depreciationPct: "",
      depreciationNotes: "",
      inspector: "Inspector",
      inspectorId: "X",
      location: "Bogotá",
      date: "2026-04-27",
    },
    documents: { ownershipCardFront: [], ownershipCardBack: [] },
    bodywork: okSection("bodywork"),
    chassis: okSection("chassis"),
    suspension: okSection("suspension"),
    tires: { frontLeft: 90, frontRight: 90, rearLeft: 90, rearRight: 90, spare: 100, notes: "", images: [] },
    engine: okSection("engine"),
    engineCompression: [],
    electrical: okSection("electrical"),
    leaks: okSection("leaks"),
    comfort: okSection("comfort"),
    roadTest: okSection("roadTest"),
    extraPhotos: [],
    mandatoryPhotos: {
      diagonalFrontLeft: [],
      diagonalRearRight: [],
      innerCabin: [],
      chassisNumber: [],
      engineNumber: [],
      idPlate: [],
    },
    accessories: [],
    confirmedSteps: [],
    status: "draft",
    conclusion: { generalCondition: "mech_optimal", observations: "", recommendation: "" },
  };
}

/**
 * Peritaje limpio de un tipo de vehículo distinto al sedán.
 *
 * La carrocería se llena con la variante que le corresponde al tipo
 * (`bodyworkSectionFor`), que es lo que hace el wizard de verdad: una moto
 * tiene 18 paneles con ids propios (`front_fairing`, `fuel_tank`…) que no
 * existen en el inventario de sedán.
 */
export function pristineInspectionOfType(
  vehicleType: VehicleType,
): InspectionData {
  const data = pristineInspection();
  data.vehicleType = vehicleType;
  const body = bodyworkSectionFor(vehicleType);
  const acc: Record<string, InspectionEntry> = {};
  for (const g of body.groups) {
    for (const i of g.items) {
      acc[i.id] = { status: defaultOkValueFor(i.kind), notes: "", images: [] };
    }
  }
  data.bodywork = acc;
  return data;
}

/**
 * Marca un ítem con un valor del catálogo, validando que el valor EXISTA.
 *
 * La validación no es paranoia: el motor de reglas resuelve cada estado con
 * `findOption` y descarta en silencio lo que no reconoce. Un typo en un test
 * (pasó con `"leak_puddle"`) no fallaba — simplemente el hallazgo no existía y
 * el test seguía en verde midiendo otra cosa.
 */
function setEntry(
  record: Record<string, InspectionEntry>,
  itemId: string,
  status: string,
): void {
  if (!findOption(status)) {
    throw new Error(
      `Valor de catálogo inexistente: "${status}" (ítem "${itemId}")`,
    );
  }
  record[itemId] = { status, notes: "", images: [] };
}

export function setBodywork(data: InspectionData, itemId: string, status: string): InspectionData {
  setEntry(data.bodywork, itemId, status);
  return data;
}

export function setChassis(data: InspectionData, itemId: string, status: string): InspectionData {
  setEntry(data.chassis, itemId, status);
  return data;
}

export function setLeak(data: InspectionData, itemId: string, status: string): InspectionData {
  setEntry(data.leaks, itemId, status);
  return data;
}

export function setRoadTest(data: InspectionData, itemId: string, status: string): InspectionData {
  setEntry(data.roadTest, itemId, status);
  return data;
}

export function setEngine(data: InspectionData, itemId: string, status: string): InspectionData {
  setEntry(data.engine, itemId, status);
  return data;
}

/**
 * Suspensión: usa el mismo catálogo mecánico que el motor y SÍ está activa en
 * los tres kinds, así que es la sección correcta para ejercitar las reglas
 * mecánicas. (`setEngine` quedó para probar justamente que el motor NO
 * califica — no está en ningún kind.)
 */
export function setSuspension(data: InspectionData, itemId: string, status: string): InspectionData {
  setEntry(data.suspension, itemId, status);
  return data;
}
