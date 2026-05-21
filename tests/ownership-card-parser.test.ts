import { describe, expect, it } from "vitest";

import {
  correctVinForbiddenChars,
  parseOwnershipCardText,
} from "@/lib/ownership-card-parser";

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

  it("pega los runs de dígitos cuando el OCR mete un espacio dentro del número", () => {
    // Caso real: el OCR a veces parte "100378897" como "100378 897" o
    // "1003788 97" — los runs separados por 1-2 espacios deben concatenarse.
    const r1 = parseOwnershipCardText("LICENCIA DE TRANSITO No. 100378 897");
    expect(r1.licenseNumber).toBe("100378897");
    const r2 = parseOwnershipCardText("LICENCIA DE TRANSITO No. 1003788 97");
    expect(r2.licenseNumber).toBe("100378897");
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

  it("placa con guion ABC-123 se parsea sin el guion", () => {
    const r = parseOwnershipCardText("D. PLACA ABC-123");
    expect(r.plate).toBe("ABC123");
  });

  it("cilindraje con separador de miles 1.800 → 1800", () => {
    const r = parseOwnershipCardText("M. CILINDRAJE (CC) 1.800");
    expect(r.cylinderCapacity).toBe("1800");
  });

  it("año con separador de miles 2.018 → 2018", () => {
    const r = parseOwnershipCardText("L. MODELO 2.018");
    expect(r.year).toBe("2018");
  });

  it("detecta TIPO DE LICENCIA ORIGINAL", () => {
    const r = parseOwnershipCardText("TIPO DE LICENCIA ORIGINAL");
    expect(r.propertyCardStatus).toBe("Original");
  });

  it("detecta TIPO DE TARJETA DUPLICADO", () => {
    const r = parseOwnershipCardText("TIPO DE TARJETA DUPLICADO");
    expect(r.propertyCardStatus).toBe("Duplicado");
  });

  it("cuando solo aparece VIN, copia chasis del VIN como fallback", () => {
    const r = parseOwnershipCardText(
      "E. NUMERO DE IDENTIFICACION VEHICULAR (VIN) 9BWHE21JX24060831",
    );
    expect(r.vin).toBe("9BWHE21JX24060831");
    expect(r.chassisNumber).toBe("9BWHE21JX24060831");
  });

  it("transmisión AUTOMATICA → automatic", () => {
    const r = parseOwnershipCardText("TIPO DE CAJA AUTOMATICA");
    expect(r.transmission).toBe("automatic");
  });

  it("detecta documento del propietario al final de la línea (con puntos)", () => {
    const r = parseOwnershipCardText(
      "U. PROPIETARIO PEPITO PEREZ GOMEZ C.C. 1.020.456.789",
    );
    expect(r.owner).toBe("Pepito Perez Gomez");
    expect(r.ownerDocument).toBe("1020456789");
  });

  it("detecta NIT como documento del propietario", () => {
    const r = parseOwnershipCardText(
      "PROPIETARIO TRANSPORTES ABC SAS NIT 900123456-7",
    );
    expect(r.owner).toBe("Transportes Abc Sas");
    expect(r.ownerDocument).toBe("900123456-7");
  });

  it("propietario en línea distinta al sub-rótulo APELLIDO(S) Y NOMBRE(S)", () => {
    const r = parseOwnershipCardText(
      [
        "PROPIETARIO",
        "APELLIDO(S) Y NOMBRE(S)",
        "GARCIA CASTAÑEDA SANTIAGO ANDRES",
      ].join("\n"),
    );
    expect(r.owner).toBe("Garcia Castaneda Santiago Andres");
  });

  it("propietario con sub-rótulo y valor en la misma línea", () => {
    const r = parseOwnershipCardText(
      "PROPIETARIO APELLIDO(S) Y NOMBRE(S) GARCIA CASTAÑEDA SANTIAGO ANDRES",
    );
    expect(r.owner).toBe("Garcia Castaneda Santiago Andres");
  });

  it("layout dos-filas: CLASE/TIPO/CARROCERIA con valores AUTOMOVIL/SEDAN abajo", () => {
    // El header alterna 2-3 columnas con etiquetas y los valores van en la
    // línea de abajo. Sin la lógica de alineación, CLASE capturaba "TIPO"
    // (el siguiente label) como su valor.
    const text = [
      "CLASE        TIPO         CARROCERIA",
      "AUTOMOVIL    SEDAN        SEDAN",
    ].join("\n");
    const r = parseOwnershipCardText(text);
    expect(r.vehicleClass).toBe("Automovil");
    expect(r.bodyType).toBe("Sedan");
  });

  it("layout dos-filas con prefijo de letra: P. CLASE arriba, AUTOMOVIL abajo", () => {
    // Mismo layout pero con los "P." "Q." comunes en tarjetas RUNT viejas.
    // La tolerancia del lookup acomoda el shift de columna por el prefijo.
    const text = [
      "P. CLASE         Q. TIPO       R. CARROCERIA",
      "   AUTOMOVIL        SEDAN          SEDAN",
    ].join("\n");
    const r = parseOwnershipCardText(text);
    expect(r.vehicleClass).toBe("Automovil");
    expect(r.bodyType).toBe("Sedan");
  });

  it("layout dos-filas: TIPO DE VEHICULO mapea a bodyType", () => {
    // Algunas tarjetas usan "TIPO DE VEHICULO" en vez de "TIPO DE CARROCERIA".
    const text = [
      "CLASE DE VEHICULO    TIPO DE VEHICULO",
      "AUTOMOVIL            SEDAN",
    ].join("\n");
    const r = parseOwnershipCardText(text);
    expect(r.vehicleClass).toBe("Automovil");
    expect(r.bodyType).toBe("Sedan");
  });

  it("layout mixto: un campo inline y otro abajo en la misma fila de labels", () => {
    // CLASE tiene valor inline, TIPO se completa desde la fila de abajo.
    const text = [
      "CLASE AUTOMOVIL              TIPO",
      "                             SEDAN",
    ].join("\n");
    const r = parseOwnershipCardText(text);
    expect(r.vehicleClass).toBe("Automovil");
    expect(r.bodyType).toBe("Sedan");
  });

  it("texto OCR real de una tarjeta Peugeot 206 (cuatro columnas + REG flags)", () => {
    // Output crudo que reportó el perito desde el escáner. Tiene varias
    // dificultades juntas: 4 columnas en algunas filas, columnas REG con
    // flags N/S entre los IDs, sub-header IDENTIFICACION pegado al nombre,
    // "CILINDRADA" en vez de "CILINDRAJE", "TIPO CARROCERIA" sin DE, y el
    // famoso 8↔B en el VIN/serie.
    const text = [
      "REPUBLICA DE COLOMBIA",
      "MINISTERIO DE TRANSPORTE",
      "LICENCIA DE TRÁNSITO No.         100378897",
      "PLACA           MARCA                        LÍNEA                  A      MODELO",
      "BPA481 PEUGEOT                206 XR                      2003",
      "CILINDRADA CC    COLOR                                            SERVICIO",
      "1.400          BLANCO BANQUISE                          PARTICULAR",
      "CLASE DE VEHÍCULO               TIPO CARROCERÍA                COMBUSTIBLE                   CAPACIDAD Kg/PSJ",
      "AUTOMOVIL            HATCH BACK         GASOLINA         5",
      "NÚMERO DE MOTOR                       REG          VIN            r",
      "KFWPSA10FSE24067693            N             tii          EN",
      "NÚMERO DE SERIE                REG NÚMERO DE CHASIS    E etica REG",
      "BG12AKFU93C232241               N     8G12AKFU93C232241        N",
      "PROPIETARIO: APELLIDO(S) Y NOMBRE(S)                                       He            IDENTIFICACIÓN",
      "GARCIA CASTAÑEDA SANTIAGO ANDRE          C.C. 1006534746",
    ].join("\n");
    const r = parseOwnershipCardText(text);
    expect(r.licenseNumber).toBe("100378897");
    expect(r.plate).toBe("BPA481");
    expect(r.make).toBe("Peugeot");
    expect(r.model).toBe("206 Xr");
    expect(r.year).toBe("2003");
    expect(r.cylinderCapacity).toBe("1400");
    expect(r.color).toBe("Blanco Banquise");
    expect(r.serviceType).toBe("Particular");
    expect(r.vehicleClass).toBe("Automovil");
    expect(r.bodyType).toBe("Hatch Back");
    expect(r.fuel).toBe("gasoline");
    expect(r.engineNumber).toBe("KFWPSA10FSE24067693");
    expect(r.chassisNumber).toBe("8G12AKFU93C232241");
    expect(r.owner).toBe("Garcia Castaneda Santiago Andre");
    expect(r.ownerDocument).toBe("1006534746");
  });

  it("layout inline tradicional sigue funcionando sin trigger de dos-filas", () => {
    // Sanity: las tarjetas con valor en la misma línea no deberían cambiar.
    const text = "P. CLASE DE VEHICULO AUTOMOVIL    Q. TIPO DE CARROCERIA SEDAN";
    const r = parseOwnershipCardText(text);
    expect(r.vehicleClass).toBe("Automovil");
    expect(r.bodyType).toBe("Sedan");
  });

  it("VIN con O (prohibida) la corrige automáticamente a 0", () => {
    // VIN ISO 3779 no permite I/O/Q. Si OCR devuelve esos chars, el parser
    // los sustituye sin preguntar — el resultado es siempre más probable.
    const r = parseOwnershipCardText(
      "E. NUMERO DE IDENTIFICACION VEHICULAR (VIN) 9BWHE21JX240608O1",
    );
    expect(r.vin).toBe("9BWHE21JX24060801");
  });

  it("VIN con I (prohibida) la corrige a 1", () => {
    const r = parseOwnershipCardText(
      "E. NUMERO DE IDENTIFICACION VEHICULAR (VIN) IBWHE21JX24060831",
    );
    expect(r.vin).toBe("1BWHE21JX24060831");
  });

  it("correctVinForbiddenChars: I→1, O→0, Q→0; no toca el resto", () => {
    expect(correctVinForbiddenChars("8G12IOQ45BFAKE0123")).toBe("8G1210045BFAKE0123");
    // 8 y B son legales en VIN — NO se tocan, queda para el perito corregir.
    expect(correctVinForbiddenChars("8GBBBBBBBBBBBBBBB")).toBe("8GBBBBBBBBBBBBBBB");
  });

  it("propietario sub-rótulo en una línea, valor + documento en la siguiente", () => {
    const r = parseOwnershipCardText(
      [
        "PROPIETARIO APELLIDO(S) Y NOMBRE(S)",
        "GARCIA CASTAÑEDA SANTIAGO ANDRES   1.020.456.789",
      ].join("\n"),
    );
    expect(r.owner).toBe("Garcia Castaneda Santiago Andres");
  });
});
