"use client";

import * as React from "react";
import { AlertTriangle, HelpCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Reemplazo de `window.confirm()` con el estilo de la app.
 *
 * Se expone como promesa a propósito, para que migrar desde el confirm nativo
 * sea un cambio de una línea:
 *
 *   if (!confirm("¿Borrar?")) return;
 *   if (!(await confirm({ title: "¿Borrar?" }))) return;
 *
 * Por qué sacamos el nativo:
 *  - En la PWA instalada en Android el diálogo del sistema aparece con la URL
 *    del sitio arriba, lo que rompe la ilusión de app y se ve a medio hacer.
 *  - No se puede diferenciar una acción destructiva de una cualquiera: el
 *    botón "Aceptar" es igual para borrar un usuario que para seguir adelante.
 *  - Bloquea el hilo del navegador, así que ninguna animación ni autosave
 *    corre mientras está abierto.
 *  - No respeta el tema (queda blanco en modo oscuro y a pleno sol).
 */

export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  /** Texto del botón que confirma. Debe nombrar la acción ("Eliminar"), no
   *  decir "Aceptar": el usuario lee el botón antes que el texto. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` para acciones destructivas o irreversibles. */
  variant?: "default" | "warning" | "danger";
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

const ConfirmContext = React.createContext<
  ((opts: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de ConfirmProvider");
  return ctx;
}

const VARIANT_ICON = {
  default: HelpCircle,
  warning: AlertTriangle,
  danger: Trash2,
} as const;

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null);

  const confirm = React.useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const settle = React.useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  // Cerrar por Escape, clic afuera o la X equivale a cancelar. Sin esto la
  // promesa quedaría colgada para siempre y el caller nunca continuaría.
  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) settle(false);
    },
    [settle],
  );

  const variant = pending?.variant ?? "default";
  const Icon = VARIANT_ICON[variant];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={pending !== null} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md gap-0">
          <DialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                variant === "danger" && "bg-danger/10 text-danger",
                variant === "warning" && "bg-warning/10 text-warning",
                variant === "default" && "bg-primary/10 text-primary",
              )}
              aria-hidden="true"
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1.5 pr-6">
              <DialogTitle className="leading-snug">
                {pending?.title}
              </DialogTitle>
              {pending?.description ? (
                <DialogDescription className="leading-relaxed">
                  {pending.description}
                </DialogDescription>
              ) : null}
            </div>
          </DialogHeader>

          <DialogFooter className="mt-6 gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? "Cancelar"}
            </Button>
            <Button
              type="button"
              variant={variant === "danger" ? "destructive" : "default"}
              onClick={() => settle(true)}
              autoFocus
            >
              {pending?.confirmLabel ?? "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
