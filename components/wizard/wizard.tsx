"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Keyboard,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import {
  BODYWORK_SECTION,
  CHASSIS_SECTION,
  COMFORT_SECTION,
  ELECTRICAL_SECTION,
  ENGINE_SECTION,
  LEAKS_SECTION,
  ROAD_TEST_SECTION,
  SUSPENSION_SECTION,
  WIZARD_STEPS,
  type StepId,
} from "@/lib/constants";
import { findOption, requiresPhoto } from "@/lib/findings-catalog";
import type { InspectionData, InspectionEntry, InspectionSectionDef } from "@/lib/types";

import { InspectionProvider, useInspection } from "./inspection-context";
import { SaveIndicator } from "./save-indicator";
import { Stepper, type StepStats } from "./stepper";
import { ThemeToggle } from "./theme-toggle";
import { UIPreferencesProvider } from "./ui-preferences";
import { VehicleInfoStep } from "./steps/vehicle-info";
import { SectionStep } from "./steps/section-step";
import { TiresStep } from "./steps/tires";
import { AccessoriesStep } from "./steps/accessories";
import { SummaryStep } from "./steps/summary";

const SECTION_MAP: Partial<Record<StepId, { section: InspectionSectionDef; description: string }>> = {
  bodywork: {
    section: BODYWORK_SECTION,
    description:
      "Estado visual de paneles, puertas, vidrios y componentes de carrocería.",
  },
  chassis: {
    section: CHASSIS_SECTION,
    description: "Integridad estructural: largueros, parantes y soldaduras.",
  },
  suspension: {
    section: SUSPENSION_SECTION,
    description: "Suspensión delantera y sistema de dirección.",
  },
  engine: { section: ENGINE_SECTION, description: "Desempeño, componentes y transmisión." },
  electrical: {
    section: ELECTRICAL_SECTION,
    description: "Luces, indicadores y sistemas electrónicos.",
  },
  leaks: { section: LEAKS_SECTION, description: "Fugas de fluidos por sistema." },
  comfort: { section: COMFORT_SECTION, description: "Aire, interior e infoentretenimiento." },
  roadTest: {
    section: ROAD_TEST_SECTION,
    description: "Desempeño real del vehículo en recorrido.",
  },
};

function countFindingsInRecord(record: Record<string, InspectionEntry>): number {
  let count = 0;
  for (const entry of Object.values(record ?? {})) {
    const opt = findOption(entry?.status);
    if (opt && (opt.tone === "warning" || opt.tone === "danger")) count += 1;
  }
  return count;
}

function validateStep(
  step: StepId,
  data: InspectionData,
): { ok: boolean; message?: string } {
  if (step === "vehicle") {
    const v = data.vehicle;
    if (!v.plate) return { ok: false, message: "Falta la placa del vehículo." };
    if (!v.make) return { ok: false, message: "Falta la marca." };
    if (!v.model) return { ok: false, message: "Falta el modelo." };
    if (!/^\d{4}$/u.test(v.year)) return { ok: false, message: "Año inválido." };
    if (!/^\d+$/u.test(v.mileage)) return { ok: false, message: "Kilometraje inválido." };
    if (!v.inspector) return { ok: false, message: "Falta el nombre del perito." };
    if (!v.date) return { ok: false, message: "Falta la fecha." };
    return { ok: true };
  }

  const sectionForStep = SECTION_MAP[step]?.section;

  if (sectionForStep) {
    const record = data[sectionForStep.id] as Record<string, InspectionEntry>;
    for (const group of sectionForStep.groups) {
      for (const item of group.items) {
        const entry = record[item.id];
        if (
          requiresPhoto(entry?.status) &&
          (entry?.images.length ?? 0) === 0
        ) {
          return {
            ok: false,
            message: `Falta foto para "${item.label}" (hallazgo seleccionado).`,
          };
        }
      }
    }
    return { ok: true };
  }

  if (step === "tires") {
    const t = data.tires;
    for (const v of [t.frontLeft, t.frontRight, t.rearLeft, t.rearRight, t.spare]) {
      if (v < 0 || v > 100)
        return { ok: false, message: "Valores de llantas deben estar entre 0 y 100." };
    }
    return { ok: true };
  }
  return { ok: true };
}

function isStepComplete(step: StepId, data: InspectionData): boolean {
  if (!validateStep(step, data).ok) return false;

  if (step === "vehicle") return true;

  const sectionForStep = SECTION_MAP[step]?.section;

  if (sectionForStep) {
    const record = data[sectionForStep.id] as Record<string, InspectionEntry>;
    return sectionForStep.groups.every((g) =>
      g.items.every((i) => !!record[i.id]?.status),
    );
  }

  const confirmed = data.confirmedSteps ?? [];
  if (step === "tires") return confirmed.includes("tires");
  if (step === "accessories") return confirmed.includes("accessories");
  if (step === "summary") {
    return !!data.conclusion.generalCondition;
  }
  return true;
}

