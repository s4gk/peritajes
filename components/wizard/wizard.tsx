"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Download,
  Keyboard,
} from "lucide-react";

import { ErrorBoundary } from "@/components/shared/error-boundary";
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
  activeSectionsFor,
  activeStepsFor,
  isWalkaroundStageStep,
  PERITAJE_KINDS,
  LEAKS_SECTION,
  ROAD_TEST_SECTION,
  VEHICLE_TYPES,
  WIZARD_STEPS,
  walkaroundSequenceFor,
  type StepId,
  type WalkaroundStageStepId,
} from "@/lib/constants";
import { findOption, minPhotosFor } from "@/lib/findings-catalog";
import { downloadInspectionPdf } from "@/lib/pdf-client";
import { formatDate } from "@/lib/utils";
import type { InspectionData, InspectionEntry } from "@/lib/types";

import { InspectionProvider, useInspection } from "./inspection-context";
import { SaveIndicator } from "./save-indicator";
import { Stepper, type StepStats } from "./stepper";
import { UIPreferencesProvider } from "./ui-preferences";
import { VehicleInfoStep } from "./steps/vehicle-info";
import { RoadTestStep } from "./steps/road-test";
import { ExtraPhotosStep } from "./steps/extra-photos";
import { LeaksStep } from "./steps/leaks";
import { WalkaroundStep } from "./steps/walkaround";
import { SummaryStep } from "./steps/summary";

function countFindingsInRecord(record: Record<string, InspectionEntry>): number {
  let count = 0;
  for (const entry of Object.values(record ?? {})) {
    const opt = findOption(entry?.status);
    if (opt && (opt.tone === "warning" || opt.tone === "danger")) count += 1;
  }
  return count;
}

type ValidateResult = {
  ok: boolean;
  message?: string;
  /** Aviso no bloqueante. Si `ok=true` y `warning` está seteado, `goNext`
   *  muestra el toast de advertencia pero deja avanzar igual. Lo usamos para
   *  fotos pendientes en etapas del recorrido: el perito puede resolverlas
   *  en el paso final "Fotografías adicionales" en vez de quedar atrapado. */
  warning?: string;
  /** Id del input al que conviene mover el foco si falla. */
  focusId?: string;
  /** Id del item de inspección al que conviene scrollear si falla
   *  (los rows de InspectionItemRow exponen `data-item-id`). */
  scrollItemId?: string;
};

/** Considera una imagen "legible" si su data URL pesa al menos ~3KB de payload
 *  binario. Una foto JPEG válida del celular pesa ≥30KB; menos de 3KB indica
 *  que el slot se llenó con un pixel/placeholder o que la captura quedó
 *  corrupta. No es una validación de nitidez, pero atrapa el caso de "tomé
 *  foto pero la cámara no devolvió frame". */
function isImageEntryUsable(img: { dataUrl?: string } | undefined): boolean {
  if (!img?.dataUrl) return false;
  if (!img.dataUrl.startsWith("data:")) return false;
  const idx = img.dataUrl.indexOf(",");
  if (idx < 0) return false;
  // Base64 inflate ~33% → 4KB de payload base64 = ~3KB binarios.
  return img.dataUrl.length - idx - 1 >= 4000;
}

