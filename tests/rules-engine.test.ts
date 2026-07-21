import { describe, it, expect } from "vitest";
import { analyze, computeHealth, riskTone, sectionHealthPct } from "@/lib/rules-engine";
import { computePillars, riskLevelFromPillars } from "@/lib/scoring";
import { BODYWORK_SECTION, bodyworkSectionFor } from "@/lib/constants";
import type { VehicleType } from "@/lib/types";
import {
  pristineInspection,
  pristineInspectionOfType,
  setBodywork,
  setChassis,
  setLeak,
  setRoadTest,
  setEngine,
  setSuspension,
} from "./fixtures";

describe("analyze: clean baseline", () => {
  it("returns low risk and zero findings for a fully OK inspection", () => {
    const r = analyze(pristineInspection());
    expect(r.level).toBe("low");
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(0);
    expect(r.counters.repainted).toBe(0);
    expect(r.counters.structuralHits).toBe(0);
    // El headline es descriptivo (no opina sobre riesgo): "sin hallazgos críticos".
    expect(r.headline).toMatch(/sin hallazgos/i);
  });
});

describe("analyze: bodywork", () => {
  it("counts repainted panels", () => {
    const data = pristineInspection();
    setBodywork(data, "hood", "repainted_full");
    setBodywork(data, "door_fl", "repainted_partial");
    const r = analyze(data);
    expect(r.counters.repainted).toBe(2);
    expect(r.findings.length).toBe(2);
    expect(r.findings.every((f) => f.section === "Carrocería")).toBe(true);
  });

  it("un solo panel dañado ya no escala el nivel (manda el %)", () => {
    const data = pristineInspection();
    setBodywork(data, "fender_fl", "dent_deep");
    const r = analyze(data);
    expect(r.counters.damaged).toBe(1);
    // Antes 'damaged >= 1' forzaba 'medium'. Ahora un hallazgo cosmético aislado
    // solo resta en el %; el nivel lo manda el % global (que sigue alto).
    expect(r.level).toBe("low");
  });

  it("flags poorly repaired panels", () => {
    const data = pristineInspection();
    setBodywork(data, "door_fr", "repair_poor");
    const r = analyze(data);
    expect(r.counters.poorlyRepaired).toBe(1);
    expect(r.findings[0].level).toBe("critical");
  });
});

describe("analyze: structural escalation", () => {
  it("two structural hits force critical risk", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "struct_repair_bench");
    setChassis(data, "reinforcements", "struct_welded_later");
    const r = analyze(data);
    expect(r.counters.structuralHits).toBe(2);
    expect(r.level).toBe("critical");
  });

  it("a single severe structural deformation puts score in high territory", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "struct_deform_severe");
    const r = analyze(data);
    expect(r.counters.structuralHits).toBe(1);
    // single structural hit alone shouldn't auto-escalate; score path can.
    // severity 3 danger = 15 + 5 structural bonus = 20 → not >= 40 alone
    expect(r.score).toBeGreaterThanOrEqual(15);
  });
});

describe("analyze: chasis calificado con catálogo común (contextual)", () => {
  it("'Deformado' en el chasis cuenta como estructural y fuerza riesgo crítico", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "common_deformed");
    const r = analyze(data);
    expect(r.counters.structuralHits).toBe(1);
    expect(r.level).toBe("critical");
    // danger sev3 (15) + bonus estructural (5) = 20, el tope del ítem de chasis.
    expect(r.score).toBe(20);
  });

  it("'Mal reparado' en el chasis es estructural + reparación deficiente", () => {
    const data = pristineInspection();
    setChassis(data, "chassis_rail_l", "common_poor_repair");
    const r = analyze(data);
    expect(r.counters.structuralHits).toBe(1);
    expect(r.counters.poorlyRepaired).toBe(1);
    expect(r.level).toBe("critical");
  });

  it("'Regular' en el chasis penaliza medio pero NO fuerza riesgo alto", () => {
    const data = pristineInspection();
    setChassis(data, "reinforcements", "common_regular");
    const r = analyze(data);
    expect(r.counters.structuralHits).toBe(0);
    expect(r.level).not.toBe("high");
    expect(r.level).not.toBe("critical");
    // warning sev1 (2) + bonus de advertencia en chasis (3) = 5 (antes era 2).
    expect(r.score).toBe(5);
  });

  it("un chasis deformado hunde el % final y activa el gate de seguridad", () => {
    const clean = computePillars(
      computeHealth(pristineInspection()),
      analyze(pristineInspection()),
    );
    expect(clean.globalPct).toBe(100);

    const data = pristineInspection();
    setChassis(data, "floor", "common_deformed");
    const pillars = computePillars(computeHealth(data), analyze(data));
    expect(pillars.globalPct).not.toBeNull();
    expect(pillars.globalPct!).toBeLessThan(100);
    expect(pillars.gates.some((g) => g.pillar === "safety")).toBe(true);
  });
});

