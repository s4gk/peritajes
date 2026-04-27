"use client";

import * as React from "react";

const STORAGE_KEY = "perito:ui-prefs:v1";

export type Theme = "light" | "dark" | "outdoor";

type Prefs = {
  theme: Theme;
};

const DEFAULTS: Prefs = { theme: "light" };

type Ctx = {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
};

const UIContext = React.createContext<Ctx | null>(null);

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "contrast-high");
  if (theme === "dark") root.classList.add("dark");
  if (theme === "outdoor") root.classList.add("contrast-high");
}

export function UIPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefsState] = React.useState<Prefs>(DEFAULTS);

  // Load from storage on mount
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.theme === "string" && ["light", "dark", "outdoor"].includes(parsed.theme)) {
        setPrefsState({ theme: parsed.theme as Theme });
      } else if (parsed.contrastHigh === true) {
        // migrate legacy preference name
        setPrefsState({ theme: "outdoor" });
      }
    } catch {
      // ignore
    }
  }, []);

  // Sync to <html> class + persist
  React.useEffect(() => {
    applyTheme(prefs.theme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  const setPrefs = React.useCallback((patch: Partial<Prefs>) => {
    setPrefsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = React.useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUIPreferences() {
  const ctx = React.useContext(UIContext);
  if (!ctx) throw new Error("useUIPreferences must be used within UIPreferencesProvider");
  return ctx;
}
