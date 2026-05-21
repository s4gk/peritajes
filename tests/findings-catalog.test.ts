import { describe, it, expect } from "vitest";
import {
  FINDING_CATALOGS,
  findOption,
  defaultOkValueFor,
  isOkFinding,
  requiresPhoto,
} from "@/lib/findings-catalog";
import type { ItemKind } from "@/lib/types";

const KINDS: ItemKind[] = ["bodywork", "structural", "mechanical", "road_test", "leak", "light_unit", "panoramic"];

describe("findings-catalog: structural integrity", () => {
  it("every kind has a catalog with at least one quick OK option", () => {
    for (const k of KINDS) {
      const cat = FINDING_CATALOGS[k];
      expect(cat, `missing catalog for ${k}`).toBeTruthy();
      expect(cat.quick.length).toBeGreaterThan(0);
      const ok = cat.quick.find((o) => o.tone === "success");
      expect(ok, `${k} needs a success quick option`).toBeTruthy();
    }
  });

  it("any value reused across catalogs has the same definition", () => {
    // Some values (like "na") are intentionally shared across catalogs.
    // The invariant that matters: same value MUST mean the same thing,
    // otherwise findOption() returns whichever catalog loaded last.
    const seen = new Map<string, { tone: string; label: string }>();
    const conflicts: string[] = [];
    for (const cat of Object.values(FINDING_CATALOGS)) {
      const allOpts = [...cat.quick, ...cat.categories.flatMap((c) => c.options)];
      for (const opt of allOpts) {
        const prev = seen.get(opt.value);
        if (prev && (prev.tone !== opt.tone || prev.label !== opt.label)) {
          conflicts.push(`${opt.value} (${prev.tone}/${prev.label} vs ${opt.tone}/${opt.label})`);
        }
        seen.set(opt.value, { tone: opt.tone, label: opt.label });
      }
    }
    expect(conflicts, `conflicting redefinitions: ${conflicts.join("; ")}`).toEqual([]);
  });

  it("severity is set on every non-success/non-neutral option", () => {
    for (const cat of Object.values(FINDING_CATALOGS)) {
      for (const c of cat.categories) {
        for (const opt of c.options) {
          if (opt.tone === "warning" || opt.tone === "danger") {
            expect(opt.severity, `${opt.value} missing severity`).toBeDefined();
            expect([1, 2, 3]).toContain(opt.severity);
          }
        }
      }
    }
  });
});

describe("findOption", () => {
  it("returns undefined for unknown / empty values", () => {
    expect(findOption(undefined)).toBeUndefined();
    expect(findOption("")).toBeUndefined();
    expect(findOption("does_not_exist")).toBeUndefined();
  });

  it("finds quick options across catalogs", () => {
    expect(findOption("common_good")?.tone).toBe("success");
    expect(findOption("leak_none")?.tone).toBe("success");
    expect(findOption("road_optimal")?.tone).toBe("success");
  });

  it("preserves legacy values for historical peritajes", () => {
    // Catálogos viejos (bodywork/structural/mechanical) ya no son seleccionables,
    // pero sus valores siguen resolviendo labels para peritajes ya guardados.
    expect(findOption("original")?.tone).toBe("success");
    expect(findOption("mech_optimal")?.tone).toBe("success");
    expect(findOption("structural_original")?.tone).toBe("success");
    expect(findOption("repainted_full")?.tone).toBe("warning");
    expect(findOption("scratch_surface")?.tone).toBe("warning");
  });

  it("finds danger options with correct severity", () => {
    const opt = findOption("road_braking_deficient");
    expect(opt).toBeTruthy();
    expect(opt?.tone).toBe("danger");
    expect(opt?.risks).toContain("braking_fail");
  });
});

describe("defaultOkValueFor", () => {
  it("returns the success value for each kind", () => {
    expect(defaultOkValueFor("bodywork")).toBe("common_good");
    expect(defaultOkValueFor("structural")).toBe("common_good");
    expect(defaultOkValueFor("mechanical")).toBe("common_good");
    expect(defaultOkValueFor("road_test")).toBe("road_optimal");
    expect(defaultOkValueFor("leak")).toBe("leak_none");
    expect(defaultOkValueFor("light_unit")).toBe("light_ok");
    expect(defaultOkValueFor("panoramic")).toBe("panoramic_good");
  });
});

describe("isOkFinding", () => {
  it("treats success and neutral as OK", () => {
    expect(isOkFinding("common_good")).toBe(true);
    expect(isOkFinding("na")).toBe(true);
    expect(isOkFinding("original")).toBe(true); // legacy
    expect(isOkFinding("mech_optimal")).toBe(true); // legacy
  });

  it("treats warning/danger as not OK", () => {
    expect(isOkFinding("common_regular")).toBe(false);
    expect(isOkFinding("common_deformed")).toBe(false);
    expect(isOkFinding("repainted_full")).toBe(false); // legacy
    expect(isOkFinding("road_braking_deficient")).toBe(false);
  });

  it("treats undefined / unknown as not OK", () => {
    expect(isOkFinding(undefined)).toBe(false);
    expect(isOkFinding("does_not_exist")).toBe(false);
  });
});

describe("requiresPhoto", () => {
  it("never requires a photo — la foto siempre es opcional", () => {
    // Antes algunas calificaciones forzaban foto; ahora todas son opcionales.
    expect(requiresPhoto("common_good")).toBe(false);
    expect(requiresPhoto("common_regular")).toBe(false);
    expect(requiresPhoto("common_deformed")).toBe(false);
    expect(requiresPhoto("road_braking_deficient")).toBe(false);
    expect(requiresPhoto("na")).toBe(false);
    expect(requiresPhoto("original")).toBe(false); // legacy
    expect(requiresPhoto(undefined)).toBe(false);
    expect(requiresPhoto("does_not_exist")).toBe(false);
  });
});