describe("analyze: leaks", () => {
  it("a single heavy leak forces critical risk", () => {
    const data = pristineInspection();
    setLeak(data, "engine_oil", "leak_heavy");
    const r = analyze(data);
    expect(r.counters.criticalLeaks).toBe(1);
    expect(r.level).toBe("critical");
  });

  it("light humidity is only a warning", () => {
    const data = pristineInspection();
    setLeak(data, "coolant", "leak_humid");
    const r = analyze(data);
    expect(r.counters.criticalLeaks).toBe(0);
    expect(r.findings[0].level).toBe("warning");
  });
});

describe("analyze: road test", () => {
  it("braking failure is critical and escalates to high", () => {
    const data = pristineInspection();
    setRoadTest(data, "braking", "road_braking_deficient");
    const r = analyze(data);
    expect(r.counters.brakingIssues).toBe(1);
    expect(r.level).toBe("critical");
    const brakingFinding = r.findings.find((f) => f.item === "Sistema de frenos");
    expect(brakingFinding?.level).toBe("critical");
    expect(brakingFinding?.message).toMatch(/seguridad/i);
  });
});

describe("analyze: tires", () => {
  it("a tire at 25% or below is critical", () => {
    const data = pristineInspection();
    data.tires.frontLeft = 25;
    const r = analyze(data);
    expect(r.counters.tiresCritical).toBe(1);
    const tire = r.findings.find((f) => f.section === "Llantas");
    expect(tire?.level).toBe("critical");
  });

  it("two critical tires force high risk", () => {
    const data = pristineInspection();
    data.tires.frontLeft = 20;
    data.tires.rearRight = 18;
    const r = analyze(data);
    expect(r.counters.tiresCritical).toBe(2);
    expect(r.level).toBe("high");
  });

  it("moderate wear (26-50%) is just a warning", () => {
    const data = pristineInspection();
    data.tires.frontRight = 40;
    const r = analyze(data);
    expect(r.counters.tiresCritical).toBe(0);
    const tire = r.findings.find((f) => f.section === "Llantas");
    expect(tire?.level).toBe("warning");
    expect(r.level).toBe("low");
  });

  it("tire above 50% produces no finding", () => {
    const data = pristineInspection();
    data.tires.frontLeft = 51;
    const r = analyze(data);
    expect(r.findings.find((f) => f.section === "Llantas")).toBeUndefined();
  });
});

describe("analyze: mechanical", () => {
  it("two mechanical fails escalate to medium via counters", () => {
    const data = pristineInspection();
    setSuspension(data, "shock_fl", "mech_noise_metal");
    setSuspension(data, "shock_fr", "mech_smoke");
    const r = analyze(data);
    expect(r.counters.mechanicalBad).toBeGreaterThanOrEqual(2);
    expect(["medium", "high"]).toContain(r.level);
  });

  it("a mechanical leak via the mechanical catalog also bumps criticalLeaks", () => {
    const data = pristineInspection();
    setSuspension(data, "shock_fl", "mech_leak_active");
    const r = analyze(data);
    expect(r.counters.criticalLeaks).toBeGreaterThanOrEqual(1);
    expect(r.level).toBe("critical");
  });
});

