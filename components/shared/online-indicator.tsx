"use client";

import * as React from "react";
import { CloudOff, RefreshCw, WifiOff } from "lucide-react";

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
  });

  React.useEffect(() => {
    const unsub = subscribeSync(setState);
    refreshPending();
    return unsub;
  }, []);

  if (state.online && state.pending === 0 && !state.syncing) return null;

  const isOffline = !state.online;

  return (
    <button
      type="button"
      onClick={() => {
        if (state.online) flushSyncQueue();
      }}
      title={
        isOffline
          ? "Sin conexión. Tus cambios se guardan local y se sincronizan al volver la red."
          : `Sincronizando ${state.pending} cambios pendientes`
      }
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
        isOffline
          ? "border-warning/50 bg-warning/10 text-warning"
          : "border-primary/40 bg-primary/10 text-primary",
      )}
    >
      {isOffline ? (
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
