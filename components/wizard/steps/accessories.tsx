"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FindingSelector } from "@/components/shared/finding-selector";
import { FINDING_CATALOGS } from "@/lib/findings-catalog";
import type { AccessoryEntry } from "@/lib/types";
import { makeId } from "@/lib/utils";

import { useInspection } from "../inspection-context";

const PRESETS = [
  "Tapetes",
  "Manual del propietario",
  "Llave extra",
  "Gato",
  "Cruceta",
  "Triángulos de seguridad",
  "Extintor",
  "Botiquín",
  "Chaleco reflectivo",
  "Radio original",
  "Parrilla de techo",
  "Cámara de reversa",
];

export function AccessoriesStep() {
  const { data, setData } = useInspection();

  function setAccessories(list: AccessoryEntry[]) {
    setData((prev) => ({ ...prev, accessories: list }));
  }

  function addEmpty(name = "") {
    setAccessories([
      ...data.accessories,
      { id: makeId(), name, status: "mech_optimal", notes: "" },
    ]);
  }

  function update(id: string, patch: Partial<AccessoryEntry>) {
    setAccessories(data.accessories.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function remove(id: string) {
    setAccessories(data.accessories.filter((a) => a.id !== id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accesorios</CardTitle>
        <CardDescription>
          Accesorios y elementos de equipamiento. Agregue dinámicamente los ítems verificados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
            Agregar rápido
          </Label>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addEmpty(p)}
                disabled={data.accessories.some((a) => a.name === p)}
                className="h-9"
              >
                + {p}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {data.accessories.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border bg-card p-3 sm:p-4"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-[1.2fr_2fr]">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nombre</Label>
                      <Input
                        value={a.name}
                        onChange={(e) => update(a.id, { name: e.target.value })}
                        placeholder="Accesorio"
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notas</Label>
                      <Textarea
                        value={a.notes ?? ""}
                        onChange={(e) => update(a.id, { notes: e.target.value })}
                        rows={1}
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Estado</Label>
                    <div className="mt-1.5">
                      <FindingSelector
                        catalog={FINDING_CATALOGS.mechanical}
                        value={a.status}
                        onChange={(v) => update(a.id, { status: v ?? "mech_optimal" })}
                      />
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(a.id)}
                  aria-label="Eliminar"
                  className="h-10 w-10 shrink-0"
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </div>
            </div>
          ))}
          {data.accessories.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay accesorios registrados. Use los atajos superiores o cree uno nuevo.
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => addEmpty()}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-1 h-4 w-4" />
          Agregar accesorio personalizado
        </Button>
      </CardContent>
    </Card>
  );
}