function validateStep(step: StepId, data: InspectionData): ValidateResult {
  if (step === "vehicle") {
    const v = data.vehicle;
    if (!v.plate) return { ok: false, message: "Falta la placa del vehículo.", focusId: "plate" };
    if (!v.make) return { ok: false, message: "Falta la marca.", focusId: "make" };
    if (!v.model) return { ok: false, message: "Falta el modelo.", focusId: "model" };
    if (!/^\d{4}$/u.test(v.year))
      return { ok: false, message: "Año inválido.", focusId: "year" };
    const yearNum = Number(v.year);
    const currentYear = new Date().getFullYear();
    if (yearNum < 1950 || yearNum > currentYear + 1) {
      return {
        ok: false,
        message: `Año fuera de rango (debe estar entre 1950 y ${currentYear + 1}).`,
        focusId: "year",
      };
    }
    if (!/^\d+$/u.test(v.mileage))
      return { ok: false, message: "Kilometraje inválido.", focusId: "mileage" };
    const mileageNum = Number(v.mileage);
    if (mileageNum > 2_000_000) {
      return {
        ok: false,
        message:
          "Kilometraje sospechoso (> 2.000.000 km). Revisa el dato antes de continuar.",
        focusId: "mileage",
      };
    }
    if (!v.inspector) return { ok: false, message: "Falta el nombre del perito.", focusId: "inspector" };
    if (!v.date) return { ok: false, message: "Falta la fecha.", focusId: "date" };
    const docs = data.documents;
    if (!docs?.ownershipCardFront?.length)
      return { ok: false, message: "Falta foto del frente de la tarjeta de propiedad." };
    if (!docs?.ownershipCardBack?.length)
      return { ok: false, message: "Falta foto del reverso de la tarjeta de propiedad." };
    // Chequeo de payload de las fotos: si la "foto" del frente/reverso quedó
    // como un dataURL trivial (cámara congelada, archivo corrupto), bloqueamos
    // antes de que el peritaje siga con evidencia inútil.
    if (!docs.ownershipCardFront.some(isImageEntryUsable)) {
      return {
        ok: false,
        message:
          "La foto del frente de la tarjeta parece corrupta o muy pequeña. Tomala de nuevo.",
      };
    }
    if (!docs.ownershipCardBack.some(isImageEntryUsable)) {
      return {
        ok: false,
        message:
          "La foto del reverso de la tarjeta parece corrupta o muy pequeña. Tomala de nuevo.",
      };
    }
    // Warning suave: si el VIN está llenado pero no tiene 17 chars válidos,
    // avisamos sin bloquear (puede ser un VIN parcial legítimo en algunas
    // motos viejas, así que no lo hacemos hard-fail).
    if (v.vin) {
      const vinClean = v.vin.replace(/\s+/g, "").toUpperCase();
      if (vinClean.length !== 17 || /[IOQ]/u.test(vinClean)) {
        return {
          ok: true,
          warning:
            "El VIN no parece estar completo (deben ser 17 caracteres alfanuméricos sin I/O/Q). Revísalo cuando puedas.",
        };
      }
    }
    return { ok: true };
  }

  if (isWalkaroundStageStep(step)) {
    const active = activeSectionsFor(data.kind, data.vehicleType);
    const sequence = walkaroundSequenceFor(data.vehicleType, active).filter(
      (e) => e.stage === step,
    );
    // Acumulamos pendientes de foto como warning suave: el perito puede
    // resolverlas en el paso final "Fotografías adicionales". Solo bloqueamos
    // por errores duros (rango de profundidad fuera de [0,100]).
    let missingPhotos = 0;
    for (const entry of sequence) {
      if (entry.kind === "item") {
        const bucket = data[entry.sectionId] as
          | Record<string, InspectionEntry>
          | undefined;
        const r = bucket?.[entry.itemId];
        const need = minPhotosFor(r?.status);
        const have = r?.images.length ?? 0;
        if (need > 0 && have < need) missingPhotos += need - have;
      } else if (entry.kind === "tire") {
        const depthKey = (
          {
            fl: "frontLeft",
            fr: "frontRight",
            rl: "rearLeft",
            rr: "rearRight",
            spare: "spare",
          } as const
        )[entry.position];
        const depth = data.tires[depthKey];
        if (depth < 0 || depth > 100) {
          return {
            ok: false,
            message: `Profundidad fuera de rango en ${entry.label}.`,
          };
        }
        const f = data.tires.findings?.[entry.position];
        const need = minPhotosFor(f?.status);
        const have = f?.images?.length ?? 0;
        if (need > 0 && have < need) missingPhotos += need - have;
      }
    }
    if (missingPhotos > 0) {
      return {
        ok: true,
        warning:
          missingPhotos === 1
            ? "Falta 1 foto en esta etapa. Puedes subirla al final."
            : `Faltan ${missingPhotos} fotos en esta etapa. Puedes subirlas al final.`,
      };
    }
    return { ok: true };
  }

  if (step === "extraPhotos") {
    const m = data.mandatoryPhotos;
    const slots: { key: keyof InspectionData["mandatoryPhotos"]; label: string }[] = [
      { key: "diagonalFrontLeft", label: "Diagonal Delantera Izquierda" },
      { key: "diagonalRearRight", label: "Diagonal Trasera Derecha" },
      { key: "innerCabin", label: "Habitáculo Interno" },
      { key: "chassisNumber", label: "Número de Chasis" },
      { key: "engineNumber", label: "Número de Motor" },
      { key: "idPlate", label: "Número de Plaqueta" },
    ];
    const missing = slots.filter((s) => !(m?.[s.key]?.length ?? 0));
    if (missing.length > 0) {
      return {
        ok: false,
        message:
          missing.length === 1
            ? `Falta la foto: ${missing[0].label}.`
            : `Faltan ${missing.length} fotos obligatorias: ${missing.map((s) => s.label).join(", ")}.`,
      };
    }
    return { ok: true };
  }

  if (step === "leaks") {
    const record = data.leaks;
    let missingPhotos = 0;
    for (const group of LEAKS_SECTION.groups) {
      for (const item of group.items) {
        const r = record[item.id];
        const need = minPhotosFor(r?.status);
        const have = r?.images.length ?? 0;
        if (need > 0 && have < need) missingPhotos += need - have;
      }
    }
    if (missingPhotos > 0) {
      return {
        ok: true,
        warning:
          missingPhotos === 1
            ? "Falta 1 foto en líquidos del motor. Puedes subirla al final."
            : `Faltan ${missingPhotos} fotos en líquidos del motor. Puedes subirlas al final.`,
      };
    }
    return { ok: true };
  }

  if (step === "roadTest") {
    if (data.roadTestSkipped) return { ok: true };
    const record = data.roadTest;
    let missingPhotos = 0;
    for (const group of ROAD_TEST_SECTION.groups) {
      for (const item of group.items) {
        const r = record[item.id];
        const need = minPhotosFor(r?.status);
        const have = r?.images.length ?? 0;
        if (need > 0 && have < need) missingPhotos += need - have;
      }
    }
    if (missingPhotos > 0) {
      return {
        ok: true,
        warning:
          missingPhotos === 1
            ? "Falta 1 foto en la prueba de ruta. Puedes subirla al final."
            : `Faltan ${missingPhotos} fotos en la prueba de ruta. Puedes subirlas al final.`,
      };
    }
    return { ok: true };
  }

  return { ok: true };
}

