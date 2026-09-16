import { describe, expect, it } from "vitest";
import {
  SECTION_IDS,
  activeSectionsFor,
  walkaroundSequenceFor,
  vehicleHasChassisRails,
} from "@/lib/constants";
import type { VehicleType } from "@/lib/types";

/**
 * Orden oficial del recorrido (definido por el negocio, agosto 2026). Son dos
 * listas: una para carrocería autoportante (automóviles, hatchback, coupé y
 * SUV) y otra para chasis independiente (camperos y pickups). Estos tests
 * congelan ese orden — si alguien reordena las secuencias en constants.ts sin
 * que el negocio lo pida, revientan.
 *
 * Reglas de variante ya cubiertas por el negocio:
 *  - coupé y campero 3 puertas: sin puertas traseras;
 *  - largueros de chasis (camperos + pickup doble) vs 4 puntas (el resto);
 *  - paral trasero de cabina: solo pickup doble.
 */

/** Orden canónico: todas las secciones activas. El gate por tipo de peritaje
 *  (`activeSectionsFor`) solo quita ítems, nunca reordena — eso se verifica
 *  aparte en "gate por tipo de peritaje". */
function labels(type: VehicleType): string[] {
  return walkaroundSequenceFor(type, SECTION_IDS).map((e) => e.label);
}

const AUTOPORTANTE_ORDER = [
  "Capó",
  "Bomper delantero",
  "Punta delantera izquierda",
  "Guardapolvo metálico delantero izquierdo",
  "Torre delantera izquierda",
  "Guardafangos delantero izquierdo",
  "Amortiguador delantero izquierdo",
  "Llanta delantera izquierda",
  "Retrovisor izquierdo",
  "Panorámico delantero (vista izquierda)",
  "Puerta delantera izquierda (sellante, carteras, estado interno)",
  "Paral puerta delantera izquierda",
  "Paral parabrisas izquierdo",
  "Larguero capota izquierdo",
  "Techo lado izquierdo",
  "Paral central izquierdo",
  "Estado interior sección delantera",
  "Estribo izquierdo",
  "Puerta trasera izquierda",
  "Costado izquierdo",
  "Guardapolvo metálico trasero izquierdo",
  "Amortiguador trasero izquierdo",
  "Llanta trasera izquierda",
  "Tapabaúl con puerta",
  "Panorámico trasero",
  "Bomper trasero",
  "Panel trasero",
  "Piso baúl",
  "Llanta de repuesto",
  "Stop izquierdo",
  "Stop derecho",
  "Punta trasera izquierda",
  "Punta trasera derecha",
  "Costado derecho",
  "Amortiguador trasero derecho",
  "Llanta trasera derecha",
  "Larguero capota derecho",
  "Capota (techo lado derecho)",
  "Paral central derecho",
  "Puerta trasera derecha",
  "Paral parabrisas derecho",
  "Paral puerta derecha",
  "Estribo derecho",
  "Puerta delantera derecha",
  "Retrovisor derecho",
  "Panorámico delantero (vista derecha)",
  "Guardafangos derecho",
  "Torre suspensión delantera derecha",
  "Guardapolvo metálico delantero derecho",
  "Amortiguador delantero derecho",
  "Llanta delantera derecha",
  "Punta delantera derecha",
  "Traviesa frontal inferior",
  "Traviesa frontal superior",
  "Estado motor (fugas, ruidos, aceite, filtros, líquidos)",
  "Accesorios",
  "Barra estabilizadora",
  "Cuna del motor",
  "Soporte de motor",
  "Cárter",
  "Farola delantera izquierda",
  "Farola delantera derecha",
  "Bloque",
  "Culata",
  "Tapaválvula",
  "Piso de carrocería",
  "Refuerzos de carrocería",
  "Batería",
  "Alternador",
  "Motor de arranque",
  "Sistema de carga",
  "Cableado / fusibles",
  "Estado iluminación vehículo",
];

