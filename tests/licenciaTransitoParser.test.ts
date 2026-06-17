import { describe, expect, it } from "vitest";

import {
  applyLayoutIndependentFallback,
  detectSide,
  type LicenciaTransito,
  type OcrLine,
  parseLicenciaTransito,
  parseLicenciaTransitoFromOcr,
  toVehicleFormFields,
  validateModelo,
  validatePlaca,
  validateVIN,
} from "@/lib/licenciaTransitoParser";

/** Helper: arma una OcrLine a partir de pares [text, xCol]. Y se fija por el
 *  índice de la línea — más fácil de leer en los tests que pasar bboxes
 *  completos a mano. */
function ocrLine(
  yRow: number,
  ...wordsAt: Array<[string, number]>
): OcrLine {
  const lineHeight = 20;
  return {
    words: wordsAt.map(([text, x0]) => ({
      text,
      x0,
      x1: x0 + text.length * 10, // anchos relativos, suficiente para test
      y0: yRow * lineHeight,
      y1: yRow * lineHeight + 15,
    })),
  };
}

// Texto OCR "limpio" inspirado en el ejemplo real de licencia de tránsito
// post-RUNT (Ministerio de Transporte). Mantengo los espacios entre columnas
// como los emite Tesseract con `preserve_interword_spaces=1` activado.
const CLEAN_OCR = `REPUBLICA DE COLOMBIA
MINISTERIO DE TRANSPORTE
LICENCIA DE TRANSITO No.    10037889711
PLACA       MARCA           LINEA           MODELO
BPA481      PEUGEOT         206 XR          2003
CILINDRADA CC   COLOR                       SERVICIO
1.400           BLANCO BANQUISE             PARTICULAR
CLASE DE VEHICULO   TIPO CARROCERIA   COMBUSTIBLE   CAPACIDAD Kg/PSJ
AUTOMOVIL           HATCH BACK        GASOLINA      5
NUMERO DE MOTOR                      REG    VIN
KFWPSA1OFSE24O67693                  N      ******
NUMERO DE SERIE          REG    NUMERO DE CHASIS         REG
8G12AKFU93C232241        N      8G12AKFU93C232241        N
PROPIETARIO: APELLIDO(S) Y NOMBRE(S)            IDENTIFICACION
GARCIA CASTAÑEDA SANTIAGO ANDRE                 C.C. 1006534746`;

describe("parseLicenciaTransito — OCR limpio", () => {
  const { data, warnings, confidence } = parseLicenciaTransito(CLEAN_OCR);

  it("extrae todos los campos básicos del ejemplo", () => {
    expect(data.placa).toBe("BPA481");
    expect(data.marca).toBe("PEUGEOT");
    expect(data.linea).toBe("206 XR");
    expect(data.modelo).toBe(2003);
    expect(data.cilindradaCC).toBe(1400);
    expect(data.color).toBe("BLANCO BANQUISE");
    expect(data.servicio).toBe("PARTICULAR");
    expect(data.claseVehiculo).toBe("AUTOMOVIL");
    expect(data.tipoCarroceria).toBe("HATCH BACK");
    expect(data.combustible).toBe("GASOLINA");
    expect(data.capacidad).toBe(5);
  });

  it("VIN '******' se convierte a null (campo censurado, no inválido)", () => {
    expect(data.vin).toBeNull();
  });

  it("preserva motor/serie/chasis tal cual los emite el OCR (alfanumérico)", () => {
    expect(data.numeroMotor).toBe("KFWPSA1OFSE24O67693");
    expect(data.numeroSerie).toBe("8G12AKFU93C232241");
    expect(data.numeroChasis).toBe("8G12AKFU93C232241");
  });

  it("resuelve los tres REG por posición (motor, serie, chasis)", () => {
    expect(data.regMotor).toBe("N");
    expect(data.regSerie).toBe("N");
    expect(data.regChasis).toBe("N");
  });

  it("extrae propietario y strippea el prefijo C.C. en identificación", () => {
    expect(data.propietario).toBe("GARCIA CASTAÑEDA SANTIAGO ANDRE");
    expect(data.identificacion).toBe("1006534746");
  });

  it("warns la licencia (el ejemplo tiene 11 dígitos en vez de 10)", () => {
    expect(data.licenciaTransito).toBe("10037889711");
    expect(warnings.some((w) => w.includes("licenciaTransito"))).toBe(true);
  });

  it("confidence > 0.6 con casi todos los campos extraídos", () => {
    expect(confidence).toBeGreaterThan(0.6);
  });
});

