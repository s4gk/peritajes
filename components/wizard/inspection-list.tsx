"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Car,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  UserCog,
  X,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FALLBACK_VEHICLE_TYPE, PERITAJE_KINDS, VEHICLE_TYPES } from "@/lib/constants";
import { downloadCsv, inspectionsToCsv } from "@/lib/csv";
import {
  deleteInspection,
  duplicateInspection,
  initStore,
  listInspections,
} from "@/lib/inspections-store";
import { idbListMutations } from "@/lib/client/idb";
import { downloadStoredPdf } from "@/lib/pdf-client";
import { analyze, riskTone } from "@/lib/rules-engine";
import { riskLevelLabel } from "@/lib/scoring";
import type { StoredInspection } from "@/lib/types";
import { formatDate } from "@/lib/utils";

import { useToast } from "@/components/ui/toast";

import { useCanManage, useIsAdmin } from "@/components/panel/current-user";
import { apiFetch } from "@/lib/client/api-client";

import { BackupControls } from "./backup-controls";
import { UIPreferencesProvider } from "./ui-preferences";

type TeamMember = { id: string; fullName: string; active: boolean };

function useTeamMembers(enabled: boolean): TeamMember[] {
  // Hook simple: trae la lista de usuarios del equipo (scope owner-side) una
  // vez al montar el panel y la guarda. Solo se activa para owner/admin —
  // employee no necesita conocer la lista.
  const [members, setMembers] = React.useState<TeamMember[]>([]);
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/users", { credentials: "same-origin" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          users?: Array<{ id: string; fullName: string; active: boolean }>;
        };
        if (!cancelled && Array.isArray(json.users)) {
          setMembers(
            json.users.map((u) => ({
              id: u.id,
              fullName: u.fullName,
              active: u.active,
            })),
          );
        }
      } catch {
        /* sin team list — la UI muestra "Reasignar" sin opciones */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return members;
}