const CHASIS_INDEPENDIENTE_ORDER = [
  "Capó",
  "Bomper delantero",
  "Larguero chasis izquierdo",
  "Guardapolvo metálico delantero izquierdo",
  "Torre delantera izquierda",
  "Amortiguador delantero izquierdo",
  "Guardafango delantero izquierdo",
  "Llanta delantera izquierda",
  "Retrovisor izquierdo",
  "Panorámico delantero (vista izquierda)",
  "Puerta delantera izquierda",
  "Paral puerta izquierda",
  "Paral parabrisas izquierdo",
  "Larguero capota izquierdo",
  "Techo lado izquierdo",
  "Paral central izquierdo",
  "Estado interior sección delantera",
  "Estribo izquierdo",
  "Puerta trasera izquierda",
  "Costado izquierdo",
  "Guardapolvo metálico trasero izquierdo",
  "Amortiguador trasero izquierdo",
  "Llanta trasera izquierda",
  "Tapa platón / portón trasero",
  "Panorámico trasero",
  "Bomper trasero",
  "Panel trasero / panel platón",
  "Piso platón / piso de carga",
  "Llanta de repuesto",
  "Stop izquierdo",
  "Stop derecho",
  "Llanta trasera derecha",
  "Guardapolvo metálico trasero derecho",
  "Costado derecho",
  "Larguero capota derecho",
  "Capota (techo lado derecho)",
  "Paral central derecho",
  "Puerta trasera derecha",
  "Puerta delantera derecha",
  "Paral parabrisas derecho",
  "Paral puerta derecho",
  "Estribo derecho",
  "Retrovisor derecho",
  "Panorámico delantero (vista derecha)",
  "Guardafango delantero derecho",
  "Torre suspensión delantera derecha",
  "Guardapolvo metálico delantero derecho",
  "Amortiguador delantero derecho",
  "Llanta delantera derecha",
  "Larguero chasis derecho",
  "Traviesa frontal inferior",
  "Traviesa frontal superior",
  "Estado motor (fugas, ruidos, aceite, filtros, líquidos)",
  "Accesorios",
  "Barra estabilizadora",
  "Puente de suspensión",
  "Soporte de motor",
  "Cárter",
  "Farola delantera izquierda",
  "Farola delantera derecha",
  "Bloque motor",
  "Culata",
  "Tapa válvulas",
  "Piso de carrocería",
  "Batería",
  "Alternador",
  "Motor de arranque",
  "Sistema de carga",
  "Cableado / fusibles",
  "Iluminación del vehículo",
];

const REAR_DOORS = ["Puerta trasera izquierda", "Puerta trasera derecha"];

describe("orden del recorrido — carrocería autoportante", () => {
  it("sedán sigue la lista oficial", () => {
    expect(labels("car_5doors")).toEqual(AUTOPORTANTE_ORDER);
  });

  it("hatchback y SUV comparten el recorrido del sedán", () => {
    expect(labels("hatchback")).toEqual(AUTOPORTANTE_ORDER);
    expect(labels("suv")).toEqual(AUTOPORTANTE_ORDER);
  });

  it("el coupé es igual pero sin puertas traseras", () => {
    expect(labels("car_coupe")).toEqual(
      AUTOPORTANTE_ORDER.filter((l) => !REAR_DOORS.includes(l)),
    );
  });
});

