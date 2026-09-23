"use client";

import * as React from "react";
import { AlertTriangle, X } from "lucide-react";

import { STORAGE_FULL_EVENT } from "@/lib/inspections-store";

/**
 * Aviso fijo cuando el celular se queda sin espacio y una escritura local
 * (IndexedDB) falla con QuotaExceededError. Sin esto el cambio se perdía en
 * silencio: el perito veía "guardado" pero al recargar sin red no estaba.
 */
export function StorageFullBanner() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onFull = () => setOpen(true);
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);
  if (!open) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex items-start gap-2 border-b border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger backdrop-blur"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">El celular se quedó sin espacio</div>
        <div className="text-xs">
          Los últimos cambios NO se pudieron guardar en el celular. Conéctate a
          internet para subir lo pendiente, o libera espacio (fotos, videos,
          apps) y vuelve a intentarlo.
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cerrar aviso"
        className="rounded p-1 hover:bg-danger/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
