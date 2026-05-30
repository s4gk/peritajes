"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
} from "lucide-react";


import { Badge } from "@/components/ui/badge";
import {
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
    firstFailedInspectionId: null,
    firstFailedKind: null,
    oldestPendingAt: null,
  });
  const [storagePct, setStoragePct] = React.useState<number | null>(null);

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
