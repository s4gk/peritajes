"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Download, Share2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Banner discreto que ofrece instalar Perito como PWA.
 *
 *   - Android / desktop Chrome / Edge: usa `beforeinstallprompt` (lo capturamos
 *     y disparamos `prompt()` al click). Solo aparece cuando el browser confirma
 *     que la app cumple los criterios de instalación.
 *   - iOS Safari: no soporta `beforeinstallprompt`. Mostramos una guía corta
 *     ("Compartir → Agregar a inicio") como banner alternativo.
 *
 * Respetamos el descarte del usuario por 7 días via localStorage. Si el SO
 * detecta que la app ya está instalada (`display-mode: standalone` o el evento
 * `appinstalled`), nunca mostramos el banner.
 */

const DISMISS_KEY = "perito:pwa-install-dismissed-until";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const HIDDEN_PATHS = ["/login", "/setup", "/reset", "/sign", "/r/"];

type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari report standalone via window.navigator
  if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
  return false;
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  // Chrome iOS también incluye "CriOS" — la API "Agregar a inicio" sólo está
  // en Safari. Si es CriOS o FxiOS, ocultamos el banner iOS.
  if (!isIos) return false;
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) return false;
  return true;
}

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) return false;
    return Date.now() < until;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
  } catch {
    /* localStorage puede estar deshabilitado en modo incógnito de algunos browsers */
  }
}

export function PWAInstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = React.useState<DeferredPrompt | null>(null);
  const [showIosHint, setShowIosHint] = React.useState(false);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (isDismissed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as DeferredPrompt);
      setHidden(false);
    };
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
      markDismissed();
    };
    window.addEventListener("beforeinstallprompt", onPrompt as EventListener);
    window.addEventListener("appinstalled", onInstalled);

    // iOS fallback: no hay evento, lo mostramos pasivamente.
    if (isIosSafari()) {
      setShowIosHint(true);
      setHidden(false);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt as EventListener);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;
  if (HIDDEN_PATHS.some((p) => pathname === p || pathname?.startsWith(`${p}/`))) {
    return null;
  }

  async function handleInstall() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setHidden(true);
      } else {
        markDismissed();
        setHidden(true);
      }
    } catch {
      setHidden(true);
    } finally {
      setDeferred(null);
    }
  }

  function handleDismiss() {
    markDismissed();
    setHidden(true);
  }

  return (
    <div
      className={cn(
        "fixed inset-x-2 z-40 sm:left-auto sm:right-4 sm:max-w-sm",
        "rounded-xl border bg-card p-3 shadow-lg",
        "animate-in slide-in-from-bottom-4 fade-in",
      )}
      style={{ bottom: "max(0.5rem, calc(env(safe-area-inset-bottom) + 0.5rem))" }}
      role="dialog"
      aria-label="Instalar Peritajes del Llano como app"
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={handleDismiss}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {deferred ? (
        <div className="flex items-start gap-3 pr-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Download className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">Instalar Peritajes del Llano</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Acceso rápido desde tu pantalla de inicio, mejor rendimiento offline
              y modo pantalla completa.
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={handleInstall} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Instalar
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDismiss}>
                Ahora no
              </Button>
            </div>
          </div>
        </div>
      ) : showIosHint ? (
        <div className="flex items-start gap-3 pr-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Share2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">Instalá Peritajes del Llano en tu iPhone</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tocá el botón <span className="font-semibold">Compartir</span> en
              Safari y elegí <span className="font-semibold">Agregar a inicio</span>.
            </p>
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={handleDismiss}>
                Entendido
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
