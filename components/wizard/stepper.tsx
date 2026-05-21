"use client";

import * as React from "react";
import { AlertTriangle, Check, ListChecks, Menu } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WIZARD_STEPS, type StepId } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type StepStats = {
  findings: number;
};

type StepEntry = (typeof WIZARD_STEPS)[number];

type Props = {
  current: StepId;
  onSelect: (step: StepId) => void;
  completed: Set<StepId>;
  statsByStep?: Partial<Record<StepId, StepStats>>;
  /** Optional whitelist; when provided, only these steps are shown. */
  steps?: readonly StepEntry[];
};

export function Stepper({ current, onSelect, completed, statsByStep, steps }: Props) {
  const visibleSteps: readonly StepEntry[] = steps ?? WIZARD_STEPS;
  const currentIndex = Math.max(
    visibleSteps.findIndex((s) => s.id === current),
    0,
  );
  const currentStep = visibleSteps[currentIndex];
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const totalFindings = React.useMemo(() => {
    if (!statsByStep) return 0;
    return Object.values(statsByStep).reduce((acc, s) => acc + (s?.findings ?? 0), 0);
  }, [statsByStep]);

  function selectAndClose(id: StepId) {
    onSelect(id);
    setDrawerOpen(false);
  }

  return (
    <>
      {/* Mobile: single trigger that opens a drawer/dialog */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir lista de pasos"
          className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
              {currentIndex + 1}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Paso {currentIndex + 1} / {visibleSteps.length}
              </div>
              <div className="truncate text-sm font-semibold">{currentStep?.label ?? ""}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {totalFindings > 0 && (
              <Badge variant="warning" className="text-[10px]">
                {totalFindings}
              </Badge>
            )}
            <Menu className="h-5 w-5 text-muted-foreground" />
          </div>
        </button>
      </div>

      {/* Desktop/tablet: horizontal compact list */}
      <nav
        aria-label="Progreso"
        className="no-scrollbar hidden gap-1 overflow-x-auto rounded-lg border bg-card p-1.5 md:flex"
      >
        {visibleSteps.map((step, idx) => {
          const isDone = completed.has(step.id);
          const isActive = step.id === current;
          const stats = statsByStep?.[step.id];
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelect(step.id)}
              className={cn(
                "group relative flex min-w-fit items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  isActive
                    ? "bg-primary-foreground/20"
                    : isDone
                      ? "bg-success text-success-foreground"
                      : idx < currentIndex
                        ? "bg-muted-foreground/20 text-muted-foreground"
                        : "bg-muted text-muted-foreground",
                )}
              >
                {isDone ? <Check className="h-3 w-3" /> : idx + 1}
              </span>
              <span className="whitespace-nowrap font-medium">{step.short}</span>
              {stats && stats.findings > 0 && (
                <span
                  className={cn(
                    "ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold",
                    isActive
                      ? "bg-primary-foreground/25 text-primary-foreground"
                      : "bg-warning/15 text-warning",
                  )}
                >
                  {stats.findings}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Drawer — reuses the Dialog primitive, styled as a full-height side sheet */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="left-0 top-0 h-screen max-h-screen w-full max-w-sm translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-l-0 p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:rounded-none">
          <DialogHeader className="border-b px-4 py-4">
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              Pasos del peritaje
            </DialogTitle>
            <DialogDescription>
              Toque un paso para ir directo. Los hallazgos aparecen con chip naranja.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <ul className="space-y-1">
              {visibleSteps.map((step, idx) => {
                const isDone = completed.has(step.id);
                const isActive = step.id === current;
                const stats = statsByStep?.[step.id];
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      onClick={() => selectAndClose(step.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                          isActive
                            ? "bg-primary-foreground/20"
                            : isDone
                              ? "bg-success text-success-foreground"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {isDone ? <Check className="h-4 w-4" /> : idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{step.label}</div>
                        <div
                          className={cn(
                            "text-[11px]",
                            isActive
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {isDone ? "Completo" : "Pendiente"}
                        </div>
                      </div>
                      {stats && stats.findings > 0 && (
                        <Badge
                          variant={isActive ? "default" : "warning"}
                          className="shrink-0 gap-1 text-[10px]"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {stats.findings}
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="border-t px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setDrawerOpen(false)}
            >
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
