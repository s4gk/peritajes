"use client";

import { emptyInspection } from "./default-data";
import {
  idbClear,
  idbDelete,
  idbGetAll,
  idbPut,
  isIdbAvailable,
} from "./idb";
import type { InspectionData, StoredInspection } from "./types";
import { makeId } from "./utils";

/**
 * Storage strategy
 * ----------------
 * Primary: IndexedDB (~unlimited quota, survives image blobs).
 * The store is loaded once into an in-memory Map so all reads stay synchronous
 * and the wizard/list UI doesn't need to thread promises through every hook.
 *
 * Writes mutate the Map immediately and fire-and-forget to IDB in the background.
 * If IDB is unavailable (e.g. SSR or a locked private-mode browser) we fall back
 * to a single localStorage key with the same shape — the legacy v2 storage.
 */

const LEGACY_KEY_V1 = "perito:inspection:v1";
const LEGACY_KEY_V2 = "perito:inspections:v2";

const memory = new Map<string, StoredInspection>();
let initialized = false;
let initPromise: Promise<void> | null = null;
let useIdb = false;

function readLegacyV2Array(): StoredInspection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LEGACY_KEY_V2);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredInspection[]) : [];
  } catch {
    return [];
  }
}

function writeLegacyV2Array(inspections: StoredInspection[]) {
  try {
    localStorage.setItem(LEGACY_KEY_V2, JSON.stringify(inspections));
  } catch {
    // quota — silent
  }
}

function readLegacyV1(): InspectionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY_V1);
    if (!raw) return null;
    return JSON.parse(raw) as InspectionData;
  } catch {
    return null;
  }
}

function mergeDefaults(inspection: StoredInspection): StoredInspection {
  const base = emptyInspection();
  const d = (inspection?.data ?? {}) as Partial<InspectionData>;
  return {
    ...inspection,
    data: {
      ...base,
      ...d,
      // Ensure every top-level record exists with the right shape, even if the
      // persisted row is from an older schema or has undefined keys.
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
      conclusion: { ...base.conclusion, ...(d.conclusion ?? {}) },
    },
  };
}

function persistAsync(inspection: StoredInspection) {
  if (useIdb) {
    idbPut(inspection).catch(() => {
      // On IDB failure, fall back to localStorage mirror
      writeLegacyV2Array(Array.from(memory.values()));
    });
  } else {
    writeLegacyV2Array(Array.from(memory.values()));
  }
}

function persistDeleteAsync(id: string) {
  if (useIdb) {
    idbDelete(id).catch(() => {
      writeLegacyV2Array(Array.from(memory.values()));
    });
  } else {
    writeLegacyV2Array(Array.from(memory.values()));
  }
}

/**
 * One-time initialization. Idempotent and safe to await from multiple entry
 * points (list + provider) concurrently.
 */
export function initStore(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (typeof window === "undefined") {
      initialized = true;
      return;
    }

    useIdb = isIdbAvailable();

    if (useIdb) {
      // Load existing from IDB
      try {
        const rows = await idbGetAll<StoredInspection>();
        for (const row of rows) {
          memory.set(row.id, mergeDefaults(row));
        }
      } catch {
        useIdb = false;
      }
    }

    // Legacy v2 → primary store migration
    const legacyV2 = readLegacyV2Array();
    if (legacyV2.length > 0) {
      for (const row of legacyV2) {
        if (!memory.has(row.id)) {
          const merged = mergeDefaults(row);
          memory.set(row.id, merged);
          if (useIdb) {
            try {
              await idbPut(merged);
            } catch {
              // ignore — will re-persist on next write
            }
          }
        }
      }
      if (useIdb) {
        // Successfully imported — drop the localStorage copy to free quota
        try {
          localStorage.removeItem(LEGACY_KEY_V2);
        } catch {
          // ignore
        }
      }
    }

    // Legacy v1 (single-inspection) → one entry
    const legacyV1 = readLegacyV1();
    if (legacyV1 && memory.size === 0) {
      const now = new Date().toISOString();
      const entry: StoredInspection = {
        id: makeId(),
        createdAt: now,
        updatedAt: now,
        data: { ...emptyInspection(), ...legacyV1 },
      };
      memory.set(entry.id, entry);
      if (useIdb) {
        try {
          await idbPut(entry);
        } catch {
          // ignore
        }
      } else {
        writeLegacyV2Array(Array.from(memory.values()));
      }
    }
    try {
      localStorage.removeItem(LEGACY_KEY_V1);
    } catch {
      // ignore
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

export function createInspection(): StoredInspection {
  const now = new Date().toISOString();
  const insp: StoredInspection = {
    id: makeId(),
    createdAt: now,
    updatedAt: now,
    data: emptyInspection(),
  };
  memory.set(insp.id, insp);
  persistAsync(insp);
  return insp;
}

export function saveInspectionData(id: string, data: InspectionData) {
  const existing = memory.get(id);
  if (!existing) return;
  const updated: StoredInspection = {
    ...existing,
    data,
    updatedAt: new Date().toISOString(),
  };
  memory.set(id, updated);
  persistAsync(updated);
}

export function deleteInspection(id: string) {
  memory.delete(id);
  persistDeleteAsync(id);
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
    },
  };
  memory.set(copy.id, copy);
  persistAsync(copy);
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
 * Reset the full store. Used mostly by tests and the theoretical "borrar todo".
 * Not wired to any UI for now.
 */
export async function resetStore(): Promise<void> {
  memory.clear();
  if (useIdb) {
    try {
      await idbClear();
    } catch {
      // ignore
    }
  }
  try {
    localStorage.removeItem(LEGACY_KEY_V2);
    localStorage.removeItem(LEGACY_KEY_V1);
  } catch {
    // ignore
  }
}

/**
 * Legacy export retained so existing imports keep compiling. Use initStore()
 * instead for new code — it's what actually runs the migration.
 */
export function migrateLegacyIfNeeded(): void {
  // No-op: initStore() handles legacy migration as part of hydration.
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

/**
 * Imports a backup JSON. By default merges (newer updatedAt wins per id).
 * `replace` mode wipes the store first.
 */
export async function importInspections(
  raw: unknown,
  mode: ImportMode = "merge",
): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  let payload: InspectionsBackup;
  try {
    payload =
      typeof raw === "string" ? (JSON.parse(raw) as InspectionsBackup) : (raw as InspectionsBackup);
  } catch (e) {
    result.errors.push(`JSON inválido: ${(e as Error).message}`);
    return result;
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.inspections)) {
    result.errors.push("Archivo no parece ser un backup de Perito.");
    return result;
  }
  if (payload.version !== BACKUP_VERSION) {
    result.errors.push(`Versión de backup no soportada (${payload.version}).`);
    return result;
  }

  if (mode === "replace") {
    await resetStore();
  }

  for (const row of payload.inspections) {
    if (!row || typeof row.id !== "string" || !row.data) {
      result.skipped += 1;
      continue;
    }
    const merged = mergeDefaults(row);
    const existing = memory.get(merged.id);
    if (existing) {
      // Newer updatedAt wins
      if ((merged.updatedAt ?? "") > (existing.updatedAt ?? "")) {
        memory.set(merged.id, merged);
        persistAsync(merged);
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
    } else {
      memory.set(merged.id, merged);
      persistAsync(merged);
      result.added += 1;
    }
  }

  return result;
}
