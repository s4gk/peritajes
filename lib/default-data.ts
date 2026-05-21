import { ALL_SECTIONS, DEFAULT_PERITAJE_KIND, FALLBACK_VEHICLE_TYPE } from "./constants";
import { defaultOkValueFor } from "./findings-catalog";
import type { CylinderEntry, InspectionData, InspectionEntry } from "./types";

/**
 * DEMO MODE
 * ---------
 * `emptyInspection()` pre-rellena todos los campos con datos de prueba para que
 * el perito pueda recorrer el wizard rápido mientras revisa la app.
 *
 * En prod queremos peritajes en blanco. Lo controlamos por env var pública
 * (NEXT_PUBLIC_DEMO_MODE) — en dev local podés ponerla en "true" para que el
 * wizard arranque sembrado y vaya rápido al hacer pruebas.
 */
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function emptySection(sectionId: string): Record<string, InspectionEntry> {
  const section = ALL_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return {};
  const acc: Record<string, InspectionEntry> = {};
  for (const group of section.groups) {
    for (const item of group.items) {
      acc[item.id] = { status: undefined, notes: "", images: [] };
    }
  }
  return acc;
}

/** Mínimo de cilindros que el grupo "Compresión" siempre muestra. La UI no
 *  deja borrar por debajo de este número y `ensureMinCylinders` rellena
 *  peritajes guardados con menos. */
export const MIN_CYLINDERS = 3;

/** Cilindros iniciales que aparecen en el grupo "Compresión" del paso Motor.
 *  El perito puede agregar más, pero nunca queda con menos de MIN_CYLINDERS. */
export function initialCylinders(count = MIN_CYLINDERS): CylinderEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `cyl-${i + 1}`,
    label: `Cilindro ${i + 1}`,
    status: undefined,
    notes: "",
    images: [],
  }));
}

/** Si la lista guardada tiene menos cilindros que el mínimo, la rellena
 *  preservando los existentes. Usado al hidratar peritajes legacy o que
 *  arrastran un campo vacío. */
export function ensureMinCylinders(
  list: CylinderEntry[],
  min = MIN_CYLINDERS,
): CylinderEntry[] {
  if (list.length >= min) return list;
  const padding: CylinderEntry[] = Array.from(
    { length: min - list.length },
    (_, i) => {
      const n = list.length + i + 1;
      return {
        id: `cyl-${n}`,
        label: `Cilindro ${n}`,
        status: undefined,
        notes: "",
        images: [],
      };
    },
  );
  return [...list, ...padding];
}

/** Rellena una sección marcando todos los items con el valor "OK" por defecto. */
function demoSection(sectionId: string): Record<string, InspectionEntry> {
  const section = ALL_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return {};
  const acc: Record<string, InspectionEntry> = {};
  for (const group of section.groups) {
    for (const item of group.items) {
      acc[item.id] = {
        status: defaultOkValueFor(item.kind),
        notes: "",
        images: [],
      };
    }
  }
  return acc;
}

