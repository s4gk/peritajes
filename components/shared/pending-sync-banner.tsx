"use client";

import * as React from "react";
import { CloudOff, LogIn, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  flushSyncQueue,
  INITIAL_SYNC_STATE,
  subscribeSync,
  type SyncState,
} from "@/lib/client/sync-queue";

/** Cuánto esperamos con señal antes de avisar que algo no ha subido (subir
 *  un peritaje con fotos puede tardar unos segundos; no queremos parpadeos). */
const STUCK_AFTER_MS = 60_000;

function plural(n: number) {
  return n === 1 ? "1 peritaje sin subir" : `${n} peritajes sin subir`;
}

/**
 * Aviso visible en el panel (en celular el sidebar con el estado de sync va
 * escondido en el menú) cuando hay peritajes sin subir:
 *  - Sesión vencida → pide volver a iniciar sesión (la cola NO se pierde).
 *  - Sin señal → avisa que suben solos al volver la conexión. Importante en
 *    iPhone: no hay Background Sync, solo suben con la app abierta.
 *  - Con señal pero atascado > 1 min → botón "Reintentar ahora".
 */
export function PendingSyncBanner() {
  const [state, setState] = React.useState<SyncState>(INITIAL_SYNC_STATE);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => subscribeSync(setState), []);
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const n = state.pendingInspections;
  if (n === 0) return null;

  let icon = <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />;
  let title: string;
  let body: string;
  let action: React.ReactNode = null;

  if (state.authRequired) {
    icon = <LogIn className="mt-0.5 h-4 w-4 shrink-0" />;
    title = "Tu sesión se venció";
    body = `Tienes ${plural(n)}. Están guardados en este celular: inicia sesión otra vez (con tu mismo usuario) y suben solos.`;
    action = (
      <Button size="sm" variant="secondary" onClick={() => window.location.assign("/login")}>
        Iniciar sesión
      </Button>
    );
  } else if (!state.online) {
    title = `Tienes ${plural(n)}`;
    body =
      "Están guardados en este celular y se suben solos cuando vuelva la señal. En iPhone, abre la app cuando tengas conexión para que suban.";
  } else {
    const oldest = state.oldestPendingAt ? new Date(state.oldestPendingAt).getTime() : now;
    if (state.syncing || now - oldest < STUCK_AFTER_MS) return null;
    icon = <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />;
    title = `Tienes ${plural(n)}`;
    body = state.lastErrorMessage
      ? `No se han podido subir todavía (${state.lastErrorMessage}). Se reintenta solo.`
      : "Todavía no han subido. Se reintenta solo.";
    action = (
      <Button size="sm" variant="secondary" onClick={() => void flushSyncQueue()}>
        Reintentar ahora
      </Button>
    );
  }

  return (
    <div
      role="status"
      data-testid="pending-sync-banner"
      className="mt-3 flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 text-warning">
        {icon}
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{body}</div>
        </div>
      </div>
      {action}
    </div>
  );
}
