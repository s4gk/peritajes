"use client";

import * as React from "react";
import { Check, Plus, Trash2 } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InspectionItemRow } from "@/components/shared/inspection-item-row";
import { defaultOkValueFor, findOption } from "@/lib/findings-catalog";
import { MIN_CYLINDERS } from "@/lib/default-data";
import type {
  CylinderEntry,
  InspectionData,
  InspectionEntry,
  InspectionItemDef,
  InspectionSectionDef,
} from "@/lib/types";
import { makeId } from "@/lib/utils";

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
  const { data, setData, isReadOnly } = useInspection();
  const sectionData = data[section.id] as Record<string, InspectionEntry>;
  const cylinders =
    section.id === "engine" ? (data.engineCompression ?? []) : [];

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

  function setCylinders(list: CylinderEntry[]) {
    setData((prev) => ({ ...prev, engineCompression: list }) as InspectionData);
  }

  function addCylinder() {
    const next = [...cylinders];
    next.push({
      id: makeId(),
      label: `Cilindro ${next.length + 1}`,
      status: undefined,
      notes: "",
      images: [],
    });
    setCylinders(next);
  }

  function updateCylinder(id: string, patch: Partial<CylinderEntry>) {
    setCylinders(cylinders.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeCylinder(id: string) {
    if (cylinders.length <= MIN_CYLINDERS) return;
    setCylinders(cylinders.filter((c) => c.id !== id));
  }

  function markGroupOk(groupId: string) {
    const group = section.groups.find((g) => g.id === groupId);
    if (!group) return;
    if (section.id === "engine" && groupId === "compression") {
      setCylinders(
        cylinders.map((c) =>
          c.status ? c : { ...c, status: defaultOkValueFor("mechanical") },
        ),
      );
      return;
    }
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
    <Accordion type="multiple" defaultValue={[]}>
      {section.groups.map((group) => {
        const isDynamicCompression =
          section.id === "engine" && group.id === "compression";
        const entries = isDynamicCompression
          ? cylinders.map((c) => ({ status: c.status }) as InspectionEntry)
          : group.items.map((i) => sectionData?.[i.id]);
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        markGroupOk(group.id);
                      }}
                      aria-label={`Marcar items restantes de "${group.label}" como OK`}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2.5 text-[11px] font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Check className="h-3 w-3" />
                      <span className="hidden sm:inline">Marcar restantes </span>
                      OK
                    </button>
                  )}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {isDynamicCompression ? (
                <div className="space-y-2">
                  {cylinders.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      Sin cilindros. Agrega uno con el botón de abajo para
                      registrar la compresión por cilindro.
                    </div>
                  )}
                  {cylinders.map((cyl) => {
                    const itemDef: InspectionItemDef = {
                      id: cyl.id,
                      label: cyl.label,
                      kind: "mechanical",
                    };
                    return (
                      <div key={cyl.id} className="space-y-2">
                        <InspectionItemRow
                          item={itemDef}
                          entry={{
                            status: cyl.status,
                            notes: cyl.notes ?? "",
                            images: cyl.images ?? [],
                          }}
                          onChange={(next) =>
                            updateCylinder(cyl.id, {
                              status: next.status,
                              notes: next.notes,
                              images: next.images,
                            })
                          }
                        />
                        {!isReadOnly && cylinders.length > MIN_CYLINDERS && (
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeCylinder(cyl.id)}
                              className="h-8 text-danger hover:text-danger"
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                              Quitar {cyl.label}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!isReadOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={addCylinder}
                      className="w-full sm:w-auto"
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Agregar cilindro
                    </Button>
                  )}
                </div>
              ) : (
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
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

export { SectionAccordion as default };
