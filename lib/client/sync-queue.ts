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
/** Estado antes de que arranque el watcher. Los componentes lo usan como
 *  estado inicial para que el primer render coincida con el HTML del server. */
export const INITIAL_SYNC_STATE: SyncState = {
  pending: 0,
  pendingInspections: 0,
  online: true,
  syncing: false,
  failed: 0,
  lastErrorMessage: null,
  firstFailedInspectionId: null,
  firstFailedKind: null,
  oldestPendingAt: null,
  authRequired: false,
};
let lastState: SyncState = INITIAL_SYNC_STATE;

export type SyncState = {
  /** Cantidad total de mutations en cola (incluye las marcadas como failed). */
  pending: number;
  /** Cuántos peritajes distintos tienen cambios sin subir (lo que se le
   *  muestra al perito: "tienes 2 peritajes sin subir"). */
  pendingInspections: number;
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
  /** True si el server respondió 401 (sesión vencida) o 403 csrf_invalid al
   *  sincronizar. La cola NO se pierde: queda esperando a que el perito vuelva
   *  a iniciar sesión (con el mismo usuario) y ahí sube sola. */
  authRequired: boolean;
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
      pendingInspections: new Set(list.map((m) => m.inspectionId)).size,
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

type ApplyResult = {
  ok: boolean;
  error?: string;
  /** No hubo respuesta del server (sin señal, server caído). No cuenta como
   *  intento: estar sin red horas no debe marcar nada como "fallido". */
  network?: boolean;
  /** Sesión vencida (401) o cookie CSRF inválida (403 csrf_invalid). No cuenta
   *  como intento: se resuelve volviendo a iniciar sesión. */
  auth?: boolean;
};

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 401 o 403 por CSRF → hay que volver a iniciar sesión. */
async function authProblem(res: Response): Promise<boolean> {
  if (res.status === 401) return true;
  if (res.status !== 403) return false;
  const body = await readJson<{ error?: string }>(res.clone());
  return body?.error === "csrf_invalid";
}

async function applyMutation(m: PendingMutation): Promise<ApplyResult> {
  try {
    if (m.kind === "create") {
      const res = await apiFetch("/api/inspections", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: m.inspectionId, data: m.data }),
      });
      if (res.status === 409 || res.ok) return { ok: true };
      if (await authProblem(res)) return { ok: false, auth: true, error: `${res.status} sesión` };
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
        const json = await readJson<{
          inspection?: StoredInspection;
          pdfStatus?: "ok" | "not_applicable" | "pending";
          pdfError?: string;
        }>(res);
        if (json?.inspection && syncedHandler) syncedHandler(json.inspection);
        // Si el PDF quedó pendiente (Puppeteer falló inline), disparamos un
        // evento para que la UI muestre un banner con la opción de reintentar
        // la descarga, en lugar de creer que todo quedó bien.
        if (
          json?.pdfStatus === "pending" &&
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
        return { ok: true };
      }
      if (await authProblem(res)) return { ok: false, auth: true, error: `${res.status} sesión` };
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
        const json = await readJson<{ inspection?: StoredInspection }>(res);
        if (json?.inspection && syncedHandler) syncedHandler(json.inspection);
        return { ok: true };
      }
      // 403 Forbidden con la versión canónica: un perito intentando editar un
      // informe ya finalizado (solo dueño/admin pueden). Reintentar nunca va a
      // funcionar; descartamos la mutación y aplicamos la versión del server
      // para que el wizard se reabra en solo-lectura con los datos reales.
      // Un 403 SIN versión canónica ("Sin permisos" genérico) NO se descarta:
      // queda en la cola como fallida (badge rojo) para no perder datos en
      // silencio; el perito puede reintentarla o limpiarla a mano.
      if (res.status === 403) {
        const json = await readJson<{ inspection?: StoredInspection; error?: string }>(res);
        if (json?.inspection) {
          if (syncedHandler) syncedHandler(json.inspection);
          return { ok: true };
        }
        return { ok: false, error: `403 ${json?.error ?? res.statusText}` };
      }
      // Si el server dice 404, el create se quedó atrás (o se perdió). Lo
      // recreamos como BORRADOR aunque el update ya venga finalizado: si
      // creáramos la fila directamente "completed", el server nunca pasaría
      // por el cierre (consecutivo + PDF). La próxima vuelta reintenta este
      // mismo PUT, que ahora sí encuentra la fila y la finaliza.
      if (res.status === 404) {
        const draft = m.data
          ? { ...m.data, status: "draft" as const, completedAt: undefined }
          : m.data;
        await apiFetch("/api/inspections", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: m.inspectionId, data: draft }),
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
      if (await authProblem(res)) return { ok: false, auth: true, error: `${res.status} sesión` };
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    return { ok: false, error: "kind desconocido" };
  } catch (err) {
    return {
      ok: false,
      network: true,
      error: err instanceof Error ? err.message : "network",
    };
  }
}