function isStepComplete(step: StepId, data: InspectionData): boolean {
  if (!validateStep(step, data).ok) return false;
  if (step === "vehicle") return true;
  if (isWalkaroundStageStep(step)) {
    const active = activeSectionsFor(data.kind, data.vehicleType);
    const sequence = walkaroundSequenceFor(data.vehicleType, active).filter(
      (e) => e.stage === step,
    );
    return sequence.every((entry) => {
      if (entry.kind === "item") {
        const bucket = data[entry.sectionId] as
          | Record<string, InspectionEntry>
          | undefined;
        return !!bucket?.[entry.itemId]?.status;
      }
      if (entry.kind === "tire") {
        return !!data.tires.findings?.[entry.position]?.status;
      }
      // Compounds: interior_delantera exige status en todos los sub-items;
      // accessories lo damos por completo (el perito puede dejarla vacía).
      if (entry.compoundKey === "interior_delantera") {
        return Object.keys(data.comfort ?? {}).length > 0;
      }
      return true;
    });
  }
  if (step === "leaks") {
    return LEAKS_SECTION.groups.every((g) =>
      g.items.every((i) => !!data.leaks[i.id]?.status),
    );
  }
  if (step === "roadTest") {
    if (data.roadTestSkipped) return true;
    return ROAD_TEST_SECTION.groups.every((g) =>
      g.items.every((i) => !!data.roadTest[i.id]?.status),
    );
  }
  if (step === "summary") {
    return !!data.conclusion.generalCondition;
  }
  return true;
}

