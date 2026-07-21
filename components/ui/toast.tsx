"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "warning" | "danger";

type ToastMessage = {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
};

type ToastContextValue = {
  show: (t: Omit<ToastMessage, "id">) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

/** Los de error se quedan más tiempo: suelen traer un motivo que hay que leer,
 *  y a veces copiar, antes de que se vaya solo. */
const DURATION: Record<ToastVariant, number> = {
  default: 4000,
  success: 3500,
  warning: 6000,
  danger: 8000,
};

const ICON: Record<ToastVariant, LucideIcon> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastMessage[]>([]);
  // Los timers se guardan para poder cancelarlos si el toast se cierra a mano;
  // si no, un setTimeout viejo dispararía sobre una lista donde ese id ya no
  // está (inofensivo, pero deja re-renders de más).
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = React.useCallback(
    (t: Omit<ToastMessage, "id">) => {
      const id = Math.random().toString(36).slice(2);
      setItems((prev) => [...prev, { ...t, id }]);
      const timer = setTimeout(
        () => dismiss(id),
        DURATION[t.variant ?? "default"],
      );
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // Limpieza al desmontar: sin esto quedan timers vivos apuntando a un
  // componente que ya no existe.
  React.useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col gap-2 sm:inset-auto sm:bottom-4 sm:right-4 sm:w-full sm:max-w-sm"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
        // Los errores se anuncian de inmediato; el resto espera a que el
        // lector de pantalla termine lo que está diciendo.
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => {
          const variant = t.variant ?? "default";
          const Icon = ICON[variant];
          return (
            <div
              key={t.id}
              role={variant === "danger" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-3 shadow-lg sm:p-3.5",
                "animate-in slide-in-from-bottom-3 fade-in duration-200",
                // Franja de color al costado en vez de teñir todo el fondo: el
                // texto se lee sobre el color de tarjeta de siempre, así que
                // mantiene contraste en los tres temas.
                "border-l-4",
                variant === "success" && "border-l-success",
                variant === "warning" && "border-l-warning",
                variant === "danger" && "border-l-danger",
                variant === "default" && "border-l-primary",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-5 w-5 shrink-0",
                  variant === "success" && "text-success",
                  variant === "warning" && "text-warning",
                  variant === "danger" && "text-danger",
                  variant === "default" && "text-primary",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-snug">
                  {t.title}
                </div>
                {t.description ? (
                  <div className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
                    {t.description}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Cerrar aviso"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
