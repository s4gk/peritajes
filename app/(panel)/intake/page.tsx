"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Gauge,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PERITAJE_KINDS,
  VEHICLE_TYPE_ORDER,
  VEHICLE_TYPES,
} from "@/lib/constants";
import { createInspection, initStore } from "@/lib/inspections-store";
import { cn } from "@/lib/utils";
import type { PeritajeKind, VehicleType } from "@/lib/types";

const KIND_ICONS: Record<PeritajeKind, React.ComponentType<{ className?: string }>> = {
  complete: ClipboardList,
  quick: Gauge,
  appraisal: DollarSign,
};

const KIND_ORDER: PeritajeKind[] = ["complete", "quick", "appraisal"];

export default function IntakePage() {
  const router = useRouter();
  const [vehicleType, setVehicleType] = React.useState<VehicleType | null>(null);
  const [kind, setKind] = React.useState<PeritajeKind | null>(null);

  React.useEffect(() => {
    void initStore();
  }, []);

  function startInspection() {
    if (!vehicleType || !kind) return;
    const created = createInspection({ kind, vehicleType });
    router.push(`/inspection/${created.id}`);
  }

  const canStart = !!vehicleType && !!kind;

  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="mb-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/peritajes")}
            className="h-9 px-2 text-muted-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Volver
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Nuevo peritaje</CardTitle>
            <CardDescription>
              Elegí el tipo de vehículo a inspeccionar y el tipo de peritaje. Cada
              combinación define el inventario de carrocería y los pasos del
              wizard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  1
                </span>
                <h3 className="text-base font-semibold">Tipo de vehículo</h3>
              </div>
              <Select
                value={vehicleType ?? undefined}
                onValueChange={(v) => setVehicleType(v as VehicleType)}
              >
                <SelectTrigger className="h-11 w-full sm:max-w-md">
                  <SelectValue placeholder="Elegí el tipo de vehículo…" />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPE_ORDER.map((vt) => (
                    <SelectItem key={vt} value={vt}>
                      {VEHICLE_TYPES[vt].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {vehicleType && (
                <p className="text-xs leading-snug text-muted-foreground sm:max-w-md">
                  {VEHICLE_TYPES[vehicleType].description}
                </p>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  2
                </span>
                <h3 className="text-base font-semibold">Tipo de peritaje</h3>
                {kind && (
                  <span className="text-xs text-muted-foreground">
                    · {PERITAJE_KINDS[kind].label}
                  </span>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {KIND_ORDER.map((k) => {
                  const def = PERITAJE_KINDS[k];
                  const Icon = KIND_ICONS[k];
                  const selected = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      aria-pressed={selected}
                      className={cn(
                        "group relative flex flex-col gap-3 rounded-xl border-2 p-5 text-left transition-all",
                        selected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-card hover:border-primary/40 hover:bg-muted/30",
                      )}
                    >
                      {selected && (
                        <span className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <CheckCircle2 className="h-4 w-4" />
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex h-10 w-10 items-center justify-center rounded-lg",
                          selected
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="space-y-1">
                        <div className="text-base font-semibold leading-tight">
                          {def.label}
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {def.description}
                        </p>
                      </div>
                      <div className="mt-auto flex items-center gap-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <span
                          className={cn(
                            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted",
                          )}
                        >
                          {def.sections.length}
                        </span>
                        secciones
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {canStart
                  ? "Listo. Después de iniciar llenás los datos del vehículo dentro del peritaje."
                  : "Elegí tipo de vehículo y tipo de peritaje para continuar."}
              </p>
              <Button
                type="button"
                onClick={startInspection}
                size="lg"
                className="h-11"
                disabled={!canStart}
              >
                Iniciar peritaje
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
