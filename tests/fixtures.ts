import { ALL_SECTIONS, FALLBACK_VEHICLE_TYPE } from "@/lib/constants";
import { defaultOkValueFor } from "@/lib/findings-catalog";
import type { InspectionData, InspectionEntry } from "@/lib/types";

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
    kind: "complete",
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

export function setBodywork(data: InspectionData, itemId: string, status: string): InspectionData {
  data.bodywork[itemId] = { status, notes: "", images: [] };
  return data;
}

export function setChassis(data: InspectionData, itemId: string, status: string): InspectionData {
  data.chassis[itemId] = { status, notes: "", images: [] };
  return data;
}

export function setLeak(data: InspectionData, itemId: string, status: string): InspectionData {
  data.leaks[itemId] = { status, notes: "", images: [] };
  return data;
}

export function setRoadTest(data: InspectionData, itemId: string, status: string): InspectionData {
  data.roadTest[itemId] = { status, notes: "", images: [] };
  return data;
}

export function setEngine(data: InspectionData, itemId: string, status: string): InspectionData {
  data.engine[itemId] = { status, notes: "", images: [] };
  return data;
}
