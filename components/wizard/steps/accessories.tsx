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
import { Textarea } from "@/components/ui/textarea";
import type { AccessoryEntry } from "@/lib/types";
import { makeId } from "@/lib/utils";
import { formatCop } from "@/lib/scoring";

import { useInspection } from "../inspection-context";

/** Suma de los valores (COP) de los accesorios con monto válido. */
function accessoriesTotal(list: AccessoryEntry[]): number {
  return list.reduce((sum, a) => {
    const n = Number(a.value);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

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
  const { data, setData, isReadOnly } = useInspection();

  function setAccessories(list: AccessoryEntry[]) {
    setData((prev) => ({ ...prev, accessories: list }));
  }

  function update(id: string, patch: Partial<AccessoryEntry>) {
    setAccessories(data.accessories.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function remove(id: string) {
    setAccessories(data.accessories.filter((a) => a.id !== id));
  }

  function addCustom(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (data.accessories.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) return;
    setAccessories([
      ...data.accessories,
      { id: makeId(), name: trimmed, notes: "" },
    ]);
  }

  function addPreset(name: string) {
    if (data.accessories.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
    setAccessories([
      ...data.accessories,
      { id: makeId(), name, notes: "" },
    ]);
  }

  const total = data.accessories.length;
  const totalValue = accessoriesTotal(data.accessories);
  const missingPresets = PRESETS.filter(
    (p) => !data.accessories.some((a) => a.name.toLowerCase() === p.toLowerCase()),
  );

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle>Accesorios</CardTitle>
            <CardDescription>
              Listá los accesorios que vienen con el vehículo. Solo registramos su
              presencia — agregalos uno a uno con los botones de abajo.
            </CardDescription>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Total
            </div>
            <div className="text-lg font-semibold tabular-nums">{total}</div>
            {totalValue > 0 && (
              <div className="text-xs font-medium tabular-nums text-muted-foreground">
                {formatCop(totalValue)}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-3 sm:px-6">
        <div className="space-y-2">
          {data.accessories.map((a) => (
            <AccessoryRow
              key={a.id}
              entry={a}
              disabled={isReadOnly}
              onChange={(patch) => update(a.id, patch)}
              onRemove={() => remove(a.id)}
            />
          ))}
          {data.accessories.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Sin accesorios. Agrega usando los botones de abajo.
            </div>
          )}
        </div>

        {!isReadOnly && missingPresets.length > 0 && (
          <div>
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Agregar rápido
            </div>
            <div className="flex flex-wrap gap-1.5">
              {missingPresets.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addPreset(p)}
                  className="h-9"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {p}
                </Button>
              ))}
            </div>
          </div>
        )}

        {!isReadOnly && <CustomAdder onAdd={addCustom} />}
      </CardContent>
    </Card>
  );
}

function AccessoryRow({
  entry,
  disabled,
  onChange,
  onRemove,
}: {
  entry: AccessoryEntry;
  disabled?: boolean;
  onChange: (patch: Partial<AccessoryEntry>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = React.useState(false);

  if (!editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium sm:text-[15px]">
            {entry.name}
          </div>
          {entry.notes && (
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {entry.notes}
            </div>
          )}
        </div>
        {entry.value && Number(entry.value) > 0 && (
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatCop(Number(entry.value))}
          </span>
        )}
        {!disabled && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              className="h-9"
            >
              Editar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label="Eliminar"
              className="h-9 w-9"
            >
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2">
        <Input
          value={entry.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Nombre del accesorio"
          className="h-10 flex-1"
          autoFocus
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Eliminar"
          className="h-10 w-10 shrink-0"
        >
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Input
          inputMode="numeric"
          value={entry.value ?? ""}
          onChange={(e) => onChange({ value: e.target.value.replace(/\D/g, "") })}
          placeholder="Valor estimado (COP)"
          className="h-10"
        />
        {entry.value && Number(entry.value) > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {formatCop(Number(entry.value))}
          </p>
        )}
      </div>
      <Textarea
        value={entry.notes ?? ""}
        onChange={(e) => onChange({ notes: e.target.value })}
        rows={2}
        placeholder="Notas (opcional)"
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setEditing(false)}>
          Listo
        </Button>
      </div>
    </div>
  );
}

function CustomAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setOpen(false);
      return;
    }
    onAdd(trimmed);
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto"
      >
        <Plus className="mr-1 h-4 w-4" />
        Agregar accesorio personalizado
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setOpen(false);
            setName("");
          }
        }}
        placeholder="Nombre del accesorio"
        className="h-10 flex-1"
      />
      <Button type="button" onClick={commit}>
        Agregar
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setName("");
        }}
      >
        Cancelar
      </Button>
    </div>
  );
}
