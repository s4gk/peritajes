"use client";

import { emptyInspection } from "./default-data";
import type { InspectionData, StoredInspection, VehicleInfo } from "./types";
import type { VerifikSnapshot } from "./verifik/types";
import { makeId } from "./utils";

export type InspectionSeed = {
  vehicle?: Partial<VehicleInfo>;
  verifik?: VerifikSnapshot;
};

/**
 * Storage strategy
 * ----------------
 * Server is the source of truth (Postgres via /api/inspections). The client
 * keeps an in-memory cache so list/get reads stay synchronous — the wizard
 * autosave fires through `saveInspectionData()` which debounces a PUT.
 *
 * Optimistic create: the client generates the ID locally and the server
 * accepts it (see /api/inspections POST). That lets the wizard navigate
 * to /inspection/{id} without awaiting the round-trip.
 *
 * If the network fails mid-edit, the latest data still lives in the cache;
 * the next successful PUT publishes it. We don't queue offline writes —
 * see project_admin_panel.md if you need to bring offline-first back.
 */

const memory = new Map<string, StoredInspection>();
let initialized = false;
let initPromise: Promise<void> | null = null;

const SAVE_DEBOUNCE_MS = 600;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inflightSaves = new Set<string>();

function mergeDefaults(inspection: StoredInspection): StoredInspection {
  const base = emptyInspection();
  const d = (inspection?.data ?? {}) as Partial<InspectionData>;
  return {
    ...inspection,
    data: {
      ...base,
      ...d,
      vehicle: { ...base.vehicle, ...(d.vehicle ?? {}) },
      bodywork: { ...base.bodywork, ...(d.bodywork ?? {}) },
      chassis: { ...base.chassis, ...(d.chassis ?? {}) },
      suspension: { ...base.suspension, ...(d.suspension ?? {}) },
      engine: { ...base.engine, ...(d.engine ?? {}) },
      electrical: { ...base.electrical, ...(d.electrical ?? {}) },
      leaks: { ...base.leaks, ...(d.leaks ?? {}) },
      comfort: { ...base.comfort, ...(d.comfort ?? {}) },
      roadTest: { ...base.roadTest, ...(d.roadTest ?? {}) },
      tires: { ...base.tires, ...(d.tires ?? {}) },
      accessories: Array.isArray(d.accessories) ? d.accessories : [],
      confirmedSteps: Array.isArray(d.confirmedSteps) ? d.confirmedSteps : [],
      status: d.status === "completed" ? "completed" : "draft",
      completedAt: d.completedAt,
      conclusion: { ...base.conclusion, ...(d.conclusion ?? {}) },
    },
  };
}

async function fetchJson(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return res.json();
}

/**
 * One-time initialization. Hydrates the in-memory cache from the server.
 * Idempotent and safe to await from multiple entry points concurrently.
 */
export function initStore(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (typeof window === "undefined") {
      initialized = true;
      return;
    }
    try {
      const json = (await fetchJson("/api/inspections")) as {
        inspections: StoredInspection[];
      };
      for (const row of json.inspections ?? []) {
        memory.set(row.id, mergeDefaults(row));
      }
    } catch {
      // Auth failure or network — leave cache empty. The page may redirect
      // to /login or show a banner; either way we don't crash.
    }
    initialized = true;
  })();

  return initPromise;
}

export function isStoreReady(): boolean {
  return initialized;
}

export function listInspections(): StoredInspection[] {
  return Array.from(memory.values()).sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1,
  );
}

export function getInspection(id: string): StoredInspection | null {
  return memory.get(id) ?? null;
}

function postCreate(inspection: StoredInspection) {
  fetchJson("/api/inspections", {
    method: "POST",
    body: JSON.stringify({ id: inspection.id, data: inspection.data }),
  })
    .then((json: { inspection: StoredInspection }) => {
      // Reconcile timestamps with what the server stored.
      const server = mergeDefaults(json.inspection);
      const current = memory.get(server.id);
      memory.set(server.id, {
        ...server,
        data: current ? current.data : server.data,
      });
    })
    .catch(() => {
      // The optimistic entry is still in cache; user can retry by editing.
    });
}

export function createInspection(seed?: InspectionSeed): StoredInspection {
  const now = new Date().toISOString();
  const base = emptyInspection();
  const data: InspectionData = seed
    ? {
        ...base,
        vehicle: { ...base.vehicle, ...(seed.vehicle ?? {}) },
        verifik: seed.verifik ?? base.verifik,
      }
    : base;
  const insp: StoredInspection = {
    id: makeId(),
    createdAt: now,
    updatedAt: now,
    data,
  };
  memory.set(insp.id, insp);
  postCreate(insp);
  return insp;
}

