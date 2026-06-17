"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Placement, TourStep } from "./tour-steps";

const MARGIN = 8;
const GAP = 12;

type Pos = { top: number; left: number };

/** Calcula la posición del globo a partir del rect del objetivo y el placement,
 *  recortando al viewport. Si no hay rect (paso centrado) lo centra en pantalla. */
function computePosition(
  anchor: DOMRect | null,
  size: { w: number; h: number },
  placement: Placement,
): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!anchor) {
    return { top: (vh - size.h) / 2, left: (vw - size.w) / 2 };
  }

  let top = 0;
  let left = 0;
  const place = placement === "auto" ? "bottom" : placement;

  switch (place) {
    case "top":
      top = anchor.top - size.h - GAP;
      left = anchor.left + anchor.width / 2 - size.w / 2;
      break;
    case "bottom":
      top = anchor.bottom + GAP;
      left = anchor.left + anchor.width / 2 - size.w / 2;
      break;
    case "left":
      top = anchor.top + anchor.height / 2 - size.h / 2;
      left = anchor.left - size.w - GAP;
      break;
    case "right":
    default:
      top = anchor.top + anchor.height / 2 - size.h / 2;
      left = anchor.right + GAP;
      break;
  }

  // Recorte al viewport.
  left = Math.min(Math.max(MARGIN, left), vw - size.w - MARGIN);
  top = Math.min(Math.max(MARGIN, top), vh - size.h - MARGIN);
  return { top, left };
}

export function TourTooltip({
  step,
  index,
  total,
  onPrev,
  onNext,
  onSkip,
  anchorRect,
}: {
  step: TourStep;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  anchorRect: DOMRect | null;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<Pos | null>(null);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mobile = window.matchMedia("(max-width: 639px)").matches;
    setIsMobile(mobile);
    if (mobile) {
      setPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setPos(computePosition(anchorRect, { w: r.width, h: r.height }, step.placement ?? "auto"));
  }, [anchorRect, step.id, step.placement]);

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={step.title}
      className={cn(
        "fixed z-[151] w-[min(26rem,calc(100vw-1.5rem))] rounded-xl border bg-card p-6 text-card-foreground shadow-lg",
        // En móvil: hoja inferior fija. En desktop: posición calculada.
        isMobile && "inset-x-3 bottom-3 w-auto p-5",
      )}
      style={
        !isMobile && pos
          ? { top: pos.top, left: pos.left }
          : !isMobile
            ? { opacity: 0 } // primer paint antes de medir
            : undefined
      }
    >
      <button
        type="button"
        onClick={onSkip}
        aria-label="Cerrar guía"
        className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <h2 className="pr-7 text-lg font-semibold">{step.title}</h2>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">{step.body}</p>

      <div className="mt-6 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Paso {index + 1} de {total}
        </span>
        <div className="flex items-center gap-2">
          {!isLast && (
            <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
              Saltar
            </Button>
          )}
          {!isFirst && (
            <Button type="button" variant="outline" size="sm" onClick={onPrev} className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
          )}
          <Button type="button" size="sm" onClick={onNext} className="gap-1">
            {isLast ? "Finalizar" : "Siguiente"}
            {!isLast && <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