/** Nombre del Web Lock que comparten esta cola y el Background Sync del
 *  service worker (public/sw.js): así nunca replayan la cola a la vez (dos
 *  flushes en paralelo mandaban el mismo create/update dos veces y podían
 *  desordenarse). */
export const SYNC_LOCK_NAME = "perito-sync-queue";

async function withSyncLock(fn: () => Promise<void>): Promise<void> {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;
  if (locks?.request) {
    await locks.request(SYNC_LOCK_NAME, fn);
    return;
  }
  await fn();
}

export async function flushSyncQueue(): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  running = true;
  notify({ syncing: true });
  try {
    await withSyncLock(flushLocked);
  } finally {
    running = false;
    notify({ syncing: false });
  }
}

async function flushLocked(): Promise<void> {
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
  // Peritajes con una mutación anterior todavía pendiente en esta corrida.
  // NUNCA mandamos una mutación si una anterior del MISMO peritaje quedó
  // atrás: un update que se adelanta a su create recibe 404, y uno que se
  // adelanta a otro update pisaría datos más nuevos con viejos.
  const blocked = new Set<string>();
  // Soft-skip: si una mutation ya pasó MAX_ATTEMPTS y la última lectura
  // ocurrió hace menos de FAILED_RETRY_INTERVAL_MS, la dejamos para más
  // tarde. Así no quemamos el server reintentando cada 30s una mutation
  // que falla siempre, pero igual le damos una chance periódica de pasar
  // si la falla fue transitoria.
  const now = Date.now();
  for (const m of mutations) {
    if (blocked.has(m.inspectionId)) continue;
    if (m.attempts >= MAX_ATTEMPTS) {
      // Los errores 422 son permanentes (dato inválido) — los reintentamos
      // inmediatamente para que el handler los descarte en esta misma vuelta,
      // sin esperar el cooldown de 5 min.
      const is422 = m.lastError?.startsWith("422");
      if (!is422) {
        const lastAttempt = m.lastAttemptAt
          ? new Date(m.lastAttemptAt).getTime()
          : 0;
        if (now - lastAttempt < FAILED_RETRY_INTERVAL_MS) {
          blocked.add(m.inspectionId);
          continue;
        }
      }
    }
    const result = await applyMutation(m);
    if (result.ok) {
      if (m.id !== undefined) await idbRemoveMutation(m.id);
      // Limpiamos el último error cuando una mutation pasa — la UI vuelve a
      // verde si no queda nada en estado failed.
      notify({ lastErrorMessage: null, authRequired: false });
      continue;
    }
    // Sin red o sesión vencida: no es culpa de la mutación, así que no suma
    // intento (si no, unas horas sin señal la marcaban "fallida"). Paramos la
    // corrida: las siguientes van a fallar por lo mismo.
    const countsAsAttempt = !result.network && !result.auth;
    const next: PendingMutation = {
      ...m,
      attempts: countsAsAttempt ? m.attempts + 1 : m.attempts,
      lastError: result.error,
      lastAttemptAt: new Date().toISOString(),
    };
    await idbUpdateMutation(next);
    if (result.auth) notify({ authRequired: true });
    // No spammeamos al server: si una falla, paramos esta corrida y
    // esperamos al próximo trigger (online/intervalo). El estado público
    // se actualiza con la cuenta de failed después del refresh de abajo.
    await refreshPending();
    return;
  }
  await refreshPending();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("perito:sync-flushed"));
  }
}

let watching = false;

export function startSyncWatcher() {
  if (typeof window === "undefined") return;
  notify({ online: navigator.onLine });
  refreshPending();
  // initStore() puede volver a correr (p.ej. tras wipeLocalUserData): los
  // listeners se instalan una sola vez, si no cada evento dispara N flushes.
  if (watching) {
    if (navigator.onLine) flushSyncQueue();
    return;
  }
  watching = true;

  const onOnline = () => {
    notify({ online: true });
    flushSyncQueue();
  };
  const onOffline = () => notify({ online: false });

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  // iOS no tiene Background Sync: la cola solo avanza con la app abierta.
  // Reintentamos cada vez que el perito vuelve a la app (primer plano).
  const onVisible = () => {
    if (document.visibilityState === "visible" && navigator.onLine) flushSyncQueue();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);

  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(() => {
    if (navigator.onLine) flushSyncQueue();
  }, RETRY_INTERVAL_MS);

  // Primer flush al boot por si quedaron mutations de una sesión previa.
  if (navigator.onLine) flushSyncQueue();
}
