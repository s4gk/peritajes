import { describe, it, expect } from "vitest";
import {
  fasecoldaToVehicleSeed,
  fasecoldaLatestValueCop,
} from "@/lib/verifik/fasecolda";
import { FASECOLDA_FIXTURE } from "./verifik-fixtures";

describe("fasecolda adapter", () => {
  it("maps marke (typo) → make with title case", () => {
    const seed = fasecoldaToVehicleSeed(FASECOLDA_FIXTURE);
    expect(seed.make).toBe("Renault");
  });

  it("concatenates line1 + line2 + line3 into model", () => {
    const seed = fasecoldaToVehicleSeed(FASECOLDA_FIXTURE);
    expect(seed.model).toBe("SANDERO [FL] AUTHENTIQUE MT 1600CC 8V AA");
  });

  it("maps GASOLINA → gasoline enum", () => {
    const seed = fasecoldaToVehicleSeed(FASECOLDA_FIXTURE);
    expect(seed.fuel).toBe("gasoline");
  });

  it("maps typology HATCHBACK → 'Hatchback' (matches form Select option)", () => {
    const seed = fasecoldaToVehicleSeed(FASECOLDA_FIXTURE);
    expect(seed.bodyType).toBe("Hatchback");
  });

  it("normalizes plate to uppercase", () => {
    const seed = fasecoldaToVehicleSeed({
      ...FASECOLDA_FIXTURE,
      data: { ...FASECOLDA_FIXTURE.data, plate: "abc123" },
    });
    expect(seed.plate).toBe("ABC123");
  });

  it("does NOT populate vin/year/color/owner (only RUNT can)", () => {
    const seed = fasecoldaToVehicleSeed(FASECOLDA_FIXTURE);
    expect(seed.vin).toBeUndefined();
    expect(seed.year).toBeUndefined();
    expect(seed.color).toBeUndefined();
    expect(seed.owner).toBeUndefined();
  });

  it("returns latest market value × 1000 in COP from valueModel", () => {
    // Fixture has 2016 = 34500 (latest). 34500 × 1000 = $34,500,000 COP.
    expect(fasecoldaLatestValueCop(FASECOLDA_FIXTURE)).toBe(34_500_000);
  });

  it("returns null when valueModel is empty", () => {
    expect(
      fasecoldaLatestValueCop({
        ...FASECOLDA_FIXTURE,
        data: { ...FASECOLDA_FIXTURE.data, valueModel: [] },
      }),
    ).toBeNull();
  });

  it("drops missing pieces from model when only line1 is present", () => {
    const seed = fasecoldaToVehicleSeed({
      ...FASECOLDA_FIXTURE,
      data: { ...FASECOLDA_FIXTURE.data, line2: undefined, line3: undefined },
    });
    expect(seed.model).toBe("SANDERO [FL]");
  });
});
