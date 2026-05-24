"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  clearFailedMutations,
  retryFailedMutations,
  subscribeSync,
  type SyncState,
} from "@/lib/client/sync-queue";
import { getStorageUsagePct } from "@/lib/client/image-compress";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Pill compacta de estado del sync queue. Va en el footer/header del sidebar.
 * Muestra:
 *  - Verde: todo sincronizado (online + 0 pendientes)
 *  - Naranja: hay N pendientes esperando red
 *  - Loading: hay flush corriendo
 *  - Rojo: failed > 0
 *  - Gris: offline
 *
 * También vigila la cuota IDB: si pasa 80%, agrega un warning. Sin esto el
 * perito puede petarse contra QuotaExceededError después de varios peritajes
 * offline con fotos full-res.
 */
export function SyncStatus() {
  const [state, setState] = React.useState<SyncState>({
    pending: 0,
    online: true,
    syncing: false,
    failed: 0,
    lastErrorMessage: null,
    oldestPendingAt: null,
  });
  const [storagePct, setStoragePct] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();

  async function handleClearFailed() {
    setBusy(true);
    try {
      const r = await clearFailedMutations();
      toast.show({
        title:
          r.removed === 0
            ? "Nada que limpiar"
            : `${r.removed} cambio(s) descartado(s)`,
        description:
          r.removed > 0
            ? "Eran cambios locales que el servidor rechazaba. Se eliminaron de este dispositivo."
            : undefined,
        variant: "success",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryFailed() {
    setBusy(true);
    try {
      const r = await retryFailedMutations();
      toast.show({
        title:
          r.retried === 0
            ? "Nada que reintentar"
            : `Reintentando ${r.retried} cambio(s)…`,
        variant: "default",
      });
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    const unsub = subscribeSync(setState);
    // Estimate cada 30s — barato y permite alertar al perito antes del fallo.
    let cancelled = false;
    async function tickStorage() {
      const pct = await getStorageUsagePct();
      if (!cancelled) setStoragePct(pct);
    }
    void tickStorage();
    const t = window.setInterval(tickStorage, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      unsub();
    };
  }, []);

  let icon: React.ReactNode;
  let label: string;
  let tone: "neutral" | "warning" | "danger" | "success";
  let title: string;

  if (!state.online) {
    icon = <CloudOff className="h-3 w-3" />;
    label = state.pending > 0 ? `Sin red · ${state.pending}` : "Sin red";
    tone = "neutral";
    title = "Sin conexión. Los cambios se guardan local y se subirán cuando vuelva la red.";
  } else if (state.failed > 0) {
    icon = <AlertTriangle className="h-3 w-3" />;
    label = `${state.failed} fallidos`;
    tone = "danger";
    title = state.lastErrorMessage ?? "Algunas subidas fallaron tras varios reintentos.";
  } else if (state.syncing) {
    icon = <Loader2 className="h-3 w-3 animate-spin" />;
    label = state.pending > 0 ? `Subiendo · ${state.pending}` : "Subiendo…";
    tone = "warning";
    title = "Sincronizando con el servidor.";
  } else if (state.pending > 0) {
    icon = <Cloud className="h-3 w-3" />;
    label = `${state.pending} por subir`;
    tone = "warning";
    title = `${state.pending} peritajes/cambios esperando red para subirse.`;
  } else {
    icon = <CheckCircle2 className="h-3 w-3" />;
    label = "Sincronizado";
    tone = "success";
    title = "Todo al día.";
  }

  const storageWarn = storagePct !== null && storagePct >= 80;

  return (
    <div className="space-y-1.5">
      <Badge
        variant={tone}
        className={cn("inline-flex w-full justify-center gap-1.5 px-2 py-1 text-[10px]")}
        title={title}
      >
        {icon}
        {label}
      </Badge>
      {state.failed > 0 && (
        // Acciones in-line cuando hay mutaciones fallidas. Sin esto el perito
        // veía la pill roja sin saber qué hacer y nos llamaba a soporte; ahora
        // se atiende solo desde el sidebar.
        <div className="space-y-1">
          <div className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[10px] leading-tight text-muted-foreground">
            Hay {state.failed} cambio(s) que el servidor rechazó tras varios
            reintentos. Puedes reintentar o descartarlos.
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={handleRetryFailed}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium hover:bg-muted disabled:opacity-50"
              title="Resetea el contador de intentos y vuelve a probar"
            >
              <RefreshCw className="h-3 w-3" />
              Reintentar
            </button>
            <button
              type="button"
              onClick={handleClearFailed}
              disabled={busy}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
              title="Borra del dispositivo los cambios que el servidor rechaza (típicamente peritajes corruptos de versiones viejas)"
            >
              <Trash2 className="h-3 w-3" />
              Descartar
            </button>
          </div>
        </div>
      )}
      {storageWarn && (
        <Badge
          variant="warning"
          className="inline-flex w-full justify-center gap-1.5 px-2 py-1 text-[10px]"
          title={`Almacenamiento del dispositivo ${storagePct}% lleno. Considera subir peritajes pendientes o borrar borradores viejos.`}
        >
          <AlertTriangle className="h-3 w-3" />
          Almacenamiento {storagePct}%
        </Badge>
      )}
    </div>
  );
}
