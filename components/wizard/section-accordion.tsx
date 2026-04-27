"use client";

import * as React from "react";
import { Check } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { InspectionItemRow } from "@/components/shared/inspection-item-row";
import { defaultOkValueFor, findOption } from "@/lib/findings-catalog";
import type {
  InspectionData,
  InspectionEntry,
  InspectionSectionDef,
} from "@/lib/types";

import { useInspection } from "./inspection-context";

function computeGroupStatus(
  entries: (InspectionEntry | undefined)[],
): { filled: number; total: number; hasIssues: boolean } {
  const total = entries.length;
  let filled = 0;
  let hasIssues = false;
  for (const e of entries) {
    const opt = findOption(e?.status);
    if (opt) {
      filled += 1;
      if (opt.tone === "warning" || opt.tone === "danger") hasIssues = true;
    }
  }
  return { filled, total, hasIssues };
}

type Props = {
  section: InspectionSectionDef;
};

export function SectionAccordion({ section }: Props) {
  const { data, setData } = useInspection();
  const sectionData = data[section.id] as Record<string, InspectionEntry>;

  function updateItem(itemId: string, entry: InspectionEntry) {
    setData(
      (prev) =>
        ({
          ...prev,
          [section.id]: {
            ...(prev[section.id] as Record<string, InspectionEntry>),
            [itemId]: entry,
          },
        }) as InspectionData,
    );
  }

  function markGroupOk(groupId: string) {
    const group = section.groups.find((g) => g.id === groupId);
    if (!group) return;
    setData((prev) => {
      const current = prev[section.id] as Record<string, InspectionEntry>;
      const next = { ...current };
      for (const item of group.items) {
        const existing = next[item.id] ?? { status: undefined, notes: "", images: [] };
        // Only fill items without a selection — never override an explicit finding
        if (!existing.status) {
          next[item.id] = { ...existing, status: defaultOkValueFor(item.kind) };
        }
      }
      return { ...prev, [section.id]: next } as InspectionData;
    });
  }

  return (
    <Accordion type="multiple" defaultValue={section.groups.map((g) => g.id)}>
      {section.groups.map((group) => {
        const entries = group.items.map((i) => sectionData?.[i.id]);
        const { filled, total, hasIssues } = computeGroupStatus(entries);
        const allFilled = filled === total;

        return (
          <AccordionItem key={group.id} value={group.id}>
            <AccordionTrigger className="text-left">
              <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pr-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium sm:text-base">
                  {group.label}
                </span>
                <div className="flex items-center gap-1.5">
                  {hasIssues && (
                    <Badge variant="danger" className="text-[10px]">
                      Hallazgos
                    </Badge>
                  )}
                  <Badge variant={allFilled ? "success" : "outline"} className="text-[10px]">
                    {filled}/{total}
                  </Badge>
                  {!allFilled && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        markGroupOk(group.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          markGroupOk(group.id);
                        }
                      }}
                      className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-2.5 text-[11px] font-medium transition-colors hover:bg-accent"
                    >
                      <Check className="h-3 w-3" />
                      <span className="hidden sm:inline">Marcar restantes </span>
                      OK
                    </span>
                  )}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <InspectionItemRow
                    key={item.id}
                    item={item}
                    entry={sectionData?.[item.id]}
                    onChange={(next) => updateItem(item.id, next)}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

export { SectionAccordion as default };
