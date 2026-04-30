"use client";

import * as React from "react";
import Link from "next/link";
import { Car, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { initStore, listInspections } from "@/lib/inspections-store";
import type { StoredInspection, VehicleInfo } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type VehicleRow = {
  plate: string;
  vehicle: VehicleInfo;
  count: number;
  lastInspection: StoredInspection;
};

function aggregate(items: StoredInspection[]): VehicleRow[] {
  const map = new Map<string, VehicleRow>();
  for (const it of items) {
    const v = it.data.vehicle;
    const key = (v.plate || v.vin || "").trim().toUpperCase();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        plate: v.plate || v.vin || key,
        vehicle: v,
        count: 1,
        lastInspection: it,
      });
    } else {
      existing.count += 1;
      if (it.updatedAt > existing.lastInspection.updatedAt) {
        existing.vehicle = v;
        existing.lastInspection = it;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.lastInspection.updatedAt < b.lastInspection.updatedAt ? 1 : -1,
  );
}

export function VehiculosClient() {
  const [rows, setRows] = React.useState<VehicleRow[] | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await initStore();
      if (cancelled) return;
      setRows(aggregate(listInspections()));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = React.useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const v = r.vehicle;
      return (
        v.plate?.toLowerCase().includes(q) ||
        v.make?.toLowerCase().includes(q) ||
        v.model?.toLowerCase().includes(q) ||
        v.vin?.toLowerCase().includes(q)
      );
    });
  }, [rows, query]);

  if (!rows) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando vehículos...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Vehículos
        </h1>
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "Aún no hay vehículos registrados."
            : `${rows.length} vehículo${rows.length === 1 ? "" : "s"} en histórico.`}
        </p>
      </div>

      {rows.length > 0 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por placa, marca, modelo o VIN..."
            className="pl-9"
          />
        </div>
      ) : null}

      {!filtered || filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-muted p-4 text-muted-foreground">
              <Car className="h-6 w-6" />
            </div>
            <div className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "Crea tu primer peritaje para que aparezcan vehículos."
                : "No hay coincidencias para tu búsqueda."}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((row) => (
                <Link
                  key={row.plate}
                  href={`/inspection/${row.lastInspection.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Car className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {row.plate}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.vehicle.make && row.vehicle.model
                          ? `${row.vehicle.make} ${row.vehicle.model}${row.vehicle.year ? ` · ${row.vehicle.year}` : ""}`
                          : "Datos incompletos"}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-right text-xs">
                    <span className="font-medium">
                      {row.count} peritaje{row.count === 1 ? "" : "s"}
                    </span>
                    <span className="text-muted-foreground">
                      Último: {formatDate(row.lastInspection.updatedAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