export function emptyInspection(): InspectionData {
  if (!DEMO_MODE) {
    return {
      kind: DEFAULT_PERITAJE_KIND,
      vehicleType: FALLBACK_VEHICLE_TYPE,
      vehicle: {
        plate: "",
        vin: "",
        chassisNumber: "",
        engineNumber: "",
        make: "",
        model: "",
        year: "",
        color: "",
        vehicleClass: "",
        nationality: "",
        cylinderCapacity: "",
        serviceType: "",
        paintCondition: "",
        mileage: "",
        fuel: "",
        transmission: "",
        bodyType: "",
        owner: "",
        ownerDocument: "",
        ownerPhone: "",
        insurer: "",
        hasClaimsHistory: "",
        claimsCount: "",
        claimsValue: "",
        propertyCardStatus: "",
        sibgaCode: "",
        depreciationPct: "",
        depreciationNotes: "",
        inspector: "",
        inspectorId: "",
        location: "",
        date: new Date().toISOString().slice(0, 10),
      },
      documents: {
        ownershipCardFront: [],
        ownershipCardBack: [],
      },
      bodywork: emptySection("bodywork"),
      chassis: emptySection("chassis"),
      suspension: emptySection("suspension"),
      tires: {
        frontLeft: 100,
        frontRight: 100,
        rearLeft: 100,
        rearRight: 100,
        spare: 100,
        notes: "",
        images: [],
      },
      engine: emptySection("engine"),
      engineCompression: initialCylinders(),
      electrical: emptySection("electrical"),
      leaks: emptySection("leaks"),
      comfort: emptySection("comfort"),
      roadTest: emptySection("roadTest"),
      roadTestSkipped: false,
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
      conclusion: {
        generalCondition: "",
        observations: "",
        recommendation: "",
        inspectorSignature: undefined,
        clientSignature: undefined,
      },
    };
  }

  // Datos de demostración — todo listo para pasar rápido por el wizard
  return {
    kind: DEFAULT_PERITAJE_KIND,
    vehicleType: FALLBACK_VEHICLE_TYPE,
    vehicle: {
      plate: "DEMO123",
      vin: "1HGBH41JXMN109186",
      chassisNumber: "1HGBH41JXMN109186",
      engineNumber: "M20A3001234",
      make: "Toyota",
      model: "Corolla Cross XEi 2.0",
      year: "2023",
      color: "Blanco Perla",
      vehicleClass: "Camioneta",
      nationality: "Importado",
      cylinderCapacity: "1987",
      serviceType: "Particular",
      paintCondition: "Original",
      mileage: "28500",
      fuel: "gasoline",
      transmission: "automatic",
      bodyType: "SUV",
      owner: "Laura Restrepo Gómez",
      ownerDocument: "1.020.456.789",
      ownerPhone: "+57 310 555 1234",
      insurer: "Seguros Sura",
      hasClaimsHistory: "No",
      claimsCount: "0",
      claimsValue: "0",
      propertyCardStatus: "Original",
      sibgaCode: "TY-CRC-23-XEI20",
      depreciationPct: "12",
      depreciationNotes:
        "Depreciación moderada: 2 años de uso, kilometraje bajo (28.500 km), sin reparaciones estructurales ni reportes de siniestros.",
      inspector: "Carlos Mendoza",
      inspectorId: "PI-20451",
      location: "Bogotá · Carrera 15 #93-47",
      date: new Date().toISOString().slice(0, 10),
    },
    documents: {
      ownershipCardFront: [],
      ownershipCardBack: [],
    },
    bodywork: demoSection("bodywork"),
    chassis: demoSection("chassis"),
    suspension: demoSection("suspension"),
    tires: {
      frontLeft: 78,
      frontRight: 80,
      rearLeft: 72,
      rearRight: 75,
      spare: 95,
      notes:
        "Michelin Primacy 4 · 205/55 R16 · DOT 2023. Desgaste uniforme, sin deformaciones.",
      images: [],
    },
    engine: demoSection("engine"),
    engineCompression: [
      { id: "cyl-1", label: "Cilindro 1", status: "mech_optimal", notes: "165 psi", images: [] },
      { id: "cyl-2", label: "Cilindro 2", status: "mech_optimal", notes: "162 psi", images: [] },
      { id: "cyl-3", label: "Cilindro 3", status: "mech_optimal", notes: "160 psi", images: [] },
      { id: "cyl-4", label: "Cilindro 4", status: "mech_optimal", notes: "163 psi", images: [] },
    ],
    electrical: demoSection("electrical"),
    leaks: demoSection("leaks"),
    comfort: demoSection("comfort"),
    roadTest: demoSection("roadTest"),
    roadTestSkipped: false,
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
    confirmedSteps: [
      "vehicle",
      "bodywork",
      "chassis",
      "suspension",
      "tires",
      "engine",
      "electrical",
      "leaks",
      "comfort",
      "roadTest",
      "accessories",
    ],
    status: "draft",
    conclusion: {
      generalCondition: "mech_optimal",
      observations:
        "Vehículo en excelente estado general. Sin evidencia de golpes, reparaciones estructurales ni alteraciones. Mantenimiento al día según el odómetro y el historial presentado por el propietario.",
      recommendation:
        "Apto para uso particular sin reservas. Se recomienda mantenimiento preventivo a los 30.000 km según la ficha del fabricante.",
      inspectorSignature: undefined,
      clientSignature: undefined,
    },
  };
}
