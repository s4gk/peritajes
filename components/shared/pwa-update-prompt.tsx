"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { subscribeSync, type SyncState } from "@/lib/client/sync-queue";
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
  // Estado de la sync queue. Si hay mutations pendientes (sobre todo
  // failed > 0), aplicar update implica reload — y aunque IDB persiste, el
  // perito debería decidir conscientemente que está OK con eso.
  const [sync, setSync] = React.useState<SyncState | null>(null);

  React.useEffect(() => subscribeSync(setSync), []);

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

  // Si hay cambios pendientes de subir al server, mostramos un warning antes
  // de aplicar el update — el reload sigue siendo seguro (IDB persiste), pero
  // el perito debería saber que va a recargar con cambios todavía en cola.
  const hasPending = !!sync && sync.pending > 0;
  const hasFailed = !!sync && sync.failed > 0;

  function applyUpdate() {
    if (!waitingWorker) return;
    if (hasFailed) {
      // Cambios fallidos son la situación más arriesgada: el server NO los
      // tiene, y un reload no los va a sincronizar mágicamente. Pedimos
      // confirmación explícita en vez de aplicar silenciosamente.
      const ok = window.confirm(
        `Hay ${sync!.failed} cambio(s) sin subir al server. ` +
          "El reload mantiene los datos en este dispositivo, pero seguirán pendientes. ¿Actualizar igual?",
      );
      if (!ok) return;
    }
    try {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } catch {
      // Si por algún motivo postMessage falla, hacemos reload duro — el SW
      // nuevo se va a activar en el próximo load igual. IDB persiste el
      // estado del wizard, así que se pierden a lo sumo los últimos 400ms
      // del debounce de autosave.
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
            más reciente — tu trabajo en curso queda guardado.
          </p>
          {hasFailed && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Tienes {sync!.failed} cambio(s) sin subir al server. Te
                pediremos confirmación antes de recargar.
              </span>
            </div>
          )}
          {!hasFailed && hasPending && (
            <div className="mt-2 text-[11px] text-warning">
              {sync!.pending} cambio(s) pendientes de subir — quedarán en cola
              después del reload.
            </div>
          )}
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
