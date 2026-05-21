import type { InspectionData } from "./types";

/** Slots obligatorios del peritaje: 2 tarjeta de propiedad + 6 vistas
 *  estándar capturadas en el paso "Fotografías". Total = 8. La validación
 *  del resumen exige que cada uno tenga al menos una foto, no que el total
 *  de fotos del peritaje llegue a 8 (el perito puede tenerlas concentradas
 *  todas en ítems del recorrido y aun así no haber cargado las obligatorias). */
export const MIN_REQUIRED_PHOTOS = 8;

type MandatorySlot = {
  label: string;
  get: (data: InspectionData) => number;
};

const MANDATORY_SLOTS: MandatorySlot[] = [
  {
    label: "Tarjeta de propiedad — frente",
    get: (d) => d.documents?.ownershipCardFront?.length ?? 0,
  },
  {
    label: "Tarjeta de propiedad — reverso",
    get: (d) => d.documents?.ownershipCardBack?.length ?? 0,
  },
  {
    label: "Diagonal Delantera Izquierda",
    get: (d) => d.mandatoryPhotos?.diagonalFrontLeft?.length ?? 0,
  },
  {
    label: "Diagonal Trasera Derecha",
    get: (d) => d.mandatoryPhotos?.diagonalRearRight?.length ?? 0,
  },
  {
    label: "Habitáculo Interno",
    get: (d) => d.mandatoryPhotos?.innerCabin?.length ?? 0,
  },
  {
    label: "Número de Chasis",
    get: (d) => d.mandatoryPhotos?.chassisNumber?.length ?? 0,
  },
  {
    label: "Número de Motor",
    get: (d) => d.mandatoryPhotos?.engineNumber?.length ?? 0,
  },
  {
    label: "Número de Plaqueta",
    get: (d) => d.mandatoryPhotos?.idPlate?.length ?? 0,
  },
];

/** Cuántos de los 8 slots obligatorios tienen al menos una foto. */
export function countMandatorySlotsFilled(data: InspectionData): number {
  let n = 0;
  for (const slot of MANDATORY_SLOTS) {
    if (slot.get(data) > 0) n += 1;
  }
  return n;
}

/** Labels de los slots obligatorios que siguen vacíos (para el mensaje). */
export function missingMandatorySlots(data: InspectionData): string[] {
  return MANDATORY_SLOTS.filter((s) => s.get(data) === 0).map((s) => s.label);
}