// Mismo documento pero con confusiones típicas de Tesseract: 8↔B, I↔1, O↔0,
// Z↔2, separador de miles distinto. El parser debe corregirlas en el contexto
// correcto (no en campos alfanuméricos como motor/serie/chasis).
const DIRTY_OCR = `LICENCIA DE TRANSITO No.    I0O37889711
PLACA       MARCA           LINEA           MODELO
8PA48I      PEUGEOT         206 XR          Z0O3
CILINDRADA CC   COLOR                       SERVICIO
1,400           BLANCO                      PARTICULAR
NUMERO DE MOTOR                              REG    VIN
KFWPSA1OFSE24O67693                          N      ******
PROPIETARIO: APELLIDO(S) Y NOMBRE(S)         IDENTIFICACION
JUAN PEREZ                                   C.C. I00653474B`;

describe("parseLicenciaTransito — OCR sucio con confusiones típicas", () => {
  const { data } = parseLicenciaTransito(DIRTY_OCR);

  it("corrige placa con confusiones letra/dígito (8→B en zona letras, I→1 en zona dígitos)", () => {
    expect(data.placa).toBe("BPA481");
  });

  it("corrige el año del modelo (Z→2, O→0)", () => {
    expect(data.modelo).toBe(2003);
  });

  it("normaliza cilindrada con coma como separador de miles (1,400 → 1400)", () => {
    expect(data.cilindradaCC).toBe(1400);
  });

  it("corrige la licencia (I→1, O→0)", () => {
    expect(data.licenciaTransito).toBe("10037889711");
  });

  it("corrige la identificación (I→1, B→8)", () => {
    expect(data.identificacion).toBe("1006534748");
  });

  it("no toca el número de motor (S e I son legítimos en alfanuméricos)", () => {
    expect(data.numeroMotor).toBe("KFWPSA1OFSE24O67693");
  });
});

describe("parseLicenciaTransito — campos faltantes", () => {
  const PARTIAL = `PLACA       MARCA
ABC123      CHEVROLET`;

  const { data, warnings, confidence } = parseLicenciaTransito(PARTIAL);

  it("extrae lo poco que aparece", () => {
    expect(data.placa).toBe("ABC123");
    expect(data.marca).toBe("CHEVROLET");
  });

  it("no falla — devuelve objeto parcial sin lanzar", () => {
    expect(data.linea).toBeUndefined();
    expect(data.modelo).toBeUndefined();
    expect(data.vin).toBeUndefined();
    expect(data.propietario).toBeUndefined();
  });

  it("confidence < 0.2 porque la mayoría de campos están ausentes", () => {
    expect(confidence).toBeLessThan(0.2);
  });

  it("no emite warnings de campos ausentes (silencio para ausentes)", () => {
    expect(warnings).toEqual([]);
  });

  it("texto basura devuelve objeto totalmente vacío", () => {
    const r = parseLicenciaTransito("blah blah no hay nada útil aquí");
    expect(r.data).toEqual({});
    expect(r.confidence).toBe(0);
  });
});

