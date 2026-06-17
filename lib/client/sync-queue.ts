"use client";

import type { StoredInspection } from "@/lib/types";

import { apiFetch } from "./api-client";
import {
  idbGetInspection,
  idbListMutations,
  idbPutInspection,
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
// Soft cap: pasado este número de intentos consideramos la mutación "fallida"
// para efectos de UI (badge rojo + advertencia en el SaveIndicator). NO la
// borramos de la queue — la app sigue reintentando, pero a un intervalo más
// espaciado (FAILED_RETRY_INTERVAL_MS) para no quemar CPU/red ni spamear
// errores en logs. Si eventualmente el server vuelve a aceptar (p.ej. caída
// transitoria de DB), la mutación pasa y todo vuelve a verde solo.
const MAX_ATTEMPTS = 12;
const FAILED_RETRY_INTERVAL_MS = 5 * 60_000;

let running = false;
let listeners: Array<(state: SyncState) => void> = [];
let retryTimer: ReturnType<typeof setInterval> | null = null;
let lastState: SyncState = {
  pending: 0,
  online: true,
  syncing: false,
  failed: 0,
  lastErrorMessage: null,
  firstFailedInspectionId: null,
  firstFailedKind: null,
  oldestPendingAt: null,
};

export type SyncState = {
  /** Cantidad total de mutations en cola (incluye las marcadas como failed). */
  pending: number;
  /** Estado de conectividad reportado por el browser. */
  online: boolean;
  /** True mientras una corrida de flush está activa. */
  syncing: boolean;
  /** Cuántas mutations excedieron MAX_ATTEMPTS — disparan el badge rojo. */
  failed: number;
  /** Último mensaje de error que devolvió el server. null si nada falló o si
   *  el último intento fue exitoso. */
  lastErrorMessage: string | null;
  /** ID del peritaje de la primera mutation fallida (para mostrar al usuario). */
  firstFailedInspectionId: string | null;
  /** Tipo de operación de la primera mutation fallida. */
  firstFailedKind: "create" | "update" | "delete" | null;
  /** ISO timestamp de la mutation más vieja pendiente. Permite mostrar
   *  "pendiente desde hace 5min" en la UI. */
  oldestPendingAt: string | null;
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

/**
 * Borra del IDB todas las mutaciones que pasaron MAX_ATTEMPTS. Lo usa el
 * sidebar cuando el perito aprieta "Limpiar fallidos" — caso típico: peritajes
 * fantasma de versiones viejas que el server rechaza con 400 (schema
 * mismatch). Devuelve cuántas se borraron para reportar al user.
 */
export async function clearFailedMutations(): Promise<{ removed: number }> {
  const list = await idbListMutations();
  let removed = 0;
  for (const m of list) {
    if (m.attempts >= MAX_ATTEMPTS && m.id !== undefined) {
      await idbRemoveMutation(m.id);
      removed += 1;
    }
  }
  await refreshPending();
  return { removed };
}

/**
 * Reinicia el contador de intentos de las mutaciones fallidas y fuerza un
 * flush. Útil si la causa del fail fue transitoria (server caído, dominio
 * cambió) y ahora podría pasar.
 */
export async function retryFailedMutations(): Promise<{ retried: number }> {
  const list = await idbListMutations();
  let retried = 0;
  for (const m of list) {
    if (m.attempts >= MAX_ATTEMPTS) {
      await idbUpdateMutation({
        ...m,
        attempts: 0,
        lastError: undefined,
        lastAttemptAt: undefined,
      });
      retried += 1;
    }
  }
  await refreshPending();
  if (retried > 0 && typeof navigator !== "undefined" && navigator.onLine) {
    void flushSyncQueue();
  }
  return { retried };
}

/** Empuja la cuenta actual de mutations al estado público, incluyendo
 *  desglose de fallidas y el timestamp más viejo en cola. */
export async function refreshPending(): Promise<void> {
  try {
    const list = await idbListMutations();
    let failed = 0;
    let oldest: string | null = null;
    let lastErr: string | null = null;
    let firstFailedId: string | null = null;
    let firstFailedKind: "create" | "update" | "delete" | null = null;
    for (const m of list) {
      if (m.attempts >= MAX_ATTEMPTS) {
        failed += 1;
        if (!firstFailedId) {
          firstFailedId = m.inspectionId;
          firstFailedKind = m.kind;
        }
        if (m.lastError) lastErr = m.lastError;
      }
      if (!oldest || m.enqueuedAt < oldest) oldest = m.enqueuedAt;
    }
    notify({
      pending: list.length,
      failed,
      oldestPendingAt: oldest,
      lastErrorMessage: failed > 0 ? lastErr : lastState.lastErrorMessage,
      firstFailedInspectionId: failed > 0 ? firstFailedId : null,
      firstFailedKind: failed > 0 ? firstFailedKind : null,
    });
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
          const json = (await res.json()) as {
            inspection?: StoredInspection;
            pdfStatus?: "ok" | "not_applicable" | "pending";
            pdfError?: string;
          };
          if (json.inspection && syncedHandler) syncedHandler(json.inspection);
          // Si el PDF quedó pendiente (Puppeteer/Gemini falló inline),
          // disparamos un evento para que la UI muestre un banner con la
          // opción de reintentar la descarga, en lugar de creer que todo
          // quedó bien.
          if (
            json.pdfStatus === "pending" &&
            typeof window !== "undefined" &&
            json.inspection?.id
          ) {
            window.dispatchEvent(
              new CustomEvent("perito:pdf-pending", {
                detail: {
                  inspectionId: json.inspection.id,
                  error: json.pdfError ?? null,
                },
              }),
            );
          }
        } catch {
          /* ignore */
        }
        return { ok: true };
      }
      // 422 Unprocessable: el servidor rechaza los datos por un error de
      // validación (ej. falta teléfono del cliente). Reintentar nunca va a
      // funcionar — descartamos la mutación y revertimos el peritaje a borrador
      // en IDB para que el perito corrija el dato faltante y vuelva a finalizar.
      if (res.status === 422) {
        const cached = await idbGetInspection(m.inspectionId).catch(() => undefined);
        if (cached && cached.data.status === "completed") {
          const reverted: StoredInspection = {
            ...cached,
            data: { ...cached.data, status: "draft", completedAt: undefined },
          };
          await idbPutInspection(reverted).catch(() => {});
          if (syncedHandler) syncedHandler(reverted);
        }
        return { ok: true };
      }
      // 423 Locked: el peritaje ya quedó finalizado en server. Descartamos la
      // mutación (no tiene sentido reintentar) y aplicamos la versión canónica
      // del server al cache para que el wizard se reabra en modo solo-lectura.
      if (res.status === 423) {
        try {
          const json = (await res.json()) as { inspection?: StoredInspection };
          if (json.inspection && syncedHandler) syncedHandler(json.inspection);
        } catch {
          /* ignore */
        }
        return { ok: true };
      }
      // 403 Forbidden: el server rechazó la edición por permisos — típicamente
      // un perito intentando editar un informe ya finalizado (solo dueño/admin
      // pueden). Reintentar nunca va a funcionar; descartamos la mutación y, si
      // el server mandó la versión canónica, la aplicamos para que el wizard se
      // reabra en solo-lectura con los datos reales.
      if (res.status === 403) {
        try {
          const json = (await res.json()) as { inspection?: StoredInspection };
          if (json.inspection && syncedHandler) syncedHandler(json.inspection);
        } catch {
          /* sin cuerpo canónico (forbidden genérico) — igual descartamos */
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
    // Descartamos mutations huérfanas: si la inspección ya no existe en IDB y
    // la mutation no es un delete, no tiene sentido enviarla al server.
    for (const m of mutations) {
      if (m.kind !== "delete") {
        const cached = await idbGetInspection(m.inspectionId).catch(() => undefined);
        if (!cached && m.id !== undefined) {
          await idbRemoveMutation(m.id);
        }
      }
    }
    mutations = await idbListMutations();
    // Procesamos en orden de id (FIFO).
    mutations.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    // Soft-skip: si una mutation ya pasó MAX_ATTEMPTS y la última lectura
    // ocurrió hace menos de FAILED_RETRY_INTERVAL_MS, la dejamos para más
    // tarde. Así no quemamos el server reintentando cada 30s una mutation
    // que falla siempre, pero igual le damos una chance periódica de pasar
    // si la falla fue transitoria.
    const now = Date.now();
    for (const m of mutations) {
      if (m.attempts >= MAX_ATTEMPTS) {
        // Los errores 422 son permanentes (dato inválido) — los reintentamos
        // inmediatamente para que el handler los descarte en esta misma vuelta,
        // sin esperar el cooldown de 5 min.
        const is422 = m.lastError?.startsWith("422");
        if (!is422) {
          const lastAttempt = m.lastAttemptAt
            ? new Date(m.lastAttemptAt).getTime()
            : 0;
          if (now - lastAttempt < FAILED_RETRY_INTERVAL_MS) continue;
        }
      }
      const result = await applyMutation(m);
      if (result.ok) {
        if (m.id !== undefined) await idbRemoveMutation(m.id);
        // Limpiamos el último error cuando una mutation pasa — la UI vuelve a
        // verde si no queda nada en estado failed.
        notify({ lastErrorMessage: null });
      } else {
        const next: PendingMutation = {
          ...m,
          attempts: m.attempts + 1,
          lastError: result.error,
          lastAttemptAt: new Date().toISOString(),
        };
        await idbUpdateMutation(next);
        // No spammeamos al server: si una falla, paramos esta corrida y
        // esperamos al próximo trigger (online/intervalo). El estado público
        // se actualiza con la cuenta de failed después del refresh de abajo.
        await refreshPending();
        return;
      }
    }
    await refreshPending();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("perito:sync-flushed"));
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
