"use client";

import * as React from "react";
import { Moon, Sun, SunMedium } from "lucide-react";

import { cn } from "@/lib/utils";

import { useUIPreferences, type Theme } from "./ui-preferences";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "outdoor", label: "Exterior (alto contraste)", icon: SunMedium },
];

export function ThemeToggle() {
  const { prefs, setPrefs } = useUIPreferences();
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5"
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = prefs.theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPrefs({ theme: o.value })}
            title={o.label}
            aria-label={o.label}
            className={cn(
              "flex h-7 w-8 items-center justify-center rounded-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
