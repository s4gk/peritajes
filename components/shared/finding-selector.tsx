"use client";

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findOption, type FindingCatalog, type Tone } from "@/lib/findings-catalog";
import { cn } from "@/lib/utils";

const TONE_BG: Record<Tone, string> = {
  success: "bg-success/10 border-success/40 text-success hover:bg-success/15",
  warning: "bg-warning/10 border-warning/40 text-warning hover:bg-warning/15",
  danger: "bg-danger/10 border-danger/40 text-danger hover:bg-danger/15",
  neutral: "bg-muted border-border text-muted-foreground hover:bg-muted/80",
};

const TONE_SELECTED: Record<Tone, string> = {
  success: "bg-success border-success text-success-foreground hover:bg-success",
  warning: "bg-warning border-warning text-warning-foreground hover:bg-warning",
  danger: "bg-danger border-danger text-danger-foreground hover:bg-danger",
  neutral: "bg-muted-foreground border-muted-foreground text-background hover:bg-muted-foreground",
};

const DOT_TONE: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground",
};

type Props = {
  catalog: FindingCatalog;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

export function FindingSelector({ catalog, value, onChange }: Props) {
  const selected = findOption(value);
  const isQuickSelected = selected ? catalog.quick.some((q) => q.value === selected.value) : false;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {catalog.quick.map((q) => {
        const active = value === q.value;
        return (
          <button
            key={q.value}
            type="button"
            onClick={() => onChange(q.value)}
            className={cn(
              "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors min-h-[44px] sm:flex-none",
              active ? TONE_SELECTED[q.tone] : TONE_BG[q.tone],
            )}
          >
            {q.label}
          </button>
        );
      })}

      <Select
        value={!isQuickSelected && selected ? selected.value : ""}
        onValueChange={(v) => onChange(v || undefined)}
      >
        <SelectTrigger
          className={cn(
            "h-auto min-h-[44px] w-full py-2 text-sm font-medium sm:w-auto sm:min-w-[200px]",
            !isQuickSelected && selected
              ? cn("border-2", TONE_BG[selected.tone])
              : "",
          )}
        >
          {!isQuickSelected && selected ? (
            <span className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", DOT_TONE[selected.tone])} />
              {selected.label}
            </span>
          ) : (
            <SelectValue placeholder="Hallazgo específico..." />
          )}
        </SelectTrigger>
        <SelectContent className="max-h-[60vh]">
          {catalog.categories.map((cat) => (
            <SelectGroup key={cat.label}>
              <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {cat.label}
              </SelectLabel>
              {cat.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_TONE[opt.tone])} />
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