describe("orden del recorrido — chasis independiente", () => {
  it("campero 5 puertas y pickup doble siguen la lista oficial", () => {
    // La pickup doble suma el paral trasero de cabina; el campero 5p no.
    expect(labels("campero_5doors")).toEqual(CHASIS_INDEPENDIENTE_ORDER);
    expect(
      labels("pickup_double").filter((l) => !l.startsWith("Paral trasero cabina")),
    ).toEqual(CHASIS_INDEPENDIENTE_ORDER);
  });

  it("la pickup doble captura el paral trasero de cabina en ambos costados", () => {
    const seq = labels("pickup_double");
    expect(seq).toContain("Paral trasero cabina izquierdo");
    expect(seq).toContain("Paral trasero cabina derecho");
    // Izquierdo entre paral central y estado interior; derecho entre costado y
    // larguero capota.
    expect(seq.indexOf("Paral trasero cabina izquierdo")).toBeGreaterThan(
      seq.indexOf("Paral central izquierdo"),
    );
    expect(seq.indexOf("Paral trasero cabina izquierdo")).toBeLessThan(
      seq.indexOf("Estado interior sección delantera"),
    );
    expect(seq.indexOf("Paral trasero cabina derecho")).toBeGreaterThan(
      seq.indexOf("Costado derecho"),
    );
    expect(seq.indexOf("Paral trasero cabina derecho")).toBeLessThan(
      seq.indexOf("Larguero capota derecho"),
    );
  });

  it("el campero 3 puertas es igual al de 5 pero sin puertas traseras", () => {
    expect(labels("campero_2doors")).toEqual(
      CHASIS_INDEPENDIENTE_ORDER.filter((l) => !REAR_DOORS.includes(l)),
    );
  });

  it("la pickup sencilla se califica por puntas, no por largueros de chasis", () => {
    const seq = labels("pickup_single");
    expect(vehicleHasChassisRails("pickup_single")).toBe(false);
    expect(seq).not.toContain("Larguero chasis izquierdo");
    expect(seq).not.toContain("Larguero chasis derecho");
    expect(seq).toContain("Punta delantera izquierda");
    expect(seq).toContain("Punta delantera derecha");
    expect(seq).toContain("Punta trasera izquierda");
    expect(seq).toContain("Punta trasera derecha");
    expect(seq).not.toContain("Puerta trasera izquierda");
  });
});

describe("capota (techo lado derecho)", () => {
  it("reemplazó a la segunda verificación del capó en ambas listas", () => {
    for (const type of ["car_5doors", "campero_5doors"] as VehicleType[]) {
      const seq = labels(type);
      expect(seq).not.toContain("Capó (verificación lado derecho)");
      expect(seq.indexOf("Capota (techo lado derecho)")).toBe(
        seq.indexOf("Larguero capota derecho") + 1,
      );
    }
  });
});

describe("gate por tipo de peritaje", () => {
  it("el gate de secciones filtra pero no reordena el recorrido", () => {
    for (const type of ["car_5doors", "campero_5doors"] as VehicleType[]) {
      const canonico = labels(type);
      for (const kind of ["plus", "pro", "sencillo"] as const) {
        const seq = walkaroundSequenceFor(
          type,
          activeSectionsFor(kind, type),
        ).map((e) => e.label);
        expect(seq).toEqual(canonico.filter((l) => seq.includes(l)));
      }
    }
  });

  it("la sección Motor se captura en Plus y Pro, no en Sencillo", () => {
    const MOTOR_ITEMS = [
      "Estado motor (fugas, ruidos, aceite, filtros, líquidos)",
      "Soporte de motor",
      "Cárter",
      "Bloque",
      "Culata",
      "Tapaválvula",
    ];
    const seqFor = (kind: "plus" | "pro" | "sencillo") =>
      walkaroundSequenceFor(
        "car_5doors",
        activeSectionsFor(kind, "car_5doors"),
      ).map((e) => e.label);

    for (const kind of ["plus", "pro"] as const) {
      const seq = seqFor(kind);
      for (const label of MOTOR_ITEMS) expect(seq).toContain(label);
    }
    const sencillo = seqFor("sencillo");
    for (const label of MOTOR_ITEMS) expect(sencillo).not.toContain(label);
  });

  it("el chasis independiente suma el puente de suspensión en Plus/Pro", () => {
    const seq = walkaroundSequenceFor(
      "campero_5doors",
      activeSectionsFor("pro", "campero_5doors"),
    ).map((e) => e.label);
    expect(seq.indexOf("Puente de suspensión")).toBe(
      seq.indexOf("Barra estabilizadora") + 1,
    );
  });
});