describe("parseLicenciaTransito — defensas contra label echo y misalineación", () => {
  it("no asigna PROPIETARIO=IDENTIFICACION cuando el OCR repite la etiqueta en la fila de valores", () => {
    // Caso real: Tesseract a veces repite el header en la línea de valores.
    const input = `PROPIETARIO: APELLIDO(S) Y NOMBRE(S)            IDENTIFICACION
IDENTIFICACION                                   1006534746`;
    const { data } = parseLicenciaTransito(input);
    expect(data.propietario).toBeUndefined();
    expect(data.identificacion).toBe("1006534746");
  });

  it("no asigna CLASE='DE VEHICULO' cuando un fragmento de la etiqueta aparece en la fila de valores", () => {
    const input = `CLASE DE VEHICULO   TIPO CARROCERIA   COMBUSTIBLE
TIPO CARROCERIA      HATCH BACK        GASOLINA`;
    const { data } = parseLicenciaTransito(input);
    expect(data.claseVehiculo).toBeUndefined();
    expect(data.tipoCarroceria).toBe("HATCH BACK");
    expect(data.combustible).toBe("GASOLINA");
  });

  it("cuando OCR pega 2 columnas en un solo token, el valor sigue cayendo en su columna sin contaminar las otras", () => {
    // Si el OCR junta "HATCH BACK GASOLINA" en un único token (espacio simple
    // entre ellos), el conteo de valores < headers. Preferimos alinear desde
    // el inicio y dejar el resto vacío que mover valores cruzados.
    const input = `CLASE DE VEHICULO   TIPO CARROCERIA   COMBUSTIBLE   CAPACIDAD Kg/PSJ
AUTOMOVIL           HATCH BACK GASOLINA            5`;
    const { data } = parseLicenciaTransito(input);
    expect(data.claseVehiculo).toBe("AUTOMOVIL");
    // tipoCarroceria recibe el megatoken; combustible y capacidad podrán
    // quedar vacíos antes que mal asignados — el perito los completa a mano.
    expect(data.tipoCarroceria).toBe("HATCH BACK GASOLINA");
  });

  it("ignora tokens basura (» — comillas exóticas) en la fila de valores", () => {
    // Caso real del usuario: la fila de valores trae un "»" colado al final
    // por ruido del OCR. Sin filtro, ese token corre el conteo y hace que
    // tipoCarroceria reciba "GASOLINA 5" en vez de "HATCH BACK".
    const input = `"CLASE DE VEHÍCULO               TIPO CARROCERÍA                COMBUSTIBLE                   CAPACIDAD Kg/PSJ
AUTOMOVIL            HATCH BACK         GASOLINA         5            »`;
    const { data } = parseLicenciaTransito(input);
    expect(data.claseVehiculo).toBe("AUTOMOVIL");
    expect(data.tipoCarroceria).toBe("HATCH BACK");
    expect(data.combustible).toBe("GASOLINA");
    expect(data.capacidad).toBe(5);
  });

  it("trata como header una línea con 2+ labels aunque tenga ruido entremedio", () => {
    // Caso real: PROPIETARIO ... He ... IDENTIFICACIÓN — el "He" es noise OCR
    // entre las dos columnas reales. Solo aliñamos los tokens que SON labels.
    const input = `PROPIETARIO: APELLIDO(S) Y NOMBRE(S)              He            IDENTIFICACIÓN
GARCIA CASTAÑEDA SANTIAGO ANDRE                              C.C. 1006534746`;
    const { data } = parseLicenciaTransito(input);
    expect(data.propietario).toBe("GARCIA CASTAÑEDA SANTIAGO ANDRE");
    expect(data.identificacion).toBe("1006534746");
  });
});

