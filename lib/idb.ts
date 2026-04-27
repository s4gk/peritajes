"use client";

/**
 * Minimal promise-based IndexedDB wrapper for the Perito app.
 * Only stores what we actually need: a single object store keyed by inspection id.
 */

const DB_NAME = "perito";
const DB_VERSION = 1;
const STORE = "inspections";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  runner: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | void> {
  return openDb().then(
    (db) =>
      new Promise<T | void>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const req = runner(store);
        transaction.oncomplete = () => {
          resolve(req ? (req.result as T) : undefined);
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

export async function idbGetAll<T>(): Promise<T[]> {
  const result = await tx<T[]>("readonly", (store) => store.getAll());
  return (result as T[]) ?? [];
}

export async function idbPut<T extends { id: string }>(value: T): Promise<void> {
  await tx("readwrite", (store) => store.put(value));
}

export async function idbDelete(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}

export async function idbClear(): Promise<void> {
  await tx("readwrite", (store) => store.clear());
}

export function isIdbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