describe("analyze: ordering & summary", () => {
  it("findings are sorted critical → warning → info", () => {
    const data = pristineInspection();
    setBodywork(data, "hood", "repainted_full");
    setBodywork(data, "fender_fl", "dent_deep");
    setLeak(data, "engine_oil", "leak_heavy");
    const r = analyze(data);
    // Los tres hallazgos tienen que llegar: antes acá había un valor de
    // catálogo inexistente ("leak_puddle") que findOption descartaba en
    // silencio, así que el orden se verificaba sobre 2 elementos y nunca
    // sobre uno crítico.
    expect(r.findings.length).toBe(3);
    expect(r.findings[0].level).toBe("critical");
    const levels = r.findings.map((f) => f.level);
    const order = { critical: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < levels.length; i++) {
      expect(order[levels[i]]).toBeGreaterThanOrEqual(order[levels[i - 1]]);
    }
  });

  it("conditionSummary reflects worst category", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "struct_repair_bench");
    const r = analyze(data);
    expect(r.conditionSummary).toMatch(/estructural/i);
  });
});

describe("salud por sección: anti-dilución + techo por críticos", () => {
  const bodyIds = BODYWORK_SECTION.groups.flatMap((g) => g.items.map((i) => i.id));

  it("sectionHealthPct: cada crítico baja el techo de la sección", () => {
    expect(sectionHealthPct(0, 0)).toBe(100);
    expect(sectionHealthPct(0, 1)).toBe(80);
    expect(sectionHealthPct(0, 2)).toBe(60);
    expect(sectionHealthPct(0, 3)).toBe(45);
    expect(sectionHealthPct(0, 4)).toBe(30);
  });

  it("sectionHealthPct: la penalización resta en absoluto, sin diluirse", () => {
    expect(sectionHealthPct(8, 0)).toBe(96); // -4 puntos
    expect(sectionHealthPct(40, 0)).toBe(80); // -20 puntos
  });

  it("carrocería es ESTÉTICA: descuento plano suave (advertencia −1, crítico −3)", () => {
    const data = pristineInspection();
    for (const id of bodyIds.slice(0, 4)) setBodywork(data, id, "dent_deep"); // 4 críticos
    const h = computeHealth(data);
    expect(h.bySection.bodywork.danger).toBe(4);
    expect(h.bySection.bodywork.inspected).toBeGreaterThan(20); // muchos ítems OK alrededor
    // 4 críticos × −3 = −12 => 88%. (1 advertencia daría −1 => 99%.)
    expect(h.bySection.bodywork.healthPct).toBe(88);
  });

  it("carrocería: 1 advertencia (repinte) → 99%, 1 crítico → 97%", () => {
    const warn = pristineInspection();
    setBodywork(warn, bodyIds[0], "common_repainted"); // warning
    expect(computeHealth(warn).bySection.bodywork.healthPct).toBe(99);
    const crit = pristineInspection();
    setBodywork(crit, bodyIds[0], "dent_deep"); // danger
    expect(computeHealth(crit).bySection.bodywork.healthPct).toBe(97);
  });

  it("el techo por críticos SÍ aplica a secciones de seguridad/mecánica", () => {
    // Mismo nº de críticos en SUSPENSIÓN (sección no estética) → sí topa fuerte.
    const data = pristineInspection();
    setSuspension(data, "shock_fl", "mech_no_response"); // danger
    setSuspension(data, "shock_fr", "mech_smoke"); // danger
    setSuspension(data, "shock_rl", "mech_no_response"); // danger → 3 críticos: techo 45%
    const h = computeHealth(data);
    expect(h.bySection.suspension.danger).toBe(3);
    expect(h.bySection.suspension.healthPct!).toBeLessThanOrEqual(45);
  });

  it("un peritaje limpio sigue en 100% global (sin falsos negativos)", () => {
    const pillars = computePillars(
      computeHealth(pristineInspection()),
      analyze(pristineInspection()),
    );
    expect(pillars.globalPct).toBe(100);
  });
});

