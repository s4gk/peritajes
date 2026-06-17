/**
 * Persistencia del tour de uso. Guardamos las "claves" de recorrido ya vistas
 * para auto-lanzar cada una una sola vez por dispositivo: el recorrido general
 * por rol (clave = el rol, p. ej. "owner") y el paso a paso de cada sección
 * (clave = "section:/peritajes"). Mismo estilo que
 * components/wizard/ui-preferences.tsx: clave namespaced, lectura tolerante a
 * fallos y guard de SSR.
 */

const STORAGE_KEY = "perito:tour:v1";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = new Set<string>();
    // Formato actual.
    if (Array.isArray(parsed.seen)) {
      for (const k of parsed.seen) if (typeof k === "string") out.add(k);
    }
    // Migración del formato anterior ({ roles: [...] }).
    if (Array.isArray(parsed.roles)) {
      for (const k of parsed.roles) if (typeof k === "string") out.add(k);
    }
    return [...out];
  } catch {
    return [];
  }
}

export function hasSeenTour(key: string): boolean {
  return read().includes(key);
}

export function markTourSeen(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const seen = read();
    if (seen.includes(key)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ seen: [...seen, key] }));
  } catch {
    // ignore
  }
}