describe("parseLicenciaTransitoFromOcr — alineación espacial por bboxes", () => {
  it("usa posición X para mandar cada palabra a su columna aun si OCR pegó tokens con espacio simple", () => {
    // Reproducción del caso real: header con tildes (más largo que los valores)
    // + value row con "BPA481 PEUGEOT" y "206 XR" pegados por espacios simples.
    // Sin posiciones X, el text-parser pondría todo en columnas equivocadas.
    const lines: OcrLine[] = [
      ocrLine(0, ["PLACA", 50], ["MARCA", 200], ["LÍNEA", 350], ["MODELO", 500]),
      ocrLine(1, ["BPA481", 50], ["PEUGEOT", 200], ["206", 350], ["XR", 390], ["2003", 500]),
    ];
    const { data } = parseLicenciaTransitoFromOcr(lines);
    expect(data.placa).toBe("BPA481");
    expect(data.marca).toBe("PEUGEOT");
    expect(data.linea).toBe("206 XR"); // 2 palabras en la misma columna se concatenan
    expect(data.modelo).toBe(2003);
  });

  it("ignora tokens basura tipo » fuera del rango de cualquier columna", () => {
    const lines: OcrLine[] = [
      ocrLine(
        0,
        ["CLASE", 50],
        ["DE", 100],
        ["VEHÍCULO", 130],
        ["TIPO", 300],
        ["CARROCERÍA", 340],
        ["COMBUSTIBLE", 500],
        ["CAPACIDAD", 700],
      ),
      ocrLine(
        1,
        ["AUTOMOVIL", 50],
        ["HATCH", 300],
        ["BACK", 350],
        ["GASOLINA", 500],
        ["5", 700],
        ["»", 900],
      ),
    ];
    const { data } = parseLicenciaTransitoFromOcr(lines);
    expect(data.claseVehiculo).toBe("AUTOMOVIL");
    expect(data.tipoCarroceria).toBe("HATCH BACK");
    expect(data.combustible).toBe("GASOLINA");
    expect(data.capacidad).toBe(5);
  });

  it("maneja label + value en la misma línea (caso LICENCIA DE TRÁNSITO No.)", () => {
    const lines: OcrLine[] = [
      ocrLine(
        0,
        ["LICENCIA", 50],
        ["DE", 130],
        ["TRÁNSITO", 160],
        ["No.", 240],
        ["1003788971", 350],
      ),
    ];
    const { data } = parseLicenciaTransitoFromOcr(lines);
    expect(data.licenciaTransito).toBe("1003788971");
  });

  it("ignora líneas de noise (UI text, sin labels conocidos)", () => {
    const lines: OcrLine[] = [
      ocrLine(0, ["ql", 0], ["entras", 30], ["a", 100], ["modo", 120], ["vivo", 170]),
      ocrLine(1, ["PLACA", 50], ["MARCA", 200]),
      ocrLine(2, ["BPA481", 50], ["PEUGEOT", 200]),
    ];
    const { data } = parseLicenciaTransitoFromOcr(lines);
    expect(data.placa).toBe("BPA481");
    expect(data.marca).toBe("PEUGEOT");
  });
});

describe("Adapter toVehicleFormFields", () => {
  it("mapea claves a inglés y enums a los valores del formulario (todo en MAYÚSCULA)", () => {
    const { data } = parseLicenciaTransito(CLEAN_OCR);
    const form = toVehicleFormFields(data);
    expect(form.plate).toBe("BPA481");
    expect(form.licenseNumber).toBe("10037889711");
    expect(form.engineNumber).toBe("KFWPSA1OFSE24O67693");
    expect(form.chassisNumber).toBe("8G12AKFU93C232241");
    expect(form.year).toBe("2003");
    expect(form.cylinderCapacity).toBe("1400");
    expect(form.fuel).toBe("gasoline");
    expect(form.vehicleClass).toBe("AUTOMÓVIL");
    expect(form.bodyType).toBe("HATCHBACK");
    expect(form.serviceType).toBe("PARTICULAR");
    expect(form.ownerDocument).toBe("1006534746");
  });

  it("VIN null se traduce a undefined (el form no maneja null literal)", () => {
    const { data } = parseLicenciaTransito(CLEAN_OCR);
    const form = toVehicleFormFields(data);
    expect(form.vin).toBeUndefined();
  });

  it("mantiene marca, color y propietario en MAYÚSCULAS (sin titleCase)", () => {
    const { data } = parseLicenciaTransito(CLEAN_OCR);
    const form = toVehicleFormFields(data);
    expect(form.make).toBe("PEUGEOT");
    expect(form.color).toBe("BLANCO BANQUISE");
    expect(form.owner).toBe("GARCIA CASTAÑEDA SANTIAGO ANDRE");
  });
});

