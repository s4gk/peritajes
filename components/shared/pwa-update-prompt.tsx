"use client";

import * as React from "react";
import { RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Detecta cuando el service worker tiene una versión nueva esperando activarse
 * (`registration.waiting`) y le ofrece al usuario actualizar al toque.
 *
 * Flujo:
 *  1. Al cargar, leemos la registration y revisamos `waiting` y `updatefound`.
 *  2. Cada 60s pingueamos `registration.update()` por si el SW remoto cambió
 *     mientras la pestaña está abierta (Chrome ya lo hace en navigations, pero
 *     en una PWA standalone que dura horas abierta nos asegura no quedarnos
 *     atrás).
 *  3. Cuando hay un worker en `waiting`, mostramos el banner.
 *  4. Click en "Actualizar" → postMessage SKIP_WAITING al worker waiting.
 *  5. El worker llama skipWaiting() y dispara `controllerchange` en clients.
 *  6. Esperamos `controllerchange` y reload de la página.
 *
 * Si el usuario descarta, no volvemos a molestar hasta que aparezca un worker
 * nuevo (otro `updatefound`). El descarte es de sesión — no persiste.
 */

const UPDATE_CHECK_INTERVAL_MS = 60_000;

export function PWAUpdatePrompt() {
  const [waitingWorker, setWaitingWorker] = React.useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const reloadingRef = React.useRef(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function captureWaiting(reg: ServiceWorkerRegistration) {
      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(reg.waiting);
        setDismissed(false);
      }
    }

    function watchInstalling(reg: ServiceWorkerRegistration) {
      const newSw = reg.installing;
      if (!newSw) return;
      newSw.addEventListener("statechange", () => {
        if (newSw.state === "installed" && navigator.serviceWorker.controller) {
          // Hay controller previo + uno nuevo instalado → es un update real.
          setWaitingWorker(newSw);
          setDismissed(false);
        }
      });
    }

    navigator.serviceWorker.ready.then((reg) => {
      if (cancelled) return;
      captureWaiting(reg);
      reg.addEventListener("updatefound", () => watchInstalling(reg));
      // Disparamos un check inicial + intervalo periódico.
      reg.update().catch(() => {});
      intervalId = setInterval(() => {
        reg.update().catch(() => {});
      }, UPDATE_CHECK_INTERVAL_MS);
    });

    // Cuando el SW nuevo toma el control, recargamos para servir el bundle nuevo.
    const onControllerChange = () => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waitingWorker || dismissed) return null;

  function applyUpdate() {
    if (!waitingWorker) return;
    try {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } catch {
      // Si por algún motivo postMessage falla, hacemos reload duro — el SW
      // nuevo se va a activar en el próximo load igual.
      window.location.reload();
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-x-2 z-50 sm:left-auto sm:right-4 sm:max-w-sm",
        "rounded-xl border bg-card p-3 shadow-lg",
        "animate-in slide-in-from-top-4 fade-in",
      )}
      style={{ top: "max(0.5rem, calc(env(safe-area-inset-top) + 0.5rem))" }}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <RefreshCw className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">Nueva versión disponible</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Hay una actualización de Perito lista. Aplicala para usar la versión
            más reciente — tus borradores en curso quedan guardados.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={applyUpdate} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Actualizar ahora
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              Después
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
