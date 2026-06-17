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

// Read the stored preference synchronously so the initial render already has the
// correct theme. This avoids a race between a "load" effect and a "persist" effect
// where the persist effect would momentarily re-apply DEFAULTS (light) and clobber
// the stored value on a full reload (e.g. Ctrl+Shift+R). Keep this in sync with the
// themeBootstrap script in app/layout.tsx.
function readStoredPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.theme === "string" && ["light", "dark", "outdoor"].includes(parsed.theme)) {
      return { theme: parsed.theme as Theme };
    }
    if (parsed.contrastHigh === true) {
      // migrate legacy preference name
      return { theme: "outdoor" };
    }
  } catch {
    // ignore
  }
  return DEFAULTS;
}

export function UIPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefsState] = React.useState<Prefs>(readStoredPrefs);

  // Sync to <html> class + persist whenever prefs change. The initial value already
  // comes from storage, so the first run just re-asserts the correct theme (the
  // themeBootstrap script set it before paint) without ever flashing to default.
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
