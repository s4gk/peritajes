"use client";

import * as React from "react";
import { Check, CloudUpload, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useInspection } from "./inspection-context";

function formatRelative(ts: number | null, now: number): string {
  if (!ts) return "";
  const delta = Math.max(0, Math.floor((now - ts) / 1000));
  if (delta < 5) return "justo ahora";
  if (delta < 60) return `hace ${delta}s`;
  const mins = Math.floor(delta / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

export function SaveIndicator({ className }: { className?: string }) {
  const { saveStatus, lastSavedAt } = useInspection();
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  if (saveStatus === "saving" || saveStatus === "pending") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Guardando...
      </span>
    );
  }

  if (saveStatus === "saved" || lastSavedAt) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium text-success",
          className,
        )}
      >
        <Check className="h-3 w-3" />
        Guardado {lastSavedAt ? formatRelative(lastSavedAt, now) : ""}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <CloudUpload className="h-3 w-3" />
      Listo
    </span>
  );
}
