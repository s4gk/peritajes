"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { StoredInspection } from "@/lib/types";

/**
 * Persistencia local del peritaje. Usa IndexedDB para que la data sobreviva
 * recargas (incluso offline) y para encolar las mutations que el server no
 * pudo recibir. La capa superior (lib/inspections-store) consume esto y
 * presenta una API síncrona vía un memory cache que se hidrata desde acá.
 */

export type MutationKind = "create" | "update" | "delete";

export type PendingMutation = {
  /** Auto-increment local. La queue se procesa en orden ascendente. */
  id?: number;
  kind: MutationKind;
  inspectionId: string;
  /** Para create/update: el snapshot completo del data. Para delete: undefined. */
  data?: StoredInspection["data"];
  /** Cuándo se encoló (para detectar mutations atascadas y para mostrar al usuario). */
  enqueuedAt: string;
  /** Reintentos. Útil para diagnóstico cuando el server rechaza repetidamente. */
  attempts: number;
  lastError?: string;
  /** ISO del último intento. Sirve para espaciar reintentos de mutations que
   *  ya superaron MAX_ATTEMPTS sin sacarlas de la cola (ver sync-queue). */
  lastAttemptAt?: string;
};

interface PeritoDB extends DBSchema {
  inspections: {
    key: string;
    value: StoredInspection;
  };
  mutations: {
    key: number;
    value: PendingMutation;
    indexes: { "by-inspection": string };
  };
}

const DB_NAME = "perito-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PeritoDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<PeritoDB>> {
  if (typeof window === "undefined") {
    throw new Error("IDB no está disponible en el servidor.");
  }
  if (!dbPromise) {
    dbPromise = openDB<PeritoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("inspections")) {
          db.createObjectStore("inspections", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("mutations")) {
          const store = db.createObjectStore("mutations", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("by-inspection", "inspectionId");
        }
      },
    });
  }
  return dbPromise;
}

/* ------------------------------ Inspections ------------------------------ */

export async function idbListInspections(): Promise<StoredInspection[]> {
  const db = await getDb();
  return db.getAll("inspections");
}

export async function idbGetInspection(id: string): Promise<StoredInspection | undefined> {
  const db = await getDb();
  return db.get("inspections", id);
}

export async function idbPutInspection(insp: StoredInspection): Promise<void> {
  const db = await getDb();
  await db.put("inspections", insp);
}

export async function idbPutInspections(list: StoredInspection[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("inspections", "readwrite");
  await Promise.all(list.map((i) => tx.store.put(i)));
  await tx.done;
}

export async function idbDeleteInspection(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("inspections", id);
}

/* ------------------------------ Mutations ------------------------------ */

export async function idbEnqueueMutation(
  mutation: Omit<PendingMutation, "id" | "enqueuedAt" | "attempts">,
): Promise<number> {
  const db = await getDb();
  const tx = db.transaction("mutations", "readwrite");
  // Coalesce: si la última mutation pendiente para la misma inspección es del
  // mismo tipo (típicamente "update"), reemplazamos su payload en lugar de
  // apilar otra. Evita que un perito que tipea rápido sin red genere 50
  // mutations idénticas.
  const idx = tx.store.index("by-inspection");
  let cursor = await idx.openCursor(mutation.inspectionId, "prev");
  if (cursor && cursor.value.kind === mutation.kind && mutation.kind === "update") {
    const merged: PendingMutation = {
      ...cursor.value,
      data: mutation.data,
      enqueuedAt: new Date().toISOString(),
    };
    await cursor.update(merged);
    await tx.done;
    return cursor.value.id!;
  }
  const id = await tx.store.add({
    ...mutation,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
  } as PendingMutation);
  await tx.done;
  return id as number;
}

export async function idbListMutations(): Promise<PendingMutation[]> {
  const db = await getDb();
  return db.getAll("mutations");
}

export async function idbCountMutations(): Promise<number> {
  const db = await getDb();
  return db.count("mutations");
}

export async function idbRemoveMutation(id: number): Promise<void> {
  const db = await getDb();
  await db.delete("mutations", id);
}

export async function idbUpdateMutation(m: PendingMutation): Promise<void> {
  const db = await getDb();
  await db.put("mutations", m);
}

export async function idbRemoveMutationsForInspection(inspectionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("mutations", "readwrite");
  const keys = await tx.store.index("by-inspection").getAllKeys(inspectionId);
  await Promise.all(keys.map((k) => tx.store.delete(k)));
  await tx.done;
}

export async function idbClearAll(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear("inspections"), db.clear("mutations")]);
}
