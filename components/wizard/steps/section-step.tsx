"use client";

import * as React from "react";
import { CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { defaultOkValueFor, findOption } from "@/lib/findings-catalog";
import type {
  InspectionData,
  InspectionEntry,
  InspectionSectionDef,
} from "@/lib/types";
import SectionAccordion from "../section-accordion";
import { useInspection } from "../inspection-context";

type Props = {
  section: InspectionSectionDef;
  title: string;
  description?: string;
};

export function SectionStep({ section, title, description }: Props) {
  const { data, setData, isReadOnly } = useInspection();
  const toast = useToast();
  const sectionData = data[section.id] as Record<string, InspectionEntry>;
  const autoFilledRef = React.useRef(false);

  // Auto pre-mark every item as Original on first entry to a virgin section.
  // Runs once per mount and only when the section has zero filled items, so
  // it never overrides explicit perito picks (or a re-entry to a section the
  // perito already cleared on purpose).
  React.useEffect(() => {
    if (autoFilledRef.current) return;
    if (isReadOnly) return;
    let anyFilled = false;
    for (const g of section.groups) {
      for (const it of g.items) {
        if (sectionData?.[it.id]?.status) {
          anyFilled = true;
          break;
        }
      }
      if (anyFilled) break;
    }
    if (anyFilled) {
      autoFilledRef.current = true;
      return;
    }
    autoFilledRef.current = true;
    const nextRecord: Record<string, InspectionEntry> = { ...sectionData };
    for (const group of section.groups) {
      for (const item of group.items) {
        const existing = nextRecord[item.id] ?? {
          status: undefined,
          notes: "",
          images: [],
        };
        nextRecord[item.id] = { ...existing, status: defaultOkValueFor(item.kind) };
      }
    }
    setData((prev) => ({ ...prev, [section.id]: nextRecord } as InspectionData));
    // No toast on auto-fill: it'd fire every time the perito enters a fresh
    // section, which gets noisy. The progress counter shows N/N immediately.
  }, [section, sectionData, setData, isReadOnly]);

  const { filled, total, issues } = React.useMemo(() => {
    let t = 0;
    let f = 0;
    let i = 0;
    for (const g of section.groups) {
      for (const it of g.items) {
        t += 1;
        const e = sectionData?.[it.id];
        const opt = findOption(e?.status);
        if (opt) {
          f += 1;
          if (opt.tone === "warning" || opt.tone === "danger") i += 1;
        }
      }
    }
    return { filled: f, total: t, issues: i };
  }, [section, sectionData]);

  function markAllOk() {
    let changed = 0;
    const nextRecord: Record<string, InspectionEntry> = { ...sectionData };
    for (const group of section.groups) {
      for (const item of group.items) {
        const existing = nextRecord[item.id] ?? {
          status: undefined,
          notes: "",
          images: [],
        };
        if (!existing.status) {
          nextRecord[item.id] = { ...existing, status: defaultOkValueFor(item.kind) };
          changed += 1;
        }
      }
    }

    if (changed === 0) {
      toast.show({
        title: "Todo ya estaba marcado",
        description: "No había ítems pendientes por completar.",
        variant: "default",
      });
      return;
    }

    setData((prev) => ({ ...prev, [section.id]: nextRecord } as InspectionData));
    toast.show({
      title: `${changed} ítem${changed === 1 ? "" : "s"} marcado${changed === 1 ? "" : "s"} OK`,
      description: "Toca cada ítem para ajustar las excepciones.",
      variant: "success",
    });
  }

  const allFilled = filled === total;
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100);

  return (
    <Card>
      <CardHeader className="space-y-3 sm:space-y-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle>{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Inspeccionados
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {filled}
                <span className="text-muted-foreground">/{total}</span>
              </div>
              {issues > 0 && (
                <div className="text-[11px] font-medium text-warning">
                  {issues} hallazgo{issues === 1 ? "" : "s"}
                </div>
              )}
            </div>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>
        {!allFilled && (
          <Button
            type="button"
            onClick={markAllOk}
            size="lg"
            className="w-full justify-center gap-2 sm:w-auto sm:self-start"
          >
            <CheckCheck className="h-4 w-4" />
            <span>
              Marcar {total - filled} restante{total - filled === 1 ? "" : "s"} como original
            </span>
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        <SectionAccordion section={section} />
      </CardContent>
    </Card>
  );
}
