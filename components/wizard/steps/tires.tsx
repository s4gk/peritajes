"use client";

import * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUpload } from "@/components/shared/image-upload";
import { VoiceDictationButton } from "@/components/shared/voice-dictation-button";
import { cn } from "@/lib/utils";
import type { InspectedImage } from "@/lib/types";
import { useInspection } from "../inspection-context";

type TireKey = "frontLeft" | "frontRight" | "rearLeft" | "rearRight" | "spare";

const TIRE_LABELS: Record<TireKey, string> = {
  frontLeft: "Delantera izquierda",
  frontRight: "Delantera derecha",
  rearLeft: "Trasera izquierda",
  rearRight: "Trasera derecha",
  spare: "Repuesto",
};

function toneFor(pct: number): string {
  if (pct <= 25) return "text-danger";
  if (pct <= 50) return "text-warning";
  return "text-success";
}

function TireField({
  keyName,
  value,
  onChange,
}: {
  keyName: TireKey;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{TIRE_LABELS[keyName]}</Label>
        <span className={cn("text-2xl font-bold tabular-nums", toneFor(value))}>
          {value}%
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-8 w-full accent-primary touch-none"
      />

      <div className="mt-2 flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isNaN(n)) return;
            onChange(Math.max(0, Math.min(100, n)));
          }}
          className="h-8 w-20 text-right"
        />
        <span className="text-xs text-muted-foreground">% de banda de rodadura</span>
      </div>
    </div>
  );
}

export function TiresStep() {
  const { data, setData } = useInspection();
  const t = data.tires;

  function updateTire(key: TireKey, value: number) {
    setData((prev) => ({ ...prev, tires: { ...prev.tires, [key]: value } }));
  }

  function setImages(images: InspectedImage[]) {
    setData((prev) => ({ ...prev, tires: { ...prev.tires, images } }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Llantas</CardTitle>
        <CardDescription>
          Estado de la banda de rodadura por neumático. Use porcentaje (0–100).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <TireField keyName="frontLeft" value={t.frontLeft} onChange={(v) => updateTire("frontLeft", v)} />
          <TireField keyName="frontRight" value={t.frontRight} onChange={(v) => updateTire("frontRight", v)} />
          <TireField keyName="rearLeft" value={t.rearLeft} onChange={(v) => updateTire("rearLeft", v)} />
          <TireField keyName="rearRight" value={t.rearRight} onChange={(v) => updateTire("rearRight", v)} />
        </div>

        <TireField keyName="spare" value={t.spare} onChange={(v) => updateTire("spare", v)} />

        <div className="space-y-2">
          <Label>Observaciones</Label>
          <div className="relative">
            <Textarea
              placeholder="Marca, medida, desgaste irregular, fechas de fabricación, etc."
              value={t.notes ?? ""}
              onChange={(e) =>
                setData((prev) => ({
                  ...prev,
                  tires: { ...prev.tires, notes: e.target.value },
                }))
              }
              className="pr-11"
            />
            <div className="absolute right-1.5 top-1.5">
              <VoiceDictationButton
                onTranscript={(text) =>
                  setData((prev) => {
                    const existing = prev.tires.notes ?? "";
                    const sep =
                      existing && !existing.endsWith(" ") && !existing.endsWith("\n")
                        ? " "
                        : "";
                    return {
                      ...prev,
                      tires: {
                        ...prev.tires,
                        notes: `${existing}${sep}${text}`.trim(),
                      },
                    };
                  })
                }
              />
            </div>
          </div>
        </div>

        <ImageUpload images={t.images} onChange={setImages} label="Fotos de llantas" />
      </CardContent>
    </Card>
  );
}
