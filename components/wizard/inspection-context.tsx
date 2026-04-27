"use client";

import * as React from "react";

import { emptyInspection } from "@/lib/default-data";
import {
  getInspection,
  initStore,
  saveInspectionData,
} from "@/lib/inspections-store";
import type { InspectionData } from "@/lib/types";

function hydrateData(stored: Partial<InspectionData> | undefined): InspectionData {
  const base = emptyInspection();
  const s = stored ?? {};
  return {
    ...base,
    ...s,
    vehicle: { ...base.vehicle, ...(s.vehicle ?? {}) },
    bodywork: { ...base.bodywork, ...(s.bodywork ?? {}) },
    chassis: { ...base.chassis, ...(s.chassis ?? {}) },
    suspension: { ...base.suspension, ...(s.suspension ?? {}) },
    engine: { ...base.engine, ...(s.engine ?? {}) },
    electrical: { ...base.electrical, ...(s.electrical ?? {}) },
    leaks: { ...base.leaks, ...(s.leaks ?? {}) },
    comfort: { ...base.comfort, ...(s.comfort ?? {}) },
    roadTest: { ...base.roadTest, ...(s.roadTest ?? {}) },
    tires: { ...base.tires, ...(s.tires ?? {}) },
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
  const dirtyRef = React.useRef(false);

  // Load on mount / when id changes — ensure IDB-backed store is ready first
  React.useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    setNotFound(false);
    (async () => {
      try {
        await initStore();
        if (cancelled) return;
        const stored = getInspection(id);
        if (stored) {
          setDataState(hydrateData(stored.data));
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

  // Debounced persist with save-status indicator
  React.useEffect(() => {
    if (!isHydrated || notFound) return;
    if (!dirtyRef.current) {
      // Initial render after hydration — no save needed
      dirtyRef.current = true;
      return;
    }
    setSaveStatus("pending");
    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      try {
        saveInspectionData(id, data);
        const now = Date.now();
        setLastSavedAt(now);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("idle");
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [id, data, isHydrated, notFound]);

  const setData = React.useCallback((updater: Updater<InspectionData>) => {
    setDataState((prev) => updater(prev));
  }, []);

  const value = React.useMemo<ContextValue>(
    () => ({ id, data, setData, isHydrated, notFound, saveStatus, lastSavedAt }),
    [id, data, setData, isHydrated, notFound, saveStatus, lastSavedAt],
  );

  return <InspectionContext.Provider value={value}>{children}</InspectionContext.Provider>;
}

export function useInspection() {
  const ctx = React.useContext(InspectionContext);
  if (!ctx) throw new Error("useInspection must be used within InspectionProvider");
  return ctx;
}
