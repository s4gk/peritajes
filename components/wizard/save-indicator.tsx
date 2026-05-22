"use client";

import * as React from "react";
import { AlertTriangle, Check, CloudOff, CloudUpload, Loader2 } from "lucide-react";

import { subscribeSync, type SyncState } from "@/lib/client/sync-queue";
import { cn } from "@/lib/utils";
import { useInspection } from "./inspection-context";

function formatRelative(ts: number | null, now: number): string {
  if (!ts) return "";
  const delta = Math.max(0, Math.floor((now - ts) / 1000));
  if (delta < 5) return "justo ahora";
  if (delta < 60) return `hace ${delta}s`;
  const mins = Math.floor(delta / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

/**
 * Indicador combinado de autosave + estado de la cola de sincronización.
 *
 * Niveles de severidad (de peor a mejor):
 *  - failed > 0    → rojo. Algún cambio quedó atascado después de muchos
 *                    reintentos. El perito tiene que avisar a soporte.
 *  - !online       → ámbar. Sin conexión: lo guardado vive solo en este
 *                    dispositivo hasta que vuelva la red.
 *  - pending > 0   → ámbar suave. Hay cambios encolados todavía no subidos.
 *  - saving/pending de autosave → "Guardando…" gris.
 *  - saved         → verde con "Guardado hace Xm".
 *  - idle inicial  → "Listo" gris.
 *
 * El estado del autosave (`saveStatus`) solo cubre el ciclo IDB; los cambios
 * todavía tienen que viajar al server. Sin sumar el sync state, el perito veía
 * "Guardado" aunque la mutación nunca llegara a Postgres.
 */
export function SaveIndicator({ className }: { className?: string }) {
  const { saveStatus, lastSavedAt } = useInspection();
  const [now, setNow] = React.useState(() => Date.now());
  const [sync, setSync] = React.useState<SyncState | null>(null);

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => subscribeSync(setSync), []);

  // Estado de error: alguna mutation quedó atascada después de MAX_ATTEMPTS.
  // Es la única señal de "tu peritaje puede no haber llegado al server".
  if (sync && sync.failed > 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium text-danger",
          className,
        )}
        title={sync.lastErrorMessage ?? undefined}
      >
        <AlertTriangle className="h-3 w-3" />
        {sync.failed === 1
          ? "1 cambio sin subir"
          : `${sync.failed} cambios sin subir`}
      </span>
    );
  }

  // Sin conexión: lo guardamos local pero todavía no llegó al server.
  if (sync && !sync.online) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium text-warning",
          className,
        )}
      >
        <CloudOff className="h-3 w-3" />
        Sin conexión · {sync.pending > 0 ? `${sync.pending} pend.` : "guardado local"}
      </span>
    );
  }

  if (saveStatus === "saving" || saveStatus === "pending" || (sync && sync.syncing)) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Guardando...
      </span>
    );
  }

  // Pendientes "limpios" (sin error y sin reintentos colgados): hay cambios en
  // la cola pero la corrida todavía no arrancó. Damos visibilidad suave.
  if (sync && sync.pending > 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground",
          className,
        )}
      >
        <CloudUpload className="h-3 w-3" />
        {sync.pending === 1
          ? "1 cambio pendiente"
          : `${sync.pending} cambios pendientes`}
      </span>
    );
  }

  if (saveStatus === "saved" || lastSavedAt) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium text-success",
          className,
        )}
      >
        <Check className="h-3 w-3" />
        Guardado {lastSavedAt ? formatRelative(lastSavedAt, now) : ""}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <CloudUpload className="h-3 w-3" />
      Listo
    </span>
  );
}
