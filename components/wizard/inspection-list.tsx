"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Car,
  Copy,
  FileText,
  Plus,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createInspection,
  deleteInspection,
  duplicateInspection,
  initStore,
  listInspections,
} from "@/lib/inspections-store";
import { analyze, riskTone } from "@/lib/rules-engine";
import type { StoredInspection } from "@/lib/types";
import { formatDate } from "@/lib/utils";

import { BackupControls } from "./backup-controls";
import { ThemeToggle } from "./theme-toggle";
import { UIPreferencesProvider } from "./ui-preferences";

function InspectionsInner() {
  const router = useRouter();
  const [items, setItems] = React.useState<StoredInspection[]>([]);
  const [hydrated, setHydrated] = React.useState(false);

  const refresh = React.useCallback(() => {
    setItems(listInspections());
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await initStore();
      if (cancelled) return;
      refresh();
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  function handleNew() {
    const created = createInspection();
    router.push(`/inspection/${created.id}`);
  }

  function handleDuplicate(id: string) {
    const copy = duplicateInspection(id);
    if (copy) router.push(`/inspection/${copy.id}`);
  }

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta inspección? Esta acción no se puede deshacer.")) return;
    deleteInspection(id);
    refresh();
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando inspecciones...
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20 sm:space-y-6 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Peritajes</h1>
          <p className="text-sm text-muted-foreground">
            {items.length === 0
              ? "Aún no has creado ningún peritaje."
              : `${items.length} peritaje${items.length === 1 ? "" : "s"} registrado${items.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:self-auto">
          <BackupControls onChange={refresh} />
          <ThemeToggle />
          <Button onClick={handleNew} size="lg" className="hidden h-10 sm:inline-flex">
            <Plus className="mr-1 h-4 w-4" /> Nuevo peritaje
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-full bg-muted p-4">
              <Car className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <div className="text-base font-medium">Aún no hay peritajes</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Inicia tu primera inspección para comenzar.
              </div>
            </div>
            <Button onClick={handleNew}>
              <Plus className="mr-1 h-4 w-4" /> Nuevo peritaje
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <InspectionCard
              key={item.id}
              item={item}
              onOpen={() => router.push(`/inspection/${item.id}`)}
              onDuplicate={() => handleDuplicate(item.id)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      )}

      {/* Mobile FAB — always visible on small screens so "Nuevo peritaje" is one tap away */}
      <button
        type="button"
        onClick={handleNew}
        aria-label="Nuevo peritaje"
        className="fixed right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition-transform active:scale-95 sm:hidden"
        style={{ bottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}
      >
        <Plus className="h-5 w-5" />
        Nuevo peritaje
      </button>
    </div>
  );
}

function InspectionCard({
  item,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  item: StoredInspection;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const report = React.useMemo(() => analyze(item.data), [item.data]);
  const v = item.data.vehicle;
  const tone = riskTone(report.level);
  const hasPlate = !!v.plate;

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onOpen}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              {hasPlate ? v.plate : <span className="text-muted-foreground">Sin placa</span>}
            </CardTitle>
            <CardDescription className="truncate">
              {v.make && v.model
                ? `${v.make} ${v.model}${v.year ? ` · ${v.year}` : ""}`
                : "Datos incompletos"}
            </CardDescription>
          </div>
          <Badge variant={tone} className="shrink-0 text-[10px]">
            {report.level === "low" ? "Bajo" : report.level === "medium" ? "Medio" : "Alto"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Fecha
            </div>
            <div className="font-medium">{formatDate(v.date)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Kilometraje
            </div>
            <div className="font-medium">{v.mileage ? `${v.mileage} km` : "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Perito
            </div>
            <div className="truncate font-medium">{v.inspector || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Hallazgos
            </div>
            <div className="font-medium">{report.findings.length}</div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="h-10 gap-1.5 px-3 text-sm"
          >
            <FileText className="h-4 w-4" /> Abrir
          </Button>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              aria-label="Duplicar peritaje"
              title="Duplicar"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Eliminar peritaje"
              title="Eliminar"
            >
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function InspectionList() {
  return (
    <UIPreferencesProvider>
      <InspectionsInner />
    </UIPreferencesProvider>
  );
}
