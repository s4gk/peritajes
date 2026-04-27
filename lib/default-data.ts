import { ALL_SECTIONS } from "./constants";
import { defaultOkValueFor } from "./findings-catalog";
import type { InspectionData, InspectionEntry } from "./types";

/**
 * DEMO MODE
 * ---------
 * `emptyInspection()` pre-rellena todos los campos con datos de prueba para que
 * el perito pueda recorrer el wizard rápido mientras revisa la app.
 *
 * Para volver a un peritaje vacío en producción, pon DEMO_MODE = false y se
 * usarán los defaults en blanco.
 */
const DEMO_MODE = true;

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
      vehicle: {
        plate: "",
        vin: "",
        make: "",
        model: "",
        year: "",
        color: "",
        mileage: "",
        fuel: "",
        transmission: "",
        bodyType: "",
        owner: "",
        inspector: "",
        inspectorId: "",
        location: "",
        date: new Date().toISOString().slice(0, 10),
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
      electrical: emptySection("electrical"),
      leaks: emptySection("leaks"),
      comfort: emptySection("comfort"),
      roadTest: emptySection("roadTest"),
      accessories: [],
      confirmedSteps: [],
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
    vehicle: {
      plate: "DEMO123",
      vin: "1HGBH41JXMN109186",
      make: "Toyota",
      model: "Corolla Cross",
      year: "2023",
      color: "Blanco Perla",
      mileage: "28500",
      fuel: "gasoline",
      transmission: "automatic",
      bodyType: "SUV",
      owner: "Laura Restrepo Gómez",
      inspector: "Carlos Mendoza",
      inspectorId: "PI-20451",
      location: "Bogotá · Carrera 15 #93-47",
      date: new Date().toISOString().slice(0, 10),
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
    electrical: demoSection("electrical"),
    leaks: demoSection("leaks"),
    comfort: demoSection("comfort"),
    roadTest: demoSection("roadTest"),
    accessories: [
      { id: "a-tapetes", name: "Tapetes", status: "mech_optimal", notes: "" },
      { id: "a-llave-extra", name: "Llave extra", status: "mech_optimal", notes: "" },
      { id: "a-manual", name: "Manual del propietario", status: "mech_optimal", notes: "" },
      { id: "a-gato", name: "Gato", status: "mech_optimal", notes: "" },
      { id: "a-cruceta", name: "Cruceta", status: "mech_optimal", notes: "" },
      { id: "a-triangulos", name: "Triángulos de seguridad", status: "mech_optimal", notes: "" },
      { id: "a-botiquin", name: "Botiquín", status: "mech_optimal", notes: "" },
      { id: "a-extintor", name: "Extintor", status: "mech_optimal", notes: "Vigente 2026" },
      { id: "a-camara", name: "Cámara de reversa", status: "mech_optimal", notes: "" },
    ],
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