describe("nivel de riesgo: fuente única (% global + gates) + contadores graves", () => {
  const bodyIds = BODYWORK_SECTION.groups.flatMap((g) => g.items.map((i) => i.id));

  it("el nivel de analyze coincide con riskLevelFromPillars del mismo % global", () => {
    const data = pristineInspection();
    setBodywork(data, bodyIds[0], "dent_deep");
    const r = analyze(data);
    const pillars = computePillars(computeHealth(data), r);
    expect(r.level).toBe(riskLevelFromPillars(pillars.globalPct, pillars.gates));
  });

  it("daños estéticos (≥3 abolladuras) ya NO escalan el riesgo — carrocería es valor comercial", () => {
    const data = pristineInspection();
    for (const id of bodyIds.slice(0, 3)) setBodywork(data, id, "dent_deep");
    const r = analyze(data);
    expect(r.counters.damaged).toBe(3);
    expect(r.level).toBe("low");
  });

  it("2 fallas mecánicas SÍ escalan a medio aunque el % siga alto", () => {
    const data = pristineInspection();
    setSuspension(data, "shock_fl", "mech_noise_metal");
    setSuspension(data, "shock_fr", "mech_smoke");
    const r = analyze(data);
    expect(r.counters.mechanicalBad).toBeGreaterThanOrEqual(2);
    expect(["medium", "high"]).toContain(r.level);
  });

  it("contadores leves (repintes) ya no escalan por sí solos", () => {
    const data = pristineInspection();
    for (const id of bodyIds.slice(0, 5)) setBodywork(data, id, "common_repainted");
    const r = analyze(data);
    expect(r.counters.repainted).toBe(5); // antes 'repainted >= 4' forzaba medium
    expect(r.level).toBe("low");
  });
});

describe("piso por peor sección: carrocería NO hunde, mecánica SÍ", () => {
  const bodyIds = BODYWORK_SECTION.groups.flatMap((g) => g.items.map((i) => i.id));

  it("carrocería golpeada (estética) baja el global solo por su peso de pilar (~15%)", () => {
    const data = pristineInspection();
    // 4 abolladuras profundas → carrocería plano suave (4×−3) = 88%.
    for (const id of bodyIds.slice(0, 4)) setBodywork(data, id, "dent_deep");
    const pillars = computePillars(computeHealth(data), analyze(data));
    expect(computeHealth(data).bySection.bodywork.healthPct).toBe(88);
    // Carrocería queda fuera del piso por peor sección, así que el global se
    // mantiene muy alto (solo pierde lo proporcional a su 15%).
    expect(pillars.globalPct!).toBeGreaterThanOrEqual(94);
  });

  it("una sección mecánica catastrófica SÍ sigue arrastrando el global", () => {
    const data = pristineInspection();
    setSuspension(data, "shock_fl", "mech_no_response"); // danger sev3
    setSuspension(data, "shock_fr", "mech_smoke"); // danger sev3
    setSuspension(data, "shock_rl", "mech_no_response"); // danger sev3 → 3 críticos: cap 45%
    const pillars = computePillars(computeHealth(data), analyze(data));
    // Suspensión es FLOOR_SECTION: su bajo % (≤45) topa el global por el piso.
    expect(pillars.globalPct!).toBeLessThan(75);
  });
});

