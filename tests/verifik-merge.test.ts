import { describe, it, expect } from "vitest";
import { mergeVerifikSeeds } from "@/lib/verifik/merge";

describe("verifik merge", () => {
  it("RUNT wins on identity (vin, year, color)", () => {
    const merged = mergeVerifikSeeds(
      { vin: "RUNT_VIN", year: "2021", color: "Rojo" },
      { make: "Mazda" /* fasecolda has no vin/year/color anyway */ },
    );
    expect(merged.vin).toBe("RUNT_VIN");
    expect(merged.year).toBe("2021");
    expect(merged.color).toBe("Rojo");
  });

  it("FASECOLDA wins on model (richer trim string)", () => {
    const merged = mergeVerifikSeeds(
      { model: "SANDERO" },
      { model: "SANDERO [FL] AUTHENTIQUE MT 1600CC 8V AA" },
    );
    expect(merged.model).toBe("SANDERO [FL] AUTHENTIQUE MT 1600CC 8V AA");
  });

  it("falls back to RUNT model when FASECOLDA missing", () => {
    const merged = mergeVerifikSeeds({ model: "CX-30" }, {});
    expect(merged.model).toBe("CX-30");
  });

  it("RUNT make wins, FASECOLDA fills the gap", () => {
    expect(mergeVerifikSeeds({ make: "Mazda" }, { make: "Renault" }).make).toBe("Mazda");
    expect(mergeVerifikSeeds({}, { make: "Renault" }).make).toBe("Renault");
  });

  it("prunes undefined and empty-string values so the seed only spreads real data", () => {
    const merged = mergeVerifikSeeds(
      { plate: "ABC123", color: "" },
      { make: "Renault" },
    );
    expect(merged).toEqual({ plate: "ABC123", make: "Renault" });
  });
});