function WizardInner() {
  const { data, setData, isHydrated, notFound, isReadOnly, id: inspectionId } = useInspection();
  const [current, setCurrent] = React.useState<StepId>("vehicle");
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const toast = useToast();
  const router = useRouter();

  const activeStepIds = React.useMemo(
    () => activeStepsFor(data.kind, data.vehicleType),
    [data.kind, data.vehicleType],
  );
  const activeStepSet = React.useMemo(() => new Set(activeStepIds), [activeStepIds]);
  const activeSteps = React.useMemo(
    () => WIZARD_STEPS.filter((s) => activeStepSet.has(s.id)),
    [activeStepSet],
  );
  const kindDef = PERITAJE_KINDS[data.kind];
  const vehicleTypeDef = VEHICLE_TYPES[data.vehicleType];

  // If the user lands on a step that's not part of the active kind (rare:
  // happens if the kind was changed mid-edit), snap back to the first step.
  React.useEffect(() => {
    if (!activeStepSet.has(current)) {
      setCurrent(activeSteps[0]?.id ?? "vehicle");
    }
  }, [activeStepSet, activeSteps, current]);

  const handleDownloadPdf = React.useCallback(async () => {
    setPdfBusy(true);
    try {
      await downloadInspectionPdf(data, "executive", inspectionId);
      toast.show({ title: "PDF generado", variant: "success" });
    } catch (err) {
      toast.show({
        title: "No se pudo generar el PDF",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "danger",
      });
    } finally {
      setPdfBusy(false);
    }
  }, [data, toast, inspectionId]);

  const completed = React.useMemo(() => {
    const set = new Set<StepId>();
    for (const s of activeSteps) {
      if (isStepComplete(s.id, data)) set.add(s.id);
    }
    return set;
  }, [activeSteps, data]);

  const statsByStep = React.useMemo(() => {
    const stats: Partial<Record<StepId, StepStats>> = {};
    // Hallazgos por etapa del recorrido — contamos findings con tono
    // warning/danger en los entries de cada etapa.
    const active = activeSectionsFor(data.kind, data.vehicleType);
    const sequence = walkaroundSequenceFor(data.vehicleType, active);
    const byStage = new Map<StepId, number>();
    for (const entry of sequence) {
      let status: string | undefined;
      if (entry.kind === "item") {
        const bucket = data[entry.sectionId] as
          | Record<string, InspectionEntry>
          | undefined;
        status = bucket?.[entry.itemId]?.status;
      } else if (entry.kind === "tire") {
        status = data.tires.findings?.[entry.position]?.status;
      }
      const opt = findOption(status);
      if (opt && (opt.tone === "warning" || opt.tone === "danger")) {
        byStage.set(entry.stage, (byStage.get(entry.stage) ?? 0) + 1);
      }
    }
    for (const [stageId, count] of byStage.entries()) {
      stats[stageId] = { findings: count };
    }
    stats.roadTest = {
      findings: data.roadTestSkipped ? 0 : countFindingsInRecord(data.roadTest),
    };
    stats.leaks = { findings: countFindingsInRecord(data.leaks) };
    return stats;
  }, [data]);

  const currentIndex = Math.max(
    activeSteps.findIndex((s) => s.id === current),
    0,
  );
  const progress = Math.round(((currentIndex + 1) / activeSteps.length) * 100);

  const goNext = React.useCallback(() => {
    const v = validateStep(current, data);
    if (!v.ok) {
      toast.show({ title: "Revise los datos", description: v.message, variant: "warning" });
      // Mover el foco al campo / row que disparó el error mejora el flujo
      // móvil: en pantallas chicas el toast puede quedar oculto detrás del
      // teclado y sin esto el usuario no ve qué falta.
      if (typeof window !== "undefined") {
        if (v.focusId) {
          const el = document.getElementById(v.focusId) as
            | HTMLElement
            | null;
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            // El focus inmediato choca con el scroll suave en algunos
            // browsers — postergamos un tick.
            window.setTimeout(() => {
              try {
                el.focus({ preventScroll: true });
              } catch {
                /* noop */
              }
            }, 250);
          }
        } else if (v.scrollItemId) {
          const el = document.querySelector<HTMLElement>(
            `[data-item-id="${v.scrollItemId}"]`,
          );
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return;
    }
    if (v.warning) {
      toast.show({
        title: "Fotos pendientes",
        description: v.warning,
        variant: "warning",
      });
    }
    setData((prev) => {
      const list = prev.confirmedSteps ?? [];
      if (list.includes(current)) return prev;
      return { ...prev, confirmedSteps: [...list, current] };
    });
    const next = activeSteps[Math.min(currentIndex + 1, activeSteps.length - 1)];
    setCurrent(next.id);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeSteps, current, currentIndex, data, setData, toast]);

  const goPrev = React.useCallback(() => {
    const prev = activeSteps[Math.max(currentIndex - 1, 0)];
    setCurrent(prev.id);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeSteps, currentIndex]);

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
        <Button onClick={() => router.push("/peritajes")}>Volver a peritajes</Button>
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
            onClick={() => router.push("/peritajes")}
            className="-ml-2 mb-1 h-8 gap-1 px-2 text-xs text-muted-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Volver a peritajes
          </Button>
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {kindDef.label} · {vehicleTypeDef.label}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {data.vehicle.plate ? (
              <span className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                {data.vehicle.plate}
              </span>
            ) : null}
            <span>
              Paso {currentIndex + 1} de {activeSteps.length} ·{" "}
              {activeSteps[currentIndex]?.label ?? ""}
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
        </div>
      </div>

      <Progress value={progress} />

      <Stepper
        current={current}
        onSelect={setCurrent}
        completed={completed}
        statsByStep={statsByStep}
        steps={activeSteps}
      />

      {isReadOnly && (
        <div className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Peritaje finalizado</div>
              <div className="text-xs text-muted-foreground">
                {data.completedAt
                  ? `Cerrado el ${formatDate(data.completedAt.slice(0, 10))} · inmutable`
                  : "Inmutable — sólo lectura"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={pdfBusy}
              className="h-9"
            >
              <Download className="mr-1.5 h-4 w-4" />
              {pdfBusy ? "Generando…" : "Descargar PDF"}
            </Button>
          </div>
        </div>
      )}

      <fieldset disabled={isReadOnly} className="m-0 min-w-0 border-0 p-0">
        {current === "vehicle" && <VehicleInfoStep />}
        {isWalkaroundStageStep(current) && (
          <WalkaroundStep stage={current as WalkaroundStageStepId} />
        )}
        {current === "leaks" && <LeaksStep />}
        {current === "roadTest" && <RoadTestStep />}
        {current === "extraPhotos" && <ExtraPhotosStep />}
        {current === "summary" && <SummaryStep />}
      </fieldset>

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
          {completed.size}/{activeSteps.length} pasos completos
        </div>
        <Button
          onClick={goNext}
          size="lg"
          disabled={currentIndex === activeSteps.length - 1}
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
      <ErrorBoundary
        title="No se pudo cargar el peritaje"
        description="Hubo un error al hidratar esta inspección. Si pasa seguido, copia el detalle y avísanos."
      >
        <InspectionProvider id={id}>
          <WizardInner />
        </InspectionProvider>
      </ErrorBoundary>
    </UIPreferencesProvider>
  );
}
