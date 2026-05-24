"use client";

import * as React from "react";

import {
  DEFAULT_PERITAJE_KIND,
  FALLBACK_VEHICLE_TYPE,
  PERITAJE_KINDS,
  VEHICLE_TYPES,
} from "@/lib/constants";
import { emptyInspection } from "@/lib/default-data";
import {
  awaitServerFetch,
  getInspection,
  initStore,
  saveInspectionData,
} from "@/lib/inspections-store";
import type {
  CylinderEntry,
  InspectionData,
  InspectionEntry,
  PeritajeKind,
  VehicleType,
} from "@/lib/types";
import { defaultOkValueFor } from "@/lib/findings-catalog";

/** Merge una sección stored con su base aplicando backfill: si el stored tiene
 *  el item pero con `status` vacío (peritajes creados antes del default OK),
 *  hereda el status del base — que ahora es "Bueno"/"Sin observaciones" según
 *  el ItemKind. Si no, respeta el valor del stored. Sin este backfill, un
 *  peritaje legacy se quedaba con todos los items en pendiente aunque
 *  `emptySection()` ya los inicialice con OK. */
function mergeSectionWithBackfill(
  base: Record<string, InspectionEntry>,
  stored: Record<string, InspectionEntry> | undefined,
): Record<string, InspectionEntry> {
  if (!stored) return { ...base };
  const result: Record<string, InspectionEntry> = { ...base };
  for (const key of Object.keys(stored)) {
    const baseEntry = base[key];
    const storedEntry = stored[key];
    if (!storedEntry) continue;
    result[key] = {
      ...(baseEntry ?? { images: [] }),
      ...storedEntry,
      status: storedEntry.status || baseEntry?.status,
    };
  }
  return result;
}

function hydrateData(stored: Partial<InspectionData> | undefined): InspectionData {
  const base = emptyInspection();
  const s = stored ?? {};
  const kind: PeritajeKind =
    s.kind && s.kind in PERITAJE_KINDS ? s.kind : DEFAULT_PERITAJE_KIND;
  const vehicleType: VehicleType =
    s.vehicleType && s.vehicleType in VEHICLE_TYPES
      ? s.vehicleType
      : FALLBACK_VEHICLE_TYPE;
  const mechanicalDefault = defaultOkValueFor("mechanical");
  const engineCompression: CylinderEntry[] = Array.isArray(s.engineCompression)
    ? s.engineCompression.map((c) => ({ ...c, status: c.status || mechanicalDefault }))
    : base.engineCompression;
  return {
    ...base,
    ...s,
    kind,
    vehicleType,
    vehicle: { ...base.vehicle, ...(s.vehicle ?? {}) },
    bodywork: mergeSectionWithBackfill(base.bodywork, s.bodywork),
    chassis: mergeSectionWithBackfill(base.chassis, s.chassis),
    suspension: mergeSectionWithBackfill(base.suspension, s.suspension),
    engine: mergeSectionWithBackfill(base.engine, s.engine),
    electrical: mergeSectionWithBackfill(base.electrical, s.electrical),
    leaks: mergeSectionWithBackfill(base.leaks, s.leaks),
    comfort: mergeSectionWithBackfill(base.comfort, s.comfort),
    roadTest: mergeSectionWithBackfill(base.roadTest, s.roadTest),
    engineCompression,
    tires: { ...base.tires, ...(s.tires ?? {}) },
    extraPhotos: Array.isArray(s.extraPhotos) ? s.extraPhotos : [],
    mandatoryPhotos: {
      ...base.mandatoryPhotos,
      ...(s.mandatoryPhotos ?? {}),
    },
    accessories: Array.isArray(s.accessories) ? s.accessories : [],
    confirmedSteps: Array.isArray(s.confirmedSteps) ? s.confirmedSteps : [],
    conclusion: { ...base.conclusion, ...(s.conclusion ?? {}) },
  };
}

type Updater<T> = (prev: T) => T;

export type SaveStatus = "idle" | "pending" | "saving" | "saved";

type ContextValue = {
  id: string;
  data: InspectionData;
  setData: (updater: Updater<InspectionData>) => void;
  isHydrated: boolean;
  notFound: boolean;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  /** True when data.status === "completed". Inputs should be disabled. */
  isReadOnly: boolean;
  /** Consecutivo oficial asignado por el server al finalizar. undefined
   *  mientras el peritaje sigue en borrador. */
  reportNumber: string | undefined;
};

