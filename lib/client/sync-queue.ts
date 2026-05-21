"use client";

import type { StoredInspection } from "@/lib/types";

import { apiFetch } from "./api-client";
import {
  idbCountMutations,
  idbListMutations,
  idbRemoveMutation,
  idbUpdateMutation,
  type PendingMutation,
} from "./idb";

/**
 * Callback opcional que inspections-store registra para enterarse de la
 * versión "canónica" devuelta por el server cuando un PUT/POST se aplica.
 * Lo usamos para propagar al cliente datos que solo el server conoce — por
 * ejemplo, el `reportNumber` asignado al finalizar el peritaje.
 */
type SyncedInspectionHandler = (insp: StoredInspection) => void;
let syncedHandler: SyncedInspectionHandler | null = null;
export function setSyncedInspectionHandler(
  fn: SyncedInspectionHandler | null,
): void {
  syncedHandler = fn;
}

/**
 * Procesador de mutations en cola. Replay FIFO, una a la vez, con retry sobre
 * el evento `online` y a un intervalo de respaldo. Los suscriptores reciben
 * cambios en `pending` (cuántas mutations quedan) para que la UI pinte un
 * badge "X cambios sin sincronizar".
 */

const RETRY_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 12;

let running = false;
let listeners: Array<(state: SyncState) => void> = [];
let retryTimer: ReturnType<typeof setInterval> | null = null;
let lastState: SyncState = { pending: 0, online: true, syncing: false };

export type SyncState = {
  pending: number;
  online: boolean;
  syncing: boolean;
};

function notify(partial: Partial<SyncState>) {
  lastState = { ...lastState, ...partial };
  for (const fn of listeners) fn(lastState);
}

export function subscribeSync(fn: (state: SyncState) => void): () => void {
  listeners.push(fn);
  fn(lastState);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function getSyncState(): SyncState {
  return lastState;
}

/** Empuja la cuenta actual de mutations al estado público. */
export async function refreshPending(): Promise<void> {
  try {
    const pending = await idbCountMutations();
    notify({ pending });
  } catch {
    /* noop */
  }
}

/**
 * Pide al browser que dispare un `sync` event cuando haya red. Esto deja la
 * queue corriendo aun si el perito cerró la tab — el OS replaya por nosotros
 * via el handler en sw.js. Si Background Sync no existe (Safari < 17.4,
 * Firefox), no pasa nada: la queue cliente cubre el caso al re-abrir.
 */
const SYNC_TAG = "perito-flush-queue";
export async function requestBackgroundSync(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sync = (reg as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }).sync;
    if (sync?.register) {
      await sync.register(SYNC_TAG);
    }
  } catch {
    /* no soportado o permiso negado — silencioso */
  }
}

async function applyMutation(m: PendingMutation): Promise<{ ok: boolean; error?: string }> {
  try {
    if (m.kind === "create") {
      const res = await apiFetch("/api/inspections", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: m.inspectionId, data: m.data }),
      });
      if (res.status === 409 || res.ok) return { ok: true };
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    if (m.kind === "update") {
      const res = await apiFetch(`/api/inspections/${encodeURIComponent(m.inspectionId)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: m.data }),
      });
      if (res.ok) {
        // Parseamos la respuesta para enterarnos de campos que solo el server
        // asigna (en particular el consecutivo oficial al finalizar). Si el
        // parseo falla seguimos — el dato eventualmente se hidrata desde el
        // GET de boot.
        try {
          const json = (await res.json()) as { inspection?: StoredInspection };
          if (json.inspection && syncedHandler) syncedHandler(json.inspection);
        } catch {
          /* ignore */
        }
        return { ok: true };
      }
      // Si el server dice 404, probablemente el create se quedó atrás. Lo
      // forzamos a create (idempotente) y reintentamos en la próxima vuelta.
      if (res.status === 404) {
        await apiFetch("/api/inspections", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: m.inspectionId, data: m.data }),
        }).catch(() => {});
        return { ok: false, error: "404 — recreado, reintentando" };
      }
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    if (m.kind === "delete") {
      const res = await apiFetch(`/api/inspections/${encodeURIComponent(m.inspectionId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      // 404 = ya borrada en el server, OK.
      if (res.ok || res.status === 404) return { ok: true };
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    return { ok: false, error: "kind desconocido" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network" };
  }
}

export async function flushSyncQueue(): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  running = true;
  notify({ syncing: true });
  try {
    let mutations = await idbListMutations();
    // Procesamos en orden de id (FIFO).
    mutations.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    for (const m of mutations) {
      const result = await applyMutation(m);
      if (result.ok) {
        if (m.id !== undefined) await idbRemoveMutation(m.id);
        await refreshPending();
      } else {
        const next: PendingMutation = {
          ...m,
          attempts: m.attempts + 1,
          lastError: result.error,
        };
        if (next.attempts >= MAX_ATTEMPTS) {
          // Damos hasta MAX_ATTEMPTS reintentos. Pasado eso lo dejamos en cola
          // pero el badge va a quedar amarillo — un humano tiene que mirar.
        }
        await idbUpdateMutation(next);
        // No spammeamos al server: si una falla, paramos esta corrida y
        // esperamos al próximo trigger (online/intervalo).
        break;
      }
    }
  } finally {
    running = false;
    notify({ syncing: false });
  }
}

export function startSyncWatcher() {
  if (typeof window === "undefined") return;
  notify({ online: navigator.onLine });
  refreshPending();

  const onOnline = () => {
    notify({ online: true });
    flushSyncQueue();
  };
  const onOffline = () => notify({ online: false });

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(() => {
    if (navigator.onLine) flushSyncQueue();
  }, RETRY_INTERVAL_MS);

  // Primer flush al boot por si quedaron mutations de una sesión previa.
  if (navigator.onLine) flushSyncQueue();
}
