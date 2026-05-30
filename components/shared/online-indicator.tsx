"use client";

import * as React from "react";
import { AlertTriangle, CloudOff, RefreshCw, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  flushSyncQueue,
  refreshPending,
  subscribeSync,
  type SyncState,
} from "@/lib/client/sync-queue";

/**
 * Chip de estado de conexión + sync queue. Tres estados visuales:
 *   - online y queue vacía → no se muestra (cero ruido en flujo normal)
 *   - online con queue pendiente → "Sincronizando X cambios"
 *   - offline → "Sin conexión"
 */
export function OnlineIndicator() {
  const [state, setState] = React.useState<SyncState>({
    online: true,
    pending: 0,
    syncing: false,
    failed: 0,
    lastErrorMessage: null,
    firstFailedInspectionId: null,
    firstFailedKind: null,
    oldestPendingAt: null,
  });

  React.useEffect(() => {
    const unsub = subscribeSync(setState);
    refreshPending();
    return unsub;
  }, []);

  if (
    state.online &&
    state.pending === 0 &&
    !state.syncing &&
    state.failed === 0
  )
    return null;

  const isOffline = !state.online;
  const hasFailed = state.failed > 0;

  return (
    <button
      type="button"
      onClick={() => {
        // Click siempre fuerza un flush — para failed sirve igual: la cola
        // los reintenta cuando vence el FAILED_RETRY_INTERVAL_MS, pero el
        // usuario puede querer disparar antes.
        if (state.online) flushSyncQueue();
      }}
      title={
        hasFailed
          ? state.lastErrorMessage
            ? `Sin subir: ${state.lastErrorMessage}`
            : `${state.failed} cambio(s) sin subir`
          : isOffline
            ? "Sin conexión. Tus cambios se guardan local y se sincronizan al volver la red."
            : `Sincronizando ${state.pending} cambios pendientes`
      }
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
        hasFailed
          ? "border-danger/50 bg-danger/10 text-danger"
          : isOffline
            ? "border-warning/50 bg-warning/10 text-warning"
            : "border-primary/40 bg-primary/10 text-primary",
      )}
    >
      {hasFailed ? (
        <>
          <AlertTriangle className="h-3.5 w-3.5" />
          {state.failed} sin subir
        </>
      ) : isOffline ? (
        <>
          <WifiOff className="h-3.5 w-3.5" />
          Sin conexión
          {state.pending > 0 && (
            <span className="ml-0.5 rounded bg-warning/20 px-1 text-[10px]">
              {state.pending}
            </span>
          )}
        </>
      ) : state.syncing ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Sincronizando
        </>
      ) : (
        <>
          <CloudOff className="h-3.5 w-3.5" />
          {state.pending} pendiente{state.pending === 1 ? "" : "s"}
        </>
      )}
    </button>
  );
}
