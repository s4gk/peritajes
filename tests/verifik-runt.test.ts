import { describe, it, expect } from "vitest";
import { runtToVehicleSeed } from "@/lib/verifik/runt";
import { RUNT_FIXTURE } from "./verifik-fixtures";

describe("runt adapter", () => {
  it("maps modelo → year (CO terminology: 'modelo' = año)", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.year).toBe("2021");
  });

  it("maps noVin → vin (uppercased)", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.vin).toBe("3MVDM2WLAML234946");
  });

  it("maps marca → make with title case", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.make).toBe("Mazda");
  });

  it("uses linea as model (RUNT only carries the short line)", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.model).toBe("CX-30");
  });

  it("maps color with title case (MACHINE GRAY → Machine Gray)", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.color).toBe("Machine Gray");
  });

  it("maps WAGON tipoCarroceria → 'SUV' (matches form Select option)", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.bodyType).toBe("SUV");
  });

  it("maps tipoCombustible GASOLINA → gasoline enum", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.fuel).toBe("gasoline");
  });

  it("normalizes plate to uppercase", () => {
    const seed = runtToVehicleSeed({
      ...RUNT_FIXTURE,
      data: {
        ...RUNT_FIXTURE.data,
        informacionGeneral: { ...RUNT_FIXTURE.data.informacionGeneral, noPlaca: "abc123" },
      },
    });
    expect(seed.plate).toBe("ABC123");
  });

  it("does NOT populate owner (Verifik gates by cédula but does not return name)", () => {
    const seed = runtToVehicleSeed(RUNT_FIXTURE);
    expect(seed.owner).toBeUndefined();
  });
});