describe("Estructura y Seguridad: chasis por severidad (daño −3/pt, cosmético −1/pt, crítico −20)", () => {
  it("chasis con 1 advertencia de DAÑO sev1 (regular) → 97%", () => {
    const data = pristineInspection();
    setChassis(data, "reinforcements", "common_regular"); // warning sev1, risks damage
    const h = computeHealth(data);
    expect(h.bySection.chassis.warning).toBe(1);
    expect(h.bySection.chassis.warnSeverity).toBe(1);
    expect(h.bySection.chassis.warnSeverityCosmetic).toBe(0); // no es cosmético
    expect(h.bySection.chassis.healthPct).toBe(97); // 100 − 1·3
  });

  it("chasis con 2 advertencias de daño sev1 → 94%", () => {
    const data = pristineInspection();
    setChassis(data, "reinforcements", "common_regular");
    setChassis(data, "floor", "common_regular");
    const h = computeHealth(data);
    expect(h.bySection.chassis.healthPct).toBe(94); // 100 − 2·3
  });

  it("chasis: un 'Repintado' es cosmético → resta solo 1 (99%)", () => {
    const repainted = pristineInspection();
    setChassis(repainted, "chassis_rail_l", "common_repainted"); // warning sev1, cosmético
    const h = computeHealth(repainted);
    expect(h.bySection.chassis.warnSeverityCosmetic).toBe(1);
    expect(h.bySection.chassis.healthPct).toBe(99); // 100 − 1·1 (cosmeticDrop)
  });

  it("chasis: un 'Sumido' (daño sev2) pesa mucho más que un 'Repintado' (cosmético sev1)", () => {
    const sunken = pristineInspection();
    setChassis(sunken, "chassis_rail_l", "common_sunken"); // warning sev2, risks damage
    expect(computeHealth(sunken).bySection.chassis.warnSeverityCosmetic).toBe(0);
    expect(computeHealth(sunken).bySection.chassis.healthPct).toBe(94); // 100 − 2·3

    const repainted = pristineInspection();
    setChassis(repainted, "chassis_rail_l", "common_repainted");
    expect(computeHealth(repainted).bySection.chassis.healthPct).toBe(99); // cosmético
  });

  it("chasis: muchos repintes cosméticos apenas mueven la nota (ya no 0%)", () => {
    const data = pristineInspection();
    // 10 puntos repintados (cosméticos). Antes (−10 plano) daba 0%; ahora −1·10 = 90%.
    const ids = [
      "rocker_l", "rocker_r", "pillar_b_l", "pillar_b_r", "roof_rail_l",
      "roof_rail_r", "door_pillar_fl", "door_pillar_fr", "windshield_pillar_l",
      "windshield_pillar_r",
    ];
    for (const id of ids) setChassis(data, id, "common_repainted");
    const h = computeHealth(data);
    expect(h.bySection.chassis.warning).toBe(10);
    expect(h.bySection.chassis.danger).toBe(0);
    expect(h.bySection.chassis.warnSeverityCosmetic).toBe(10);
    expect(h.bySection.chassis.healthPct).toBe(90); // 100 − 10·1
  });

  it("prueba de ruta con 1 advertencia → 90%", () => {
    const data = pristineInspection();
    setRoadTest(data, "handling", "road_pulls_left"); // warning
    const h = computeHealth(data);
    expect(h.bySection.roadTest.warning).toBe(1);
    expect(h.bySection.roadTest.healthPct).toBe(90);
  });

  it("el descuento plano NO aplica a otras secciones (suspensión sigue por severidad)", () => {
    const data = pristineInspection();
    setSuspension(data, "shock_fl", "mech_noise_light"); // warning sev1
    const h = computeHealth(data);
    // Suspensión (no estructura/seguridad) mantiene la fórmula por severidad:
    // 1 advertencia leve apenas resta, NO baja 10 puntos.
    expect(h.bySection.suspension.healthPct!).toBeGreaterThan(95);
  });
});

describe("gate crítico hunde la barra del pilar (no se diluye)", () => {
  it("daño estructural hunde el pilar de seguridad y el global cuadra con las barras", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "common_deformed"); // estructural → gate crítico
    const pillars = computePillars(computeHealth(data), analyze(data));
    const safety = pillars.pillars.find((p) => p.key === "safety")!;
    expect(safety.healthPct!).toBeLessThanOrEqual(45);
    // El global es el promedio ponderado de los pilares (ya hundidos) → cuadra.
    let ws = 0, wt = 0;
    for (const p of pillars.pillars) {
      if (p.healthPct === null) continue;
      ws += p.healthPct * p.weight;
      wt += p.weight;
    }
    expect(pillars.globalPct).toBe(Math.round(ws / wt));
  });

  it("falla de frenos hunde el pilar de seguridad", () => {
    const data = pristineInspection();
    setRoadTest(data, "braking", "road_braking_deficient");
    const pillars = computePillars(computeHealth(data), analyze(data));
    const safety = pillars.pillars.find((p) => p.key === "safety")!;
    expect(safety.healthPct!).toBeLessThanOrEqual(45);
  });

  it("una sola llanta crítica (gate medio) NO hunde la barra del pilar", () => {
    const data = pristineInspection();
    data.tires.frontLeft = 20; // 1 llanta crítica → gate medium (piso de riesgo)
    const pillars = computePillars(computeHealth(data), analyze(data));
    const equipment = pillars.pillars.find((p) => p.key === "equipment")!;
    // gate medium: sube el piso de riesgo pero no aplica techo de pilar.
    expect(equipment.healthPct!).toBeGreaterThan(45);
  });
});

describe("riskTone", () => {
  it("maps risk levels to tone names", () => {
    expect(riskTone("low")).toBe("success");
    expect(riskTone("medium")).toBe("warning");
    expect(riskTone("high")).toBe("danger");
    expect(riskTone("critical")).toBe("danger");
  });
});

