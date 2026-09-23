"use client";

import * as React from "react";

import { detectOcrCoreFile } from "@/lib/client/ocr-core";

/**
 * Le pide al service worker que deje lista la app para trabajar sin red:
 * cascarón del wizard, páginas del panel, todos los assets del build y el OCR
 * local de la tarjeta.
 *
 * Se hace desde el panel (y no solo en el `install` del SW) porque el SW
 * suele instalarse en /login, ANTES de que exista la sesión: ahí el panel
 * responde 307 y no hay nada útil que cachear. Mandamos el id del usuario
 * para que el SW descarte el cache de otro usuario en el mismo navegador.
 * El SW limita la frecuencia; esto puede llamarse en cada carga del panel.
 */
export function OfflineWarmup({ userId }: { userId: string }) {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    const warm = async () => {
      if (!navigator.onLine) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        if (cancelled) return;
        reg.active?.postMessage({
          type: "WARM_OFFLINE",
          uid: userId,
          // Qué core del OCR usa este celular: el SW precachea solo ese.
          ocrCore: detectOcrCoreFile(),
        });
      } catch {
        /* sin SW (dev) — nada que hacer */
      }
    };
    void warm();
    window.addEventListener("online", warm);
    return () => {
      cancelled = true;
      window.removeEventListener("online", warm);
    };
  }, [userId]);
  return null;
}