describe("detectSide — frente vs reverso", () => {
  it("identifica el FRENTE por firmas del Ministerio", () => {
    expect(detectSide("REPUBLICA DE COLOMBIA\nMINISTERIO DE TRANSPORTE\nLICENCIA DE TRANSITO No. 123")).toBe("front");
  });

  it("identifica el FRENTE solo con 'LICENCIA DE TRANSITO'", () => {
    expect(detectSide("Texto random LICENCIA DE TRÁNSITO algo más")).toBe("front");
  });

  it("identifica el REVERSO por OBSERVACIONES", () => {
    expect(detectSide("OBSERVACIONES\nVehículo con restricción de circulación")).toBe("back");
  });

  it("identifica el REVERSO por LIMITACIONES o TRASPASOS", () => {
    expect(detectSide("LIMITACIONES Y GRAVÁMENES\nNINGUNA")).toBe("back");
    expect(detectSide("TRASPASOS\n2018-05-12 Juan Pérez")).toBe("back");
  });

  it("frente gana si aparecen firmas de ambos lados (caso raro)", () => {
    // Si por algún motivo el OCR pesca palabras del frente Y del reverso, asumimos
    // frente — es la lectura más útil porque el reverso no tiene datos estructurados.
    expect(detectSide("MINISTERIO DE TRANSPORTE\nOBSERVACIONES")).toBe("front");
  });

  it("devuelve unknown si no hay firmas (foto basura o muy borrosa)", () => {
    expect(detectSide("blah blah texto sin nada útil")).toBe("unknown");
    expect(detectSide("")).toBe("unknown");
  });
});

describe("Validadores individuales", () => {
  it("validatePlaca acepta AAA000 y rechaza otros formatos", () => {
    expect(validatePlaca("BPA481").valid).toBe(true);
    expect(validatePlaca("ABC-123").valid).toBe(false);
    expect(validatePlaca("123ABC").valid).toBe(false);
    expect(validatePlaca(undefined).valid).toBe(false);
  });

  it("validateModelo rechaza años fuera de rango", () => {
    expect(validateModelo(2020).valid).toBe(true);
    expect(validateModelo(1900).valid).toBe(false);
    expect(validateModelo(3000).valid).toBe(false);
    expect(validateModelo(undefined).valid).toBe(false);
  });

  it("validateVIN acepta null y rechaza I/O/Q o longitud != 17", () => {
    expect(validateVIN(null).valid).toBe(true);
    expect(validateVIN("ABC123").valid).toBe(false);
    expect(validateVIN("1HGCM82633A123456").valid).toBe(true);
    // contiene I (prohibido en VIN ISO-3779)
    expect(validateVIN("1HGCM82633I123456").valid).toBe(false);
    expect(validateVIN(undefined).valid).toBe(false);
  });
});

describe("applyLayoutIndependentFallback — respaldo sin etiquetas", () => {
  it("rescata placa, VIN/chasis y cédula cuando el parser columnar falló", () => {
    // Texto sin NINGÚN encabezado legible — el parser columnar devolvería {}.
    const raw = `xxxx ruido ilegible
BPA481 algo
1HGCM82633A004352
propietario C.C. 1006534746`;
    const data: LicenciaTransito = {};
    applyLayoutIndependentFallback(data, raw);
    expect(data.placa).toBe("BPA481");
    expect(data.vin).toBe("1HGCM82633A004352");
    expect(data.numeroChasis).toBe("1HGCM82633A004352");
    expect(data.identificacion).toBe("1006534746");
  });

  it("corrige confusiones de OCR en la placa (8↔B, 0↔O)", () => {
    const data: LicenciaTransito = {};
    applyLayoutIndependentFallback(data, "placa: BPA4B1 leida mal");
    expect(data.placa).toBe("BPA481");
  });

  it("NO pisa campos ya detectados por el parser columnar", () => {
    const data: LicenciaTransito = { placa: "ABC123", vin: null };
    applyLayoutIndependentFallback(data, "BPA481 1HGCM82633A004352");
    // placa preexistente intacta; vin === null (censurado) NO se sobrescribe.
    expect(data.placa).toBe("ABC123");
    expect(data.vin).toBeNull();
  });

  it("no inventa nada si el texto no tiene patrones reconocibles", () => {
    const data: LicenciaTransito = {};
    applyLayoutIndependentFallback(data, "texto totalmente ilegible sin datos");
    expect(data.placa).toBeUndefined();
    expect(data.vin).toBeUndefined();
    expect(data.identificacion).toBeUndefined();
  });

  it("integración: parseLicenciaTransito rescata placa aunque no haya headers", () => {
    // Sin filas de encabezados con labels → el parser columnar no asigna nada,
    // pero el fallback debe rescatar la placa del texto crudo.
    const { data } = parseLicenciaTransito("foto borrosa\nBPA481\nmás ruido");
    expect(data.placa).toBe("BPA481");
  });
});