describe("dimensiones nuevas: riesgo + impacto económico", () => {
  it("un repinte es bajo riesgo pero impacto económico medio", () => {
    const data = pristineInspection();
    setBodywork(data, "hood", "common_repainted");
    const r = analyze(data);
    const f = r.findings.find((x) => x.section === "Carrocería");
    expect(f?.riskLevel).toBe("low");
    expect(f?.economicImpact).toBe("medium");
  });

  it("un rayón es bajo riesgo y bajo impacto económico", () => {
    const data = pristineInspection();
    setBodywork(data, "hood", "common_scratch");
    const r = analyze(data);
    const f = r.findings.find((x) => x.section === "Carrocería");
    expect(f?.riskLevel).toBe("low");
    expect(f?.economicImpact).toBe("low");
  });

  it("una llanta lisa es riesgo alto e impacto económico medio", () => {
    const data = pristineInspection();
    data.tires.frontLeft = 20;
    const r = analyze(data);
    const f = r.findings.find((x) => x.section === "Llantas");
    expect(f?.riskLevel).toBe("high");
    expect(f?.economicImpact).toBe("medium");
  });

  it("un daño estructural es riesgo e impacto económico crítico", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "common_deformed");
    const r = analyze(data);
    const f = r.findings.find((x) => x.section === "Chasis / Estructura");
    expect(f?.riskLevel).toBe("critical");
    expect(f?.economicImpact).toBe("critical");
    expect(r.economicImpact).toBe("critical");
    expect(r.estimatedRepairCost).not.toBeNull();
  });

  it("un peritaje limpio no tiene impacto económico ni costo estimado", () => {
    const r = analyze(pristineInspection());
    expect(r.economicImpact).toBe("low");
    expect(r.estimatedRepairCost).toBeNull();
    expect(r.executiveSummary).toMatch(/condici[oó]n t[eé]cnica/i);
  });
});

describe("la carrocería se califica según el TIPO de vehículo", () => {
  // Regresión: analyze()/computeHealth() usaban BODYWORK_SECTION (la variante
  // de sedán) hardcodeada, mientras el wizard y el PDF resuelven el inventario
  // con bodyworkSectionFor(vehicleType). Como entriesOf() itera los ítems de
  // la *definición*, todo panel cuyo id no existiera en el inventario de sedán
  // se ignoraba en silencio: una moto con TODO deformado calificaba 100 %.
  const CASES: { type: VehicleType; label: string }[] = [
    { type: "motorcycle", label: "moto" },
    { type: "trailer", label: "tráiler" },
    { type: "bus", label: "bus" },
    { type: "pickup_double", label: "pickup doble" },
    { type: "campero_5doors", label: "campero 5p" },
  ];

  for (const { type, label } of CASES) {
    it(`${label}: con toda la carrocería deformada NO puede dar 100 %`, () => {
      const data = pristineInspectionOfType(type);
      const ids = bodyworkSectionFor(type).groups.flatMap((g) =>
        g.items.map((i) => i.id),
      );
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) setBodywork(data, id, "common_deformed");

      const h = computeHealth(data);
      // La guarda de regresión real: se evalúan TODOS los paneles del tipo.
      // Antes, con el inventario de sedán, la moto evaluaba 0 y el tráiler 4.
      expect(h.bySection.bodywork.inspected).toBe(ids.length);
      expect(h.bySection.bodywork.healthPct).not.toBeNull();
      // Carrocería usa la calibración plana suave (100 − danger×3), así que el
      // piso depende del nº de paneles: tráiler (15) es el más benigno con 55.
      expect(h.bySection.bodywork.healthPct!).toBeLessThanOrEqual(60);

      const r = analyze(data);
      expect(r.findings.filter((f) => f.section === "Carrocería").length).toBe(
        ids.length,
      );
      expect(computePillars(h, r).globalPct!).toBeLessThan(100);
    });

    it(`${label}: limpio sigue dando 100 % (sin falsos positivos)`, () => {
      const data = pristineInspectionOfType(type);
      const pillars = computePillars(computeHealth(data), analyze(data));
      expect(pillars.globalPct).toBe(100);
    });
  }
});

