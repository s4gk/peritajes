"use client";

import { apiFetch } from "./client/api-client";
import {
  idbDeleteInspection,
  idbEnqueueMutation,
  idbListInspections,
  idbPutInspection,
  idbPutInspections,
} from "./client/idb";
import {
  flushSyncQueue,
  refreshPending,
  requestBackgroundSync,
  setSyncedInspectionHandler,
  startSyncWatcher,
} from "./client/sync-queue";
import {
  DEFAULT_PERITAJE_KIND,
  FALLBACK_VEHICLE_TYPE,
  PERITAJE_KINDS,
  VEHICLE_TYPES,
} from "./constants";
import { emptyInspection, ensureMinCylinders } from "./default-data";
import type {
  InspectionData,
  PeritajeKind,
  StoredInspection,
  VehicleInfo,
  VehicleType,
} from "./types";
import type { VerifikSnapshot } from "./verifik/types";
import { makeId } from "./utils";

export type InspectionSeed = {
  kind?: PeritajeKind;
  vehicleType?: VehicleType;
  vehicle?: Partial<VehicleInfo>;
  verifik?: VerifikSnapshot;
};

/**
 * Storage strategy (offline-first)
 * --------------------------------
 * Server (Postgres) is the canonical store. El cliente mantiene una copia en
 * IndexedDB que sobrevive recargas y trabaja sin red, más un memory cache
 * para reads síncronos durante el render.
 *
 * Boot:
 *   1. Cargar IDB → memory (instantáneo, funciona offline)
 *   2. Si hay red, fetchear /api/inspections y mergear: server gana en filas
 *      que existen ambos lados (last-write-wins por updatedAt), local gana en
 *      filas que el server no conoce todavía (nunca se subieron).
 *
 * Writes: cada saveInspectionData/createInspection/deleteInspection escribe a
 * IDB y empuja una mutation a la queue. La queue se procesa en orden por
 * sync-queue.ts (replay sobre 'online' + intervalo de respaldo).
 */

const memory = new Map<string, StoredInspection>();
let initialized = false;
let initPromise: Promise<void> | null = null;
/** Promise del refresh contra /api/inspections. Corre en background después
 *  de initStore(): no bloquea la carga, pero los providers pueden esperarlo
 *  como fallback si el ID que buscan no está en IDB. */
let serverFetchPromise: Promise<void> | null = null;

/** True si el peritaje ya fue finalizado y es inmutable: el lock se determina
 *  por `lockedAt` (campo nuevo) o por `data.status === "completed"` (fallback
 *  para filas legacy). Lo usamos del lado del cliente para no encolar
 *  mutaciones que el server va a rechazar con 423. */
function isInspectionLocked(insp: StoredInspection | null | undefined): boolean {
  if (!insp) return false;
  if (insp.lockedAt) return true;
  return insp.data?.status === "completed";
}

