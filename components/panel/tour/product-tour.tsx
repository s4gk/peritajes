"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { hasSeenTour, markTourSeen } from "@/lib/client/tour-storage";

import { useCurrentUser } from "../current-user";
import { Spotlight } from "./spotlight";
import { buildSteps, getSectionTour, type TourRole, type TourStep } from "./tour-steps";
import { TourTooltip } from "./tour-tooltip";

export const TOUR_START_EVENT = "perito:tour:start";

const MOBILE_QUERY = "(max-width: 1023px)"; // coincide con el breakpoint lg del sidebar
const DRAWER_SETTLE_MS = 250; // debe superar la transition-transform del drawer

function isMobile(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

/** Primer elemento que coincide con el selector y está realmente visible. En
 *  varias páginas el mismo control existe dos veces (botón de escritorio +
 *  FAB móvil) con uno oculto por CSS; resaltamos el que se ve. */
function firstVisible(selector: string): Element | null {
  const els = Array.from(document.querySelectorAll(selector));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") {
      return el;
    }
  }
  return null;
}

/**
 * Orquestador del tour de uso. Vive dentro de PanelShell (debajo de
 * CurrentUserProvider) y recibe `setDrawerOpen` para abrir el menú lateral en
 * móvil durante el recorrido general. Maneja dos tipos de recorrido:
 *  - General: resalta el menú; se auto-lanza la primera vez por rol.
 *  - Por sección: resalta los controles de la página actual; se auto-lanza la
 *    primera vez que entras a cada sección.
 * El botón de ayuda relanza el recorrido de la sección donde estés (o el general
 * si la sección no tiene uno propio).
 */
export function ProductTour({
  setDrawerOpen,
}: {
  setDrawerOpen: (open: boolean) => void;
}) {
  const user = useCurrentUser();
  const role = user?.role as TourRole | undefined;
  const pathname = usePathname();

  const overviewSteps = React.useMemo<TourStep[]>(
    () => (role ? buildSteps(role) : []),
    [role],
  );

  const [active, setActive] = React.useState(false);
  const [steps, setSteps] = React.useState<TourStep[]>([]);
  const [tourKey, setTourKey] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  const startTour = React.useCallback((nextSteps: TourStep[], key: string) => {
    if (nextSteps.length === 0) return;
    setSteps(nextSteps);
    setTourKey(key);
    setIndex(0);
    setActive(true);
  }, []);

  const finish = React.useCallback(() => {
    if (tourKey) markTourSeen(tourKey);
    setActive(false);
    setRect(null);
    if (isMobile()) setDrawerOpen(false);
  }, [tourKey, setDrawerOpen]);

  const goNext = React.useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        finish();
        return i;
      }
      return i + 1;
    });
  }, [steps.length, finish]);

  const goPrev = React.useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const mustSign = !!role && role !== "admin" && !user?.signatureDataUrl;

  // Auto-lanzamiento del recorrido GENERAL en el primer ingreso de cada rol.
  React.useEffect(() => {
    if (!role || mustSign || hasSeenTour(role)) return;
    const id = window.setTimeout(() => startTour(overviewSteps, role), 400);
    return () => window.clearTimeout(id);
  }, [role, mustSign, overviewSteps, startTour]);

  // Auto-lanzamiento del paso a paso de la SECCIÓN la primera vez que se entra.
  // Solo después de haber visto el recorrido general, y nunca encima de otro.
  React.useEffect(() => {
    if (!role || mustSign || active) return;
    if (!hasSeenTour(role)) return; // primero el recorrido general
    const section = getSectionTour(pathname);
    if (!section || hasSeenTour(section.key)) return;
    const id = window.setTimeout(() => {
      // Re-chequeo: el usuario pudo navegar o lanzar otro tour en el ínterin.
      if (!hasSeenTour(section.key)) startTour(section.steps, section.key);
    }, 600);
    return () => window.clearTimeout(id);
  }, [role, mustSign, active, pathname, startTour]);

  // Relanzamiento manual desde el botón de ayuda: recorrido de la sección
  // actual si existe, si no el general.
  React.useEffect(() => {
    function onStart() {
      const section = getSectionTour(pathname);
      if (section) startTour(section.steps, section.key);
      else if (role) startTour(overviewSteps, role);
    }
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [pathname, role, overviewSteps, startTour]);

  // Medición del objetivo del paso actual (abre el drawer en móvil si hace falta).
  React.useEffect(() => {
    if (!active) return;
    const step = steps[index];
    if (!step) return;

    const mobile = isMobile();
    if (mobile) setDrawerOpen(step.requiresDrawer ? true : false);

    const delay = mobile && step.requiresDrawer ? DRAWER_SETTLE_MS : 0;
    const id = window.setTimeout(() => {
      if (step.target === "center") {
        setRect(null);
        return;
      }
      const el = firstVisible(step.target);
      if (!el) {
        // Objetivo ausente o invisible (p. ej. buscador sin registros): saltamos.
        goNext();
        return;
      }
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      setRect(el.getBoundingClientRect());
    }, delay);

    return () => window.clearTimeout(id);
  }, [active, index, steps, setDrawerOpen, goNext]);

  // Recalcular posición ante resize/scroll mientras el tour está activo.
  React.useEffect(() => {
    if (!active) return;
    const step = steps[index];
    if (!step || step.target === "center") return;
    function recompute() {
      const el = firstVisible(step.target);
      if (el) setRect(el.getBoundingClientRect());
    }
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [active, index, steps]);

  // Atajos de teclado.
  React.useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, finish, goNext, goPrev]);

  if (!active || !role) return null;
  const step = steps[index];
  if (!step) return null;

  return (
    <>
      {/* Capa para capturar clics fuera del globo sin cerrar (evita interacción accidental). */}
      <div className="fixed inset-0 z-[149]" aria-hidden onClick={(e) => e.preventDefault()} />
      <Spotlight rect={rect} />
      <TourTooltip
        step={step}
        index={index}
        total={steps.length}
        onPrev={goPrev}
        onNext={goNext}
        onSkip={finish}
        anchorRect={rect}
      />
    </>
  );
}
