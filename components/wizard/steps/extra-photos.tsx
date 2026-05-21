"use client";

import * as React from "react";
import { Camera, ImagePlus } from "lucide-react";

import { ImageUpload } from "@/components/shared/image-upload";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { InspectedImage, InspectionData } from "@/lib/types";

import { useInspection } from "../inspection-context";

type MandatorySlot = {
  key: keyof InspectionData["mandatoryPhotos"];
  label: string;
  hint: string;
};

const MANDATORY_SLOTS: MandatorySlot[] = [
  {
    key: "diagonalFrontLeft",
    label: "Diagonal Delantera Izquierda",
    hint: "Vista a 45° del frente y costado izquierdo del vehículo.",
  },
  {
    key: "diagonalRearRight",
    label: "Diagonal Trasera Derecha",
    hint: "Vista a 45° de la parte trasera y costado derecho.",
  },
  {
    key: "innerCabin",
    label: "Habitáculo Interno",
    hint: "Vista general del interior (tablero, asientos delanteros).",
  },
  {
    key: "chassisNumber",
    label: "Número de Chasis",
    hint: "Foto nítida del número estampado en el chasis.",
  },
  {
    key: "engineNumber",
    label: "Número de Motor",
    hint: "Foto nítida del número estampado en el bloque del motor.",
  },
  {
    key: "idPlate",
    label: "Número de Plaqueta",
    hint: "Foto de la plaqueta de identificación del vehículo.",
  },
];

export function ExtraPhotosStep() {
  const { data, setData } = useInspection();
  const photos = data.extraPhotos ?? [];

  const setPhotos = React.useCallback(
    (next: InspectedImage[]) => {
      setData((prev) => ({ ...prev, extraPhotos: next }));
    },
    [setData],
  );

  const setMandatory = React.useCallback(
    (key: keyof InspectionData["mandatoryPhotos"], next: InspectedImage[]) => {
      setData((prev) => ({
        ...prev,
        mandatoryPhotos: { ...prev.mandatoryPhotos, [key]: next },
      }));
    },
    [setData],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-md bg-primary/10 p-2 text-primary">
              <Camera className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>Fotografías obligatorias</CardTitle>
              <CardDescription>
                Estas seis tomas son requeridas para cerrar el peritaje. Cada
                slot debe tener al menos una foto antes de avanzar al resumen.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {MANDATORY_SLOTS.map((slot) => {
            const list = data.mandatoryPhotos?.[slot.key] ?? [];
            return (
              <div key={slot.key} className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-2">
                  <div className="text-sm font-medium">
                    {slot.label}
                    <span className="ml-1 text-danger">*</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{slot.hint}</p>
                </div>
                <ImageUpload
                  images={list}
                  onChange={(next) => setMandatory(slot.key, next)}
                  required
                  label={`${list.length} foto${list.length === 1 ? "" : "s"}`}
                  compact
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-md bg-primary/10 p-2 text-primary">
              <ImagePlus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>Fotografías adicionales</CardTitle>
              <CardDescription>
                Subí acá cualquier foto extra que no pertenezca a un ítem específico —
                detalles del compartimento, anexos, capturas de pantalla, comprobantes,
                vistas panorámicas. Es opcional y aparecerá en la sección de evidencia
                del PDF.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ImageUpload
            images={photos}
            onChange={setPhotos}
            label={`${photos.length} foto${photos.length === 1 ? "" : "s"} adjunta${photos.length === 1 ? "" : "s"}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
