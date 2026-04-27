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
import { useToast } from "@/components/ui/toast";
import { defaultOkValueFor } from "@/lib/findings-catalog";
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
  const { data, setData } = useInspection();
  const toast = useToast();
  const sectionData = data[section.id] as Record<string, InspectionEntry>;

  const { filled, total, hasIssues } = React.useMemo(() => {
    let t = 0;
    let f = 0;
    let issues = false;
    for (const g of section.groups) {
      for (const it of g.items) {
        t += 1;
        const e = sectionData?.[it.id];
        if (e?.status) {
          f += 1;
          // tone-based issue detection is handled in accordion; we only need counts here
        }
      }
    }
    return { filled: f, total: t, hasIssues: issues };
  }, [section, sectionData]);

  function markAllOk() {
    // Pre-compute from current data so we can notify without running side effects
    // inside the state updater (which fires during render).
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
      description: "Puede ajustar las excepciones directamente.",
      variant: "success",
    });
  }

  const allFilled = filled === total;

  return (
    <Card>
      <CardHeader className="space-y-3 sm:space-y-4">
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
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
              Todo OK en {title.toLowerCase()} · marcar {total - filled} restante
              {total - filled === 1 ? "" : "s"}
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