function WizardInner() {
  const { data, setData, isHydrated, notFound } = useInspection();
  const [current, setCurrent] = React.useState<StepId>("vehicle");
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const toast = useToast();
  const router = useRouter();

  const completed = React.useMemo(() => {
    const set = new Set<StepId>();
    for (const s of WIZARD_STEPS) {
      if (isStepComplete(s.id, data)) set.add(s.id);
    }
    return set;
  }, [data]);

  const statsByStep = React.useMemo(() => {
    const stats: Partial<Record<StepId, StepStats>> = {};
    for (const [stepId, ref] of Object.entries(SECTION_MAP) as [
      StepId,
      (typeof SECTION_MAP)[StepId],
    ][]) {
      if (!ref) continue;
      const record = data[ref.section.id] as Record<string, InspectionEntry>;
      stats[stepId] = { findings: countFindingsInRecord(record) };
    }
    return stats;
  }, [data]);

  const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === current);
  const progress = Math.round(((currentIndex + 1) / WIZARD_STEPS.length) * 100);

  const goNext = React.useCallback(() => {
    const v = validateStep(current, data);
    if (!v.ok) {
      toast.show({ title: "Revise los datos", description: v.message, variant: "warning" });
      return;
    }
    setData((prev) => {
      const list = prev.confirmedSteps ?? [];
      if (list.includes(current)) return prev;
      return { ...prev, confirmedSteps: [...list, current] };
    });
    const next = WIZARD_STEPS[Math.min(currentIndex + 1, WIZARD_STEPS.length - 1)];
    setCurrent(next.id);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [current, currentIndex, data, setData, toast]);

  const goPrev = React.useCallback(() => {
    const prev = WIZARD_STEPS[Math.max(currentIndex - 1, 0)];
    setCurrent(prev.id);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentIndex]);

  // Keyboard shortcuts: N/P navigate, ? help. We skip when focus is on a field.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          (target as HTMLElement).isContentEditable);
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (isEditable) return;
      const k = e.key.toLowerCase();
      if (k === "n" || e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (k === "p" || e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (k === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando inspección...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <div className="text-lg font-semibold">Peritaje no encontrado</div>
        <p className="text-sm text-muted-foreground">
          El peritaje que intentas abrir no existe o fue eliminado.
        </p>
        <Button onClick={() => router.push("/")}>Volver al inicio</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 sm:space-y-6 sm:pb-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="-ml-2 mb-1 h-8 gap-1 px-2 text-xs text-muted-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Volver a peritajes
          </Button>
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {data.vehicle.plate
              ? `Peritaje · ${data.vehicle.plate}`
              : "Nuevo peritaje"}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              Paso {currentIndex + 1} de {WIZARD_STEPS.length} ·{" "}
              {WIZARD_STEPS[currentIndex].label}
            </span>
            <SaveIndicator />
          </div>
        </div>
        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="hidden h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground hover:bg-accent md:inline-flex"
            aria-label="Atajos de teclado"
            title="Atajos de teclado (?)"
          >
            <Keyboard className="h-4 w-4" />
          </button>
          <ThemeToggle />
        </div>
      </div>

      <Progress value={progress} />

      <Stepper
        current={current}
        onSelect={setCurrent}
        completed={completed}
        statsByStep={statsByStep}
      />

      <div>
        {current === "vehicle" && <VehicleInfoStep />}
        {current === "bodywork" && (
          <SectionStep
            section={BODYWORK_SECTION}
            title="Carrocería"
            description={SECTION_MAP.bodywork?.description}
          />
        )}
        {current === "chassis" && (
          <SectionStep
            section={CHASSIS_SECTION}
            title="Chasis y estructura"
            description={SECTION_MAP.chassis?.description}
          />
        )}
        {current === "suspension" && (
          <SectionStep
            section={SUSPENSION_SECTION}
            title="Suspensión delantera y dirección"
            description={SECTION_MAP.suspension?.description}
          />
        )}
        {current === "tires" && <TiresStep />}
        {current === "engine" && (
          <SectionStep
            section={ENGINE_SECTION}
            title="Motor"
            description={SECTION_MAP.engine?.description}
          />
        )}
        {current === "electrical" && (
          <SectionStep
            section={ELECTRICAL_SECTION}
            title="Sistema eléctrico"
            description={SECTION_MAP.electrical?.description}
          />
        )}
        {current === "leaks" && (
          <SectionStep
            section={LEAKS_SECTION}
            title="Fugas de fluidos"
            description={SECTION_MAP.leaks?.description}
          />
        )}
        {current === "comfort" && (
          <SectionStep
            section={COMFORT_SECTION}
            title="Confort e interior"
            description={SECTION_MAP.comfort?.description}
          />
        )}
        {current === "roadTest" && (
          <SectionStep
            section={ROAD_TEST_SECTION}
            title="Prueba de ruta"
            description={SECTION_MAP.roadTest?.description}
          />
        )}
        {current === "accessories" && <AccessoriesStep />}
        {current === "summary" && <SummaryStep />}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t bg-background/95 px-3 py-3 backdrop-blur sm:static sm:rounded-lg sm:border sm:px-4"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <Button
          variant="outline"
          size="lg"
          onClick={goPrev}
          disabled={currentIndex === 0}
          className="h-11 flex-1 sm:flex-none"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Anterior</span>
          <span className="sm:hidden">Atrás</span>
        </Button>
        <div className="hidden text-xs text-muted-foreground sm:block">
          {completed.size}/{WIZARD_STEPS.length} pasos completos
        </div>
        <Button
          onClick={goNext}
          size="lg"
          disabled={currentIndex === WIZARD_STEPS.length - 1}
          className="h-11 flex-1 sm:flex-none"
        >
          <span>Siguiente</span>
          <ArrowRight className="ml-1.5 h-4 w-4 sm:ml-2" />
        </Button>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atajos de teclado</DialogTitle>
            <DialogDescription>
              Funcionan cuando no hay un campo enfocado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <ShortcutRow keys={["N", "→"]} label="Siguiente paso" />
            <ShortcutRow keys={["P", "←"]} label="Paso anterior" />
            <ShortcutRow keys={["?"]} label="Mostrar / ocultar esta ayuda" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <React.Fragment key={k}>
            {i > 0 && <span className="text-xs text-muted-foreground">o</span>}
            <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs shadow-sm">
              {k}
            </kbd>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function Wizard({ id }: { id: string }) {
  return (
    <UIPreferencesProvider>
      <InspectionProvider id={id}>
        <WizardInner />
      </InspectionProvider>
    </UIPreferencesProvider>
  );
}