function mergeDefaults(inspection: StoredInspection): StoredInspection {
  const base = emptyInspection();
  const d = (inspection?.data ?? {}) as Partial<InspectionData>;
  const kind: PeritajeKind =
    d.kind && d.kind in PERITAJE_KINDS ? d.kind : DEFAULT_PERITAJE_KIND;
  const vehicleType: VehicleType =
    d.vehicleType && d.vehicleType in VEHICLE_TYPES
      ? d.vehicleType
      : FALLBACK_VEHICLE_TYPE;
  return {
    ...inspection,
    data: {
      ...base,
      ...d,
      kind,
      vehicleType,
      vehicle: { ...base.vehicle, ...(d.vehicle ?? {}) },
      documents: {
        ownershipCardFront: Array.isArray(d.documents?.ownershipCardFront)
          ? d.documents!.ownershipCardFront
          : [],
        ownershipCardBack: Array.isArray(d.documents?.ownershipCardBack)
          ? d.documents!.ownershipCardBack
          : [],
      },
      bodywork: { ...base.bodywork, ...(d.bodywork ?? {}) },
      chassis: { ...base.chassis, ...(d.chassis ?? {}) },
      suspension: { ...base.suspension, ...(d.suspension ?? {}) },
      engine: { ...base.engine, ...(d.engine ?? {}) },
      electrical: { ...base.electrical, ...(d.electrical ?? {}) },
      leaks: { ...base.leaks, ...(d.leaks ?? {}) },
      comfort: { ...base.comfort, ...(d.comfort ?? {}) },
      roadTest: { ...base.roadTest, ...(d.roadTest ?? {}) },
      roadTestSkipped: d.roadTestSkipped === true,
      extraPhotos: Array.isArray(d.extraPhotos) ? d.extraPhotos : [],
      mandatoryPhotos: {
        diagonalFrontLeft: Array.isArray(d.mandatoryPhotos?.diagonalFrontLeft)
          ? d.mandatoryPhotos!.diagonalFrontLeft
          : [],
        diagonalRearRight: Array.isArray(d.mandatoryPhotos?.diagonalRearRight)
          ? d.mandatoryPhotos!.diagonalRearRight
          : [],
        innerCabin: Array.isArray(d.mandatoryPhotos?.innerCabin)
          ? d.mandatoryPhotos!.innerCabin
          : [],
        chassisNumber: Array.isArray(d.mandatoryPhotos?.chassisNumber)
          ? d.mandatoryPhotos!.chassisNumber
          : [],
        engineNumber: Array.isArray(d.mandatoryPhotos?.engineNumber)
          ? d.mandatoryPhotos!.engineNumber
          : [],
        idPlate: Array.isArray(d.mandatoryPhotos?.idPlate)
          ? d.mandatoryPhotos!.idPlate
          : [],
      },
      tires: { ...base.tires, ...(d.tires ?? {}) },
      accessories: Array.isArray(d.accessories) ? d.accessories : [],
      // Siempre garantizamos el mínimo (3) — si el peritaje guardó menos
      // (legacy o lista vacía de iteraciones previas), se rellena al cargar.
      engineCompression: ensureMinCylinders(
        Array.isArray(d.engineCompression) ? d.engineCompression : [],
      ),
      confirmedSteps: Array.isArray(d.confirmedSteps) ? d.confirmedSteps : [],
      status: d.status === "completed" ? "completed" : "draft",
      completedAt: d.completedAt,
      conclusion: { ...base.conclusion, ...(d.conclusion ?? {}) },
    },
  };
}

async function fetchJson(input: RequestInfo, init?: RequestInit) {
  // apiFetch agrega el header CSRF cuando el método no es seguro (POST/PUT/
  // PATCH/DELETE). Para GET se comporta igual que fetch nativo.
  const res = await apiFetch(input, {
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

    // Paso 1: cargar IDB → memory. Esto siempre debe correr aunque no haya red.
    try {
      const local = await idbListInspections();
      for (const row of local) memory.set(row.id, mergeDefaults(row));
    } catch {
      // Si IDB falla (modo privado en algunos browsers), seguimos con memory
      // limpio — el server hidratará abajo.
    }

    // Paso 2: arrancar el watcher de sync (replay queue + listener online).
    // Registramos el handler que aplica la versión canónica del server al
    // cache local — necesario para que reportNumber asignado al finalizar
    // aparezca sin esperar al próximo boot.
    const applySyncedInspection = (insp: StoredInspection) => {
      const merged = mergeDefaults(insp);
      memory.set(merged.id, merged);
      idbPutInspection(merged).catch(() => {});
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("perito:inspection-synced", { detail: merged.id }),
        );
      }
    };
    setSyncedInspectionHandler(applySyncedInspection);

    // El service worker también puede reportar inspecciones syncadas (cuando
    // dispara el Background Sync con la app cerrada y vuelve a abrirse).
    // Escuchamos su postMessage y aplicamos exactamente la misma lógica.
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        const msg = event.data as { type?: string; inspection?: StoredInspection } | null;
        if (msg?.type === "inspection-synced" && msg.inspection) {
          applySyncedInspection(msg.inspection);
        }
      });
    }

    startSyncWatcher();

    // Paso 3: arrancar el fetch del server en background. NO lo awaiteamos
    // acá porque bloquearía a callers (p.ej. InspectionProvider al recargar
    // un peritaje ya guardado en IDB esperaría a que baje TODA la lista del
    // server, lo que se siente como 1-3 seg de "Cargando..."). Quien necesite
    // garantizar versión del server puede esperar a `awaitServerFetch()`.
    serverFetchPromise = refreshFromServer();

    initialized = true;
  })();

  return initPromise;
}