function InspectionsInner() {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const canManage = useCanManage();
  const teamMembers = useTeamMembers(canManage);
  const memberById = React.useMemo(() => {
    const m = new Map<string, TeamMember>();
    for (const t of teamMembers) m.set(t.id, t);
    return m;
  }, [teamMembers]);
  const [items, setItems] = React.useState<StoredInspection[]>([]);
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<StoredInspection | null>(null);
  const [pendingReassign, setPendingReassign] =
    React.useState<StoredInspection | null>(null);
  const [reassignTarget, setReassignTarget] = React.useState<string>("");
  const [reassignBusy, setReassignBusy] = React.useState(false);
  const toastReassign = useToast();

  async function doReassign() {
    if (!pendingReassign || !reassignTarget) return;
    setReassignBusy(true);
    try {
      const res = await apiFetch(
        `/api/inspections/${encodeURIComponent(pendingReassign.id)}/reassign`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newUserId: reassignTarget }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toastReassign.show({
          title: "No se pudo reasignar",
          description:
            (body as { error?: string }).error ??
            `${res.status} ${res.statusText}`,
          variant: "danger",
        });
      } else {
        toastReassign.show({
          title: "Peritaje reasignado",
          variant: "success",
        });
        setPendingReassign(null);
        setReassignTarget("");
        // Recargamos el listado para reflejar el nuevo asignado.
        window.dispatchEvent(new CustomEvent("perito:store-refreshed"));
      }
    } catch (err) {
      toastReassign.show({
        title: "Error de red",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
    } finally {
      setReassignBusy(false);
    }
  }

  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");

  // Debounce de búsqueda: tipear no re-filtra en cada keystroke (200ms).
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  const refresh = React.useCallback(() => {
    setItems(listInspections());
    // Actualiza el set de peritajes con mutations pendientes en IDB.
    idbListMutations().then((mutations) => {
      setPendingIds(new Set(mutations.map((m) => m.inspectionId)));
    }).catch(() => {});
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

  // El initStore() ya no espera al fetch del server (corre en background).
  // Cuando ese fetch trae data nueva, dispara `perito:store-refreshed` y
  // re-leemos el listado para mostrar la versión canónica.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onRefresh = () => refresh();
    window.addEventListener("perito:store-refreshed", onRefresh);
    // Cuando el sync queue sube algo, actualizamos los indicadores pendientes.
    window.addEventListener("perito:sync-flushed", onRefresh);
    return () => {
      window.removeEventListener("perito:store-refreshed", onRefresh);
      window.removeEventListener("perito:sync-flushed", onRefresh);
    };
  }, [refresh]);

  function handleNew() {
    router.push("/intake");
  }

  function handleDuplicate(id: string) {
    const copy = duplicateInspection(id);
    if (copy) router.push(`/inspection/${copy.id}`);
  }

  function requestDelete(item: StoredInspection) {
    setPendingDelete(item);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    deleteInspection(pendingDelete.id);
    setPendingDelete(null);
    refresh();
  }

  // OJO: useMemo va ANTES de cualquier early return — si lo dejamos después
  // del `if (!hydrated) return …`, React tira el error #310 ("Rendered more
  // hooks than during the previous render") porque el conteo de hooks cambia
  // entre el primer render (no hidratado) y el siguiente.
  const filtered = React.useMemo(() => {
    const fromMs = fromDate ? Date.parse(`${fromDate}T00:00:00`) : null;
    const toMs = toDate ? Date.parse(`${toDate}T23:59:59`) : null;
    return items.filter((item) => {
      if (fromMs !== null) {
        const d = item.data.vehicle.date
          ? Date.parse(item.data.vehicle.date)
          : Date.parse(item.createdAt);
        if (Number.isFinite(d) && d < fromMs) return false;
      }
      if (toMs !== null) {
        const d = item.data.vehicle.date
          ? Date.parse(item.data.vehicle.date)
          : Date.parse(item.createdAt);
        if (Number.isFinite(d) && d > toMs) return false;
      }
      if (debouncedQuery) {
        const v = item.data.vehicle;
        const haystack = [
          v.plate,
          v.vin,
          v.chassisNumber,
          v.engineNumber,
          v.owner,
          v.ownerDocument,
          v.make,
          v.model,
          v.inspector,
          item.reportNumber,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(debouncedQuery)) return false;
      }
      return true;
    });
  }, [items, debouncedQuery, fromDate, toDate]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando inspecciones...
      </div>
    );
  }

  const hasActiveFilters = !!debouncedQuery || !!fromDate || !!toDate;

  function clearFilters() {
    setQuery("");
    setFromDate("");
    setToDate("");
  }

  function handleExportCsv() {
    const csv = inspectionsToCsv(filtered);
    downloadCsv(csv, `peritajes-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div className="space-y-4 pb-20 sm:space-y-6 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Peritajes</h1>
          <p className="text-sm text-muted-foreground">
            {items.length === 0
              ? "Aún no has creado ningún peritaje."
              : hasActiveFilters
                ? `${filtered.length} de ${items.length} peritaje${items.length === 1 ? "" : "s"} con los filtros aplicados.`
                : `${items.length} peritaje${items.length === 1 ? "" : "s"} registrado${items.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:self-auto">
          {items.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="gap-1.5"
              title="Descargar CSV de los peritajes visibles"
            >
              <FileSpreadsheet className="h-4 w-4" />
              CSV
            </Button>
          )}
          {isAdmin ? <BackupControls onChange={refresh} /> : null}
          <Button
            onClick={handleNew}
            size="lg"
            data-tour="per-new"
            className="hidden h-10 sm:inline-flex"
          >
            <Plus className="mr-1 h-4 w-4" /> Nuevo peritaje
          </Button>
        </div>
      </div>

      {items.length > 0 && (
        <Card data-tour="per-search">
          <CardContent className="space-y-3 p-3 sm:p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_140px_140px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por placa, VIN, propietario, consecutivo..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                placeholder="Desde"
                title="Desde"
                className="hidden sm:block"
              />
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                placeholder="Hasta"
                title="Hasta"
                className="hidden sm:block"
              />
            </div>
            {hasActiveFilters && (
              <div className="flex">
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                  <X className="h-3.5 w-3.5" />
                  Limpiar filtros
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <Search className="h-6 w-6" />
            <div>No hay peritajes que coincidan con los filtros aplicados.</div>
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div data-tour="per-list" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <InspectionCard
              key={item.id}
              item={item}
              canDelete={isAdmin}
              canReassign={canManage}
              hasPending={pendingIds.has(item.id)}
              assigneeName={
                item.userId ? memberById.get(item.userId)?.fullName ?? null : null
              }
              onOpen={() => router.push(`/inspection/${item.id}`)}
              onDuplicate={() => handleDuplicate(item.id)}
              onDelete={() => requestDelete(item)}
              onReassign={() => {
                setPendingReassign(item);
                setReassignTarget(item.userId ?? "");
              }}
            />
          ))}
        </div>
      )}

      {/* Mobile FAB — always visible on small screens so "Nuevo peritaje" is one tap away */}
      <button
        type="button"
        onClick={handleNew}
        aria-label="Nuevo peritaje"
        data-tour="per-new"
        className="fixed right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition-transform active:scale-95 sm:hidden"
        style={{ bottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}
      >
        <Plus className="h-5 w-5" />
        Nuevo peritaje
      </button>

      <Dialog
        open={pendingReassign !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingReassign(null);
            setReassignTarget("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reasignar peritaje</DialogTitle>
            <DialogDescription>
              {pendingReassign?.data.vehicle.plate
                ? `Placa ${pendingReassign.data.vehicle.plate}. `
                : ""}
              Elige a quién quieres transferirle este peritaje. El nuevo
              dueño podrá editarlo desde su sesión.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Asignado a
            </label>
            <select
              value={reassignTarget}
              onChange={(e) => setReassignTarget(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Sin asignar</option>
              {teamMembers
                .filter((m) => m.active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingReassign(null);
                setReassignTarget("");
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={doReassign}
              disabled={
                reassignBusy ||
                !reassignTarget ||
                reassignTarget === pendingReassign?.userId
              }
            >
              {reassignBusy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <UserCog className="mr-1 h-4 w-4" />
              )}
              Reasignar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar este peritaje?</DialogTitle>
            <DialogDescription>
              {pendingDelete?.data.vehicle.plate
                ? `Se eliminará el peritaje de la placa ${pendingDelete.data.vehicle.plate}. `
                : "Se eliminará este peritaje sin placa. "}
              Esta acción no se puede deshacer.
              {(pendingDelete?.lockedAt ||
                pendingDelete?.data.status === "completed") && (
                <span className="mt-2 block rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  Este peritaje está finalizado. Al borrarlo se elimina también
                  el PDF oficial entregado al cliente y se invalida cualquier
                  enlace compartido.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InspectionCard({
  item,
  canDelete,
  canReassign,
  hasPending,
  assigneeName,
  onOpen,
  onDuplicate,
  onDelete,
  onReassign,
}: {
  item: StoredInspection;
  canDelete: boolean;
  canReassign: boolean;
  hasPending: boolean;
  assigneeName: string | null;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReassign: () => void;
}) {
  const report = React.useMemo(() => analyze(item.data), [item.data]);
  const v = item.data.vehicle;
  const tone = riskTone(report.level);
  const hasPlate = !!v.plate;
  const isLocked = !!item.lockedAt || item.data.status === "completed";
  const toast = useToast();
  const [pdfBusy, setPdfBusy] = React.useState(false);

  async function handleDownloadPdf(e: React.MouseEvent) {
    e.stopPropagation();
    setPdfBusy(true);
    try {
      // El botón solo se muestra en peritajes finalizados, así que el PDF ya
      // está en el server: lo pedimos por GET en vez de subir la inspección
      // entera con las fotos.
      await downloadStoredPdf(item.id, item.data);
      toast.show({ title: "PDF descargado", variant: "success" });
    } catch (err) {
      toast.show({
        title: "No se pudo descargar el PDF",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "danger",
      });
    } finally {
      setPdfBusy(false);
    }
  }

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
            {item.reportNumber && (
              <div className="mt-1 inline-flex items-center rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-foreground">
                {item.reportNumber}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant={tone} className="text-[10px]">
              {riskLevelLabel(report.level)}
            </Badge>
            <span className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {(VEHICLE_TYPES[item.data.vehicleType] ?? VEHICLE_TYPES[FALLBACK_VEHICLE_TYPE]).short}
            </span>
            <span className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {(PERITAJE_KINDS[item.data.kind] ?? PERITAJE_KINDS.plus).short}
            </span>
            {isLocked ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
                title="Peritaje finalizado e inmutable"
              >
                <Lock className="h-3 w-3" /> Finalizado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/30 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Borrador
              </span>
            )}
            {hasPending && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning"
                title="Hay cambios guardados localmente que aún no se han subido al servidor"
              >
                <Cloud className="h-3 w-3" /> Por subir
              </span>
            )}
          </div>
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
            <div className="truncate font-medium">
              {/* Si el owner ve un peritaje de otro perito de su org, mostramos
                  el nombre real del asignado (no el "v.inspector" que es solo
                  texto que el perito escribió en su data y puede estar
                  desactualizado). Caemos a v.inspector como fallback. */}
              {assigneeName ?? (v.inspector || "—")}
            </div>
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
            {/* Solo peritajes finalizados. En borrador el server rechaza la
                descarga (el PDF entregable existe únicamente después de
                finalizar), así que mostrar el botón acá era ofrecer algo que
                siempre fallaba con un 403. Para ver un borrador está
                "Previsualizar PDF" dentro del peritaje. */}
            {isLocked && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                onClick={handleDownloadPdf}
                disabled={pdfBusy}
                aria-label="Descargar PDF"
                title="Descargar PDF"
              >
                {pdfBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            )}
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
            {canReassign && !isLocked ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                onClick={(e) => {
                  e.stopPropagation();
                  onReassign();
                }}
                aria-label="Reasignar peritaje"
                title="Reasignar a otro empleado"
              >
                <UserCog className="h-4 w-4" />
              </Button>
            ) : null}
            {canDelete ? (
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
            ) : null}
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