const InspectionContext = React.createContext<ContextValue | null>(null);

type Props = {
  id: string;
  children: React.ReactNode;
};

const SAVE_DEBOUNCE_MS = 400;

export function InspectionProvider({ id, children }: Props) {
  const [data, setDataState] = React.useState<InspectionData>(() => emptyInspection());
  const [isHydrated, setHydrated] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [reportNumber, setReportNumber] = React.useState<string | undefined>(undefined);
  const dirtyRef = React.useRef(false);
  // True cuando el status "completed" ya quedó persistido (IDB + encolado).
  // No lo derivamos de `data.status` porque eso bloquearía la save que
  // transiciona draft → completed (la única forma de cerrar el peritaje).
  const savedAsCompletedRef = React.useRef(false);

  // Load on mount / when id changes — ensure IDB-backed store is ready first.
  // El initStore() resuelve apenas IDB está cargado (instantáneo). Si la
  // inspección no está en IDB (primer login en este dispositivo, p.ej.),
  // esperamos al fetch del server como fallback antes de marcar notFound.
  React.useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    setNotFound(false);
    (async () => {
      try {
        await initStore();
        if (cancelled) return;

        let stored = getInspection(id);
        if (!stored) {
          // No estaba en IDB — esperamos al refresh del server por si llegó
          // en otra sesión / otro dispositivo.
          await awaitServerFetch();
          if (cancelled) return;
          stored = getInspection(id);
        }

        if (stored) {
          setDataState(hydrateData(stored.data));
          setReportNumber(stored.reportNumber);
          setLastSavedAt(stored.updatedAt ? new Date(stored.updatedAt).getTime() : Date.now());
        } else {
          setNotFound(true);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[InspectionProvider] hydration failed", err);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // El consecutivo lo asigna el server al finalizar. El sync-queue dispatcha
  // `perito:inspection-synced` cuando la respuesta del PUT trae datos nuevos —
  // re-leemos el store local para refrescar reportNumber al toque.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    function onSynced(e: Event) {
      const ev = e as CustomEvent<string>;
      if (ev.detail !== id) return;
      const stored = getInspection(id);
      if (stored?.reportNumber) setReportNumber(stored.reportNumber);
    }
    window.addEventListener("perito:inspection-synced", onSynced);
    return () => window.removeEventListener("perito:inspection-synced", onSynced);
  }, [id]);

  const isReadOnly = data.status === "completed";

  // Debounced persist with save-status indicator. Una vez que el completed
  // queda persistido marcamos `savedAsCompletedRef` y bloqueamos cualquier
  // save posterior — el server rechazaría con 423 y solo generaríamos ruido
  // en la sync queue.
  React.useEffect(() => {
    if (!isHydrated || notFound) return;
    if (savedAsCompletedRef.current) return;
    if (!dirtyRef.current) {
      // Initial render after hydration — no save needed. Si ya viene
      // finalizado del store, marcamos el ref para no volver a guardar.
      dirtyRef.current = true;
      if (isReadOnly) savedAsCompletedRef.current = true;
      return;
    }
    setSaveStatus("pending");
    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      try {
        saveInspectionData(id, data);
        if (data.status === "completed") savedAsCompletedRef.current = true;
        const now = Date.now();
        setLastSavedAt(now);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("idle");
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [id, data, isHydrated, notFound, isReadOnly]);

  const setData = React.useCallback((updater: Updater<InspectionData>) => {
    setDataState((prev) => updater(prev));
  }, []);

  const value = React.useMemo<ContextValue>(
    () => ({
      id,
      data,
      setData,
      isHydrated,
      notFound,
      saveStatus,
      lastSavedAt,
      isReadOnly,
      reportNumber,
    }),
    [id, data, setData, isHydrated, notFound, saveStatus, lastSavedAt, isReadOnly, reportNumber],
  );

  return <InspectionContext.Provider value={value}>{children}</InspectionContext.Provider>;
}

export function useInspection() {
  const ctx = React.useContext(InspectionContext);
  if (!ctx) throw new Error("useInspection must be used within InspectionProvider");
  return ctx;
}