async function refreshFromServer(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const json = (await fetchJson("/api/inspections")) as {
      inspections: StoredInspection[];
    };
    const merged: StoredInspection[] = [];
    for (const row of json.inspections ?? []) {
      const incoming = mergeDefaults(row);
      const local = memory.get(incoming.id);
      const winner =
        !local || local.updatedAt < incoming.updatedAt ? incoming : local;
      memory.set(winner.id, winner);
      merged.push(winner);
    }
    if (merged.length > 0) {
      idbPutInspections(merged).catch(() => {});
    }
    // Avisamos a las pantallas que pueden re-leer del store con la versión
    // canónica del server (p.ej. el listado de peritajes).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("perito:store-refreshed"));
    }
  } catch {
    // Sin red o sin auth — seguimos con lo que tenga IDB.
  }
}

/** Espera al fetch del server. Útil para callers que detectan que su ID no
 *  está en IDB y quieren darle una chance al server antes de mostrar 404. */
export function awaitServerFetch(): Promise<void> {
  return serverFetchPromise ?? Promise.resolve();
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

export function createInspection(seed?: InspectionSeed): StoredInspection {
  const now = new Date().toISOString();
  const base = emptyInspection();
  const data: InspectionData = seed
    ? {
        ...base,
        kind: seed.kind ?? base.kind,
        vehicleType: seed.vehicleType ?? base.vehicleType,
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
  // Persistir local + encolar create. El IDB write es fire-and-forget para no
  // bloquear el navigate; si falla se va a ver al recargar (no estará en la
  // lista) y el perito puede recrear. En la práctica nunca falla.
  idbPutInspection(insp).catch(() => {});
  idbEnqueueMutation({ kind: "create", inspectionId: insp.id, data: insp.data })
    .then(refreshPending)
    .then(flushSyncQueue)
    .then(requestBackgroundSync)
    .catch(() => {});
  return insp;
}

export function isLocked(id: string): boolean {
  return isInspectionLocked(memory.get(id));
}

export function saveInspectionData(id: string, data: InspectionData) {
  const existing = memory.get(id);
  // Si el peritaje ya está finalizado, ignoramos la mutación. Es defensa en
  // profundidad: la UI debería ya estar en modo solo-lectura, pero un
  // autosave pendiente o un caller mal portado no debe pisar la fila.
  if (isInspectionLocked(existing)) {
    if (typeof console !== "undefined") {
      console.warn(
        "[inspections-store] saveInspectionData ignorado: peritaje finalizado",
        id,
      );
    }
    return;
  }
  const updated: StoredInspection = {
    ...(existing ?? {}),
    id,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    data,
  };
  memory.set(id, updated);
  idbPutInspection(updated).catch(() => {});
  // La queue coalesa updates al mismo id, así que tipear rápido no apila
  // mutations — solo pisa el último payload.
  idbEnqueueMutation({ kind: "update", inspectionId: id, data })
    .then(refreshPending)
    .then(flushSyncQueue)
    .then(requestBackgroundSync)
    .catch(() => {});
}

export function deleteInspection(id: string) {
  // Nota: solo admin tiene el botón de borrar en la UI. El bloqueo dura del
  // server (deleteInspectionServer + requireAdmin) sigue siendo la frontera
  // real. Acá solo evitamos encolar mutaciones que vamos a saber inválidas.
  memory.delete(id);
  idbDeleteInspection(id).catch(() => {});
  idbEnqueueMutation({ kind: "delete", inspectionId: id })
    .then(refreshPending)
    .then(flushSyncQueue)
    .then(requestBackgroundSync)
    .catch(() => {});
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
  idbPutInspection(copy).catch(() => {});
  idbEnqueueMutation({ kind: "create", inspectionId: copy.id, data: copy.data })
    .then(refreshPending)
    .then(flushSyncQueue)
    .then(requestBackgroundSync)
    .catch(() => {});
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