describe("solo califican las secciones activas del peritaje", () => {
  // Regresión: emptySection() pre-rellena TODAS las secciones del catálogo en
  // "Óptimo", incluida `engine`, que no está en ningún kind (el wizard la
  // oculta y el PDF no la imprime). Sus 7 ítems fantasma entraban al pilar de
  // mecánica al 100 % y diluían los hallazgos reales.
  it("el motor no entra al cálculo aunque venga pre-rellenado", () => {
    const data = pristineInspection();
    const h = computeHealth(data);
    expect(h.bySection.engine.inspected).toBe(0);
    expect(h.bySection.engine.healthPct).toBeNull();
  });

  it("marcar el motor como catastrófico no mueve el puntaje", () => {
    const base = computePillars(
      computeHealth(pristineInspection()),
      analyze(pristineInspection()),
    );
    const data = pristineInspection();
    setEngine(data, "general_check", "mech_no_response");
    setEngine(data, "block", "mech_smoke");
    setEngine(data, "head", "mech_no_response");
    const after = computePillars(computeHealth(data), analyze(data));
    expect(after.globalPct).toBe(base.globalPct);
    expect(analyze(data).findings).toEqual([]);
  });

  it("el motor ya no diluye los hallazgos reales de mecánica", () => {
    // 3 críticos de suspensión → esa sección topa en 45 por criticalCap(3).
    const data = pristineInspection();
    setSuspension(data, "shock_fl", "mech_no_response");
    setSuspension(data, "shock_fr", "mech_no_response");
    setSuspension(data, "shock_rl", "mech_no_response");
    const h = computeHealth(data);
    expect(h.bySection.suspension.healthPct).toBe(45);

    // El pilar promedia sus secciones ponderando por ítems inspeccionados:
    //   suspensión 45×7 + eléctrica 100×6 + fugas 100×14 = 2315 / 27 = 86
    // Con el motor fantasma dentro eran 34 ítems (2315 + 100×7) / 34 = 89:
    // 7 ítems inventados en "Óptimo" levantaban el pilar 3 puntos.
    const pillars = computePillars(h, analyze(data));
    const mech = pillars.pillars.find((p) => p.key === "mechanical");
    expect(mech?.healthPct).toBe(86);
  });
});

describe("impacto económico del chasis: graduado, no siempre crítico", () => {
  // Regresión: la rama de chasis marcaba econ = "critical" para CUALQUIER
  // hallazgo. Como el impacto económico alimenta un rango en COP que se le
  // muestra al cliente, un simple "Repintado" en un estribo estimaba
  // 6.000.000–20.000.000.
  it("un repintado en el chasis es cosmético: riesgo bajo, impacto medio", () => {
    const data = pristineInspection();
    setChassis(data, "rocker_l", "common_repainted");
    const r = analyze(data);
    const f = r.findings.find((x) => x.section === "Chasis / Estructura");
    expect(f?.riskLevel).toBe("low");
    expect(f?.economicImpact).toBe("medium");
    expect(r.economicImpact).toBe("medium");
  });

  it("un deformado en el chasis sigue siendo crítico en ambas dimensiones", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "common_deformed");
    const r = analyze(data);
    const f = r.findings.find((x) => x.section === "Chasis / Estructura");
    expect(f?.riskLevel).toBe("critical");
    expect(f?.economicImpact).toBe("critical");
  });

  it("un daño no estructural en el chasis queda entre medio y alto", () => {
    const data = pristineInspection();
    setChassis(data, "rocker_l", "common_sunken"); // warning sev2, damage
    const r = analyze(data);
    const f = r.findings.find((x) => x.section === "Chasis / Estructura");
    expect(f?.riskLevel).toBe("medium");
    expect(f?.economicImpact).toBe("high");
  });

  it("el costo estimado de un repintado es mucho menor que el de un deformado", () => {
    const rep = pristineInspection();
    setChassis(rep, "rocker_l", "common_repainted");
    const deform = pristineInspection();
    setChassis(deform, "floor", "common_deformed");

    const costRep = analyze(rep).estimatedRepairCost;
    const costDeform = analyze(deform).estimatedRepairCost;
    expect(costRep).not.toBeNull();
    expect(costDeform).not.toBeNull();
    expect(costRep!.max).toBeLessThan(costDeform!.min);
  });
});
