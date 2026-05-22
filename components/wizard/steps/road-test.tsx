"use client";

import * as React from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROAD_TEST_SECTION } from "@/lib/constants";
import { cn } from "@/lib/utils";

import { useInspection } from "../inspection-context";
import { SectionStep } from "./section-step";

export function RoadTestStep() {
  const { data, setData, isReadOnly } = useInspection();
  const skipped = data.roadTestSkipped === true;

  function setSkipped(value: boolean) {
    setData((prev) => ({ ...prev, roadTestSkipped: value }));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Aplica prueba de ruta?</CardTitle>
          <CardDescription>
            Indica si vas a hacer recorrido con el vehículo. Si no aplica (no enciende,
            cliente no autoriza, sólo avalúo estático…) puedes saltarte la etapa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceButton
              active={!skipped}
              disabled={isReadOnly}
              onClick={() => setSkipped(false)}
              icon={CheckCircle2}
              tone="default"
              title="Sí aplica"
              hint="Evaluá frenado, dirección, suspensión y motor en marcha."
            />
            <ChoiceButton
              active={skipped}
              disabled={isReadOnly}
              onClick={() => setSkipped(true)}
              icon={XCircle}
              tone="muted"
              title="No aplica"
              hint="Se omite del informe y de los hallazgos."
            />
          </div>
          {skipped && (
            <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                La etapa quedará marcada como <span className="font-medium text-foreground">No aplica</span> en el PDF
                y en las métricas. Puedes cambiar de opinión en cualquier momento — los datos no se borran.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {!skipped && (
        <SectionStep
          section={ROAD_TEST_SECTION}
          title="Prueba de ruta"
          description="Desempeño real del vehículo en recorrido."
        />
      )}
    </div>
  );
}

function ChoiceButton({
  active,
  disabled,
  onClick,
  icon: Icon,
  tone,
  title,
  hint,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  tone: "default" | "muted";
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-muted/50",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          active
            ? "text-primary"
            : tone === "muted"
              ? "text-muted-foreground"
              : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </button>
  );
}
