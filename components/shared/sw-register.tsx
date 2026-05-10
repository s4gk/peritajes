"use client";

import * as React from "react";

/**
 * Registra el service worker en el primer mount del cliente. Solo en
 * producción para no interferir con HMR de Next dev (el dev server invalida
 * los chunks constantemente y un SW agresivo dejaría al perito ofreciendo
 * código viejo).
 */
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const reg = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          console.warn("[SW] no se pudo registrar:", err);
        });
    };
    if (document.readyState === "complete") reg();
    else window.addEventListener("load", reg, { once: true });
  }, []);
  return null;
}
