import { describe, expect, it } from "vitest";

import { parseOwnershipCardText } from "@/lib/server/ownership-card-parser";

// Texto sintético inspirado en el output típico de Tesseract sobre una tarjeta
// de propiedad colombiana (post-RUNT). Mezcla 2 columnas en la misma línea,
// que es donde el parser tiene que ser cuidadoso.
const SAMPLE = `
REPUBLICA DE COLOMBIA
LICENCIA DE TRANSITO
A. No. LICENCIA DE TRANSITO 12345678   B. FECHA EXPEDICION 01/03/2018
D. PLACA  ABC123                       E. NUMERO DE IDENTIFICACION VEHICULAR (VIN) 9BWHE21JX24060831
F. NUMERO DEL MOTOR 4ZE1234567         G. NUMERO DE SERIE 9BWHE21JX24060831
H. NUMERO DE CHASIS  9BWHE21JX24060831
J. MARCA TOYOTA                        K. LINEA COROLLA XEi
L. MODELO 2018                         M. CILINDRAJE (CC) 1800
N. COLOR ROJO                          O. SERVICIO PARTICULAR
P. CLASE DE VEHICULO AUTOMOVIL         Q. TIPO DE CARROCERIA SEDAN
R. COMBUSTIBLE GASOLINA
T. NACIONALIDAD NACIONAL
U. PROPIETARIO PEPITO PEREZ GOMEZ
`;

describe("parseOwnershipCardText", () => {
  it("extrae la placa con formato AAA000", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.plate).toBe("ABC123");
  });

  it("extrae el VIN de 17 chars", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.vin).toBe("9BWHE21JX24060831");
  });

  it("mapea L. MODELO al campo year (terminología colombiana)", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.year).toBe("2018");
  });

  it("mapea LINEA al campo model y separa columnas con doble espacio", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.model).toBe("Corolla Xei");
  });

  it("extrae make sin contaminarse con la columna siguiente", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.make).toBe("Toyota");
  });

  it("extrae motor y chasis", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.engineNumber).toBe("4ZE1234567");
    expect(r.chassisNumber).toBe("9BWHE21JX24060831");
  });

  it("extrae cilindraje como número en cc", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.cylinderCapacity).toBe("1800");
  });

  it("mapea combustible al enum gasoline", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.fuel).toBe("gasoline");
  });

  it("extrae color, servicio, clase, carrocería, nacionalidad", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.color).toBe("Rojo");
    expect(r.serviceType).toBe("Particular");
    expect(r.vehicleClass).toBe("Automovil");
    expect(r.bodyType).toBe("Sedan");
    expect(r.nationality).toBe("Nacional");
  });

  it("extrae propietario", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.owner).toBe("Pepito Perez Gomez");
  });

  it("extrae licencia de tránsito", () => {
    const r = parseOwnershipCardText(SAMPLE);
    expect(r.licenseNumber).toBe("12345678");
  });

  it("usa fallback de regex global cuando no hay etiqueta", () => {
    const noLabels = "vehículo escaneado JFG459 con serie WAUZZZ8K9CA123456 listo";
    const r = parseOwnershipCardText(noLabels);
    expect(r.plate).toBe("JFG459");
    expect(r.vin).toBe("WAUZZZ8K9CA123456");
  });

  it("devuelve objeto vacío si no encuentra nada reconocible", () => {
    const r = parseOwnershipCardText("texto basura sin nada útil aquí");
    expect(r).toEqual({});
  });

  it("acepta combustible diésel con tilde y lo mapea al enum", () => {
    const r = parseOwnershipCardText("R. COMBUSTIBLE DIÉSEL");
    expect(r.fuel).toBe("diesel");
  });

  it("acepta GNV como combustible gas", () => {
    const r = parseOwnershipCardText("R. COMBUSTIBLE GNV");
    expect(r.fuel).toBe("gas");
  });

  it("placa con formato nuevo AAA00A se parsea bien", () => {
    const r = parseOwnershipCardText("D. PLACA XYZ12B");
    expect(r.plate).toBe("XYZ12B");
  });
});