function flushSave(id: string) {
  const existing = memory.get(id);
  if (!existing) return;
  if (inflightSaves.has(id)) {
    // Another PUT is in flight — schedule a follow-up after it completes.
    pendingTimers.set(
      id,
      setTimeout(() => flushSave(id), SAVE_DEBOUNCE_MS),
    );
    return;
  }
  inflightSaves.add(id);
  fetchJson(`/api/inspections/${id}`, {
    method: "PUT",
    body: JSON.stringify({ data: existing.data }),
  })
    .then((json: { inspection: StoredInspection }) => {
      const server = mergeDefaults(json.inspection);
      const current = memory.get(id);
      // Preserve the latest in-memory data (the user may have typed more
      // while the request was in flight) — only adopt server timestamps.
      memory.set(id, {
        ...server,
        data: current ? current.data : server.data,
      });
    })
    .catch(() => {
      // Will be retried on the next edit.
    })
    .finally(() => {
      inflightSaves.delete(id);
    });
}

export function saveInspectionData(id: string, data: InspectionData) {
  const existing = memory.get(id);
  const updated: StoredInspection = {
    id,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data,
  };
  memory.set(id, updated);

  const t = pendingTimers.get(id);
  if (t) clearTimeout(t);
  pendingTimers.set(
    id,
    setTimeout(() => {
      pendingTimers.delete(id);
      flushSave(id);
    }, SAVE_DEBOUNCE_MS),
  );
}

export function deleteInspection(id: string) {
  memory.delete(id);
  const t = pendingTimers.get(id);
  if (t) {
    clearTimeout(t);
    pendingTimers.delete(id);
  }
  fetchJson(`/api/inspections/${id}`, { method: "DELETE" }).catch(() => {
    // Silent — user already sees it gone from the list.
  });
}

export function duplicateInspection(id: string): StoredInspection | null {
  const original = memory.get(id);
  if (!original) return null;
  const now = new Date().toISOString();
  const copy: StoredInspection = {
    id: makeId(),
    createdAt: now,
    updatedAt: now,
    data: {
      ...original.data,
      vehicle: { ...original.data.vehicle, plate: "" },
      status: "draft",
      completedAt: undefined,
    },
  };
  memory.set(copy.id, copy);
  postCreate(copy);
  return copy;
}

/**
 * Returns de-duplicated vehicle snapshots from prior inspections, most-recent first.
 * Used for autocomplete-by-plate in the vehicle info step.
 */
export function listKnownVehicles(): StoredInspection["data"]["vehicle"][] {
  const seen = new Set<string>();
  const out: StoredInspection["data"]["vehicle"][] = [];
  for (const insp of listInspections()) {
    const v = insp.data.vehicle;
    const key = (v.plate || v.vin || "").trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Reset the full store (cache only — does not touch the server).
 * Used by tests; not wired to any UI.
 */
export async function resetStore(): Promise<void> {
  memory.clear();
  initialized = false;
  initPromise = null;
  for (const t of pendingTimers.values()) clearTimeout(t);
  pendingTimers.clear();
  inflightSaves.clear();
}

/**
 * Legacy export retained so existing imports keep compiling.
 */
export function migrateLegacyIfNeeded(): void {
  // No-op: hydration runs in initStore().
}

/* -----------------------------------------------------------
 *  Backup: export / import
 * --------------------------------------------------------- */

const BACKUP_VERSION = 1;

export type InspectionsBackup = {
  version: number;
  exportedAt: string;
  count: number;
  inspections: StoredInspection[];
};

export function exportAllInspections(): InspectionsBackup {
  const inspections = listInspections();
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    count: inspections.length,
    inspections,
  };
}

export type ImportResult = {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export type ImportMode = "merge" | "replace";

export async function importInspections(
  raw: unknown,
  _mode: ImportMode = "merge",
): Promise<ImportResult> {
  let payload: InspectionsBackup;
  try {
    payload =
      typeof raw === "string"
        ? (JSON.parse(raw) as InspectionsBackup)
        : (raw as InspectionsBackup);
  } catch (e) {
    return {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: [`JSON inválido: ${(e as Error).message}`],
    };
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.inspections)) {
    return {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: ["Archivo no parece ser un backup de Perito."],
    };
  }
  if (payload.version !== BACKUP_VERSION) {
    return {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: [`Versión de backup no soportada (${payload.version}).`],
    };
  }

  try {
    const result = (await fetchJson("/api/inspections/import", {
      method: "POST",
      body: JSON.stringify(payload),
    })) as ImportResult;

    // Refresh the cache so the UI shows imported items.
    initialized = false;
    memory.clear();
    initPromise = null;
    await initStore();

    return result;
  } catch (e) {
    return {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: [e instanceof Error ? e.message : "Error de red"],
    };
  }
}
