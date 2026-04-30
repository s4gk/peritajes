"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { listKnownVehicles } from "@/lib/inspections-store";
import type { VehicleInfo } from "@/lib/types";
import { useInspection } from "../inspection-context";

const FUEL_OPTIONS: { value: VehicleInfo["fuel"]; label: string }[] = [
  { value: "gasoline", label: "Gasolina" },
  { value: "diesel", label: "Diésel" },
  { value: "hybrid", label: "Híbrido" },
  { value: "electric", label: "Eléctrico" },
  { value: "gas", label: "GNV" },
];

const TX_OPTIONS: { value: VehicleInfo["transmission"]; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automática" },
  { value: "cvt", label: "CVT" },
  { value: "dct", label: "DCT" },
];

const BODY_TYPES = ["Sedán", "Hatchback", "SUV", "Pickup", "Van", "Coupé", "Convertible"];

export function VehicleInfoStep() {
  const { id: currentId, data, setData } = useInspection();
  const v = data.vehicle;
  const toast = useToast();
  const [known, setKnown] = React.useState<VehicleInfo[]>([]);
  const [plateFocused, setPlateFocused] = React.useState(false);
  const [runtLoading, setRuntLoading] = React.useState(false);

  React.useEffect(() => {
    setKnown(listKnownVehicles().filter((x) => x.plate));
  }, [currentId]);

  const plateQuery = v.plate.trim().toUpperCase();
  const suggestions = React.useMemo(() => {
    if (!plateQuery) return [];
    return known
      .filter((k) => k.plate && k.plate.toUpperCase().includes(plateQuery))
      .filter((k) => k.plate.toUpperCase() !== plateQuery)
      .slice(0, 5);
  }, [known, plateQuery]);

  function update<K extends keyof VehicleInfo>(key: K, value: VehicleInfo[K]) {
    setData((prev) => ({ ...prev, vehicle: { ...prev.vehicle, [key]: value } }));
  }

  async function lookupPlate() {
    const plate = v.plate.trim().toUpperCase();
    if (!plate) {
      toast.show({
        title: "Ingrese una placa",
        description: "Escriba la placa antes de consultar.",
        variant: "warning",
      });
      return;
    }
    setRuntLoading(true);
    try {
      const res = await fetch(`/api/plate-lookup?plate=${encodeURIComponent(plate)}`);
      if (res.status === 501) {
        toast.show({
          title: "Consulta externa no configurada",
          description:
            "Define PLATE_LOOKUP_URL en el servidor para habilitar RUNT u otro proveedor.",
          variant: "warning",
        });
        return;
      }
      if (!res.ok) {
        toast.show({
          title: "No se pudo consultar la placa",
          description: `El proveedor respondió con error (${res.status}).`,
          variant: "danger",
        });
        return;
      }
      const body = (await res.json()) as {
        result?: Partial<VehicleInfo>;
      };
      const r = body.result ?? {};
      if (!r.make && !r.model && !r.vin && !r.year) {
        toast.show({
          title: "Sin resultados",
          description: "El proveedor no devolvió datos para esa placa.",
          variant: "default",
        });
        return;
      }
      setData((prev) => ({
        ...prev,
        vehicle: {
          ...prev.vehicle,
          vin: r.vin || prev.vehicle.vin,
          make: r.make || prev.vehicle.make,
          model: r.model || prev.vehicle.model,
          year: r.year || prev.vehicle.year,
          color: r.color || prev.vehicle.color,
          fuel: (r.fuel as VehicleInfo["fuel"]) || prev.vehicle.fuel,
          bodyType: r.bodyType || prev.vehicle.bodyType,
          owner: r.owner || prev.vehicle.owner,
        },
      }));
      toast.show({
        title: "Datos importados",
        description: "Revisa kilometraje y fecha antes de continuar.",
        variant: "success",
      });
    } catch {
      toast.show({
        title: "Sin conexión al proveedor",
        description: "Verifica tu red e inténtalo de nuevo.",
        variant: "danger",
      });
    } finally {
      setRuntLoading(false);
    }
  }

  function prefillFrom(source: VehicleInfo) {
    setData((prev) => ({
      ...prev,
      vehicle: {
        ...prev.vehicle,
        plate: source.plate,
        vin: source.vin || prev.vehicle.vin,
        make: source.make || prev.vehicle.make,
        model: source.model || prev.vehicle.model,
        year: source.year || prev.vehicle.year,
        color: source.color || prev.vehicle.color,
        fuel: source.fuel || prev.vehicle.fuel,
        transmission: source.transmission || prev.vehicle.transmission,
        bodyType: source.bodyType || prev.vehicle.bodyType,
        owner: source.owner || prev.vehicle.owner,
      },
    }));
    setPlateFocused(false);
    toast.show({
      title: "Datos del vehículo autocompletados",
      description: "Revisa kilometraje y fecha — esos siempre cambian.",
      variant: "success",
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Datos del vehículo</CardTitle>
          <CardDescription>
            Información de identificación del vehículo inspeccionado.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="plate">Placa *</Label>
            <div className="relative flex gap-2">
              <Input
                id="plate"
                value={v.plate}
                onChange={(e) => update("plate", e.target.value.toUpperCase())}
                onFocus={() => setPlateFocused(true)}
                onBlur={() => {
                  // Delay so clicks on suggestions register first
                  window.setTimeout(() => setPlateFocused(false), 150);
                }}
                placeholder="ABC123"
                autoComplete="off"
                className="h-11 flex-1 text-base font-semibold tracking-wider sm:h-10 sm:text-sm"
              />
              {data.verifik ? (
                <span
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-3 text-xs font-medium text-success sm:h-10"
                  title={`Consultado el ${new Date(data.verifik.queriedAt).toLocaleString("es-CO")} · datos cacheados (no se vuelve a llamar Verifik)`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Consultado</span>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={lookupPlate}
                  disabled={runtLoading || !v.plate.trim()}
                  className="h-11 shrink-0 px-3 sm:h-10"
                  aria-label="Consultar FASECOLDA"
                  title="Consultar FASECOLDA por placa (no consulta RUNT — para eso usa la pantalla de inicio)"
                >
                  {runtLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  <span className="ml-1.5 hidden sm:inline">Consultar</span>
                </Button>
              )}
              {plateFocused && suggestions.length > 0 && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Peritajes previos
                  </div>
                  {suggestions.map((s, i) => (
                    <button
                      key={`${s.plate}-${i}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => prefillFrom(s)}
                      className="flex w-full items-center gap-3 border-t px-3 py-2 text-left hover:bg-accent"
                    >
                      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{s.plate}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[s.make, s.model, s.year].filter(Boolean).join(" · ") ||
                            "Datos incompletos"}
                        </div>
                      </div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-primary">
                        Rellenar
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!plateFocused && known.length > 0 && !plateQuery && (
              <p className="text-[11px] text-muted-foreground">
                Tip: al escribir la placa te sugerimos peritajes previos para autocompletar.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vin">VIN / Chasis</Label>
            <Input
              id="vin"
              value={v.vin}
              onChange={(e) => update("vin", e.target.value.toUpperCase())}
              placeholder="17 caracteres"
              maxLength={17}
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="make">Marca *</Label>
            <Input
              id="make"
              value={v.make}
              onChange={(e) => update("make", e.target.value)}
              placeholder="Toyota"
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model">Modelo *</Label>
            <Input
              id="model"
              value={v.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="Corolla"
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="year">Año *</Label>
            <Input
              id="year"
              inputMode="numeric"
              value={v.year}
              onChange={(e) => update("year", e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="2020"
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              value={v.color}
              onChange={(e) => update("color", e.target.value)}
              placeholder="Blanco"
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mileage">Kilometraje *</Label>
            <Input
              id="mileage"
              inputMode="numeric"
              value={v.mileage}
              onChange={(e) => update("mileage", e.target.value.replace(/\D/g, ""))}
              placeholder="85000"
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Combustible</Label>
            <Select
              value={v.fuel || undefined}
              onValueChange={(val) => update("fuel", val as VehicleInfo["fuel"])}
            >
              <SelectTrigger className="h-11 sm:h-10">
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {FUEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Transmisión</Label>
            <Select
              value={v.transmission || undefined}
              onValueChange={(val) => update("transmission", val as VehicleInfo["transmission"])}
            >
              <SelectTrigger className="h-11 sm:h-10">
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {TX_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de carrocería</Label>
            <Select
              value={v.bodyType || undefined}
              onValueChange={(val) => update("bodyType", val)}
            >
              <SelectTrigger className="h-11 sm:h-10">
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {BODY_TYPES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner">Propietario</Label>
            <Input
              id="owner"
              value={v.owner}
              onChange={(e) => update("owner", e.target.value)}
              placeholder="Nombre del titular"
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Lugar de inspección</Label>
            <Input
              id="location"
              value={v.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Ciudad / dirección"
              className="h-11 sm:h-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Perito inspector</CardTitle>
          <CardDescription>
            Datos del técnico responsable de la inspección.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="inspector">Nombre del perito *</Label>
            <Input
              id="inspector"
              value={v.inspector}
              onChange={(e) => update("inspector", e.target.value)}
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inspectorId">Documento / licencia</Label>
            <Input
              id="inspectorId"
              value={v.inspectorId}
              onChange={(e) => update("inspectorId", e.target.value)}
              className="h-11 sm:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Fecha *</Label>
            <Input
              id="date"
              type="date"
              value={v.date}
              onChange={(e) => update("date", e.target.value)}
              className="h-11 sm:h-10"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
