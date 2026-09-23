import { describe, expect, it } from "vitest";
import type { HealthReport, SectionHealth } from "@/lib/rules-engine";
import {
  PILLARS,
  applyManualPillarScores,
  applyManualSectionScores,
  hasCompletePillarScores,
  type PillarReport,
} from "@/lib/scoring";

function autoReport(pct: number): PillarReport {
  return {
    pillars: PILLARS.map((p) => ({
      key: p.key,
      title: p.title,
      description: p.description,
      weight: p.weight,
      inspected: 5,
      ok: 5,
      warning: 0,
      danger: 0,
      warnSeverity: 0,
      warnSeverityCosmetic: 0,
      penalty: 0,
      maxPenalty: 0,
      healthPct: pct,
    })),
    globalPct: pct,
    gates: [],
  };
}

describe("calificación manual por pilares", () => {
  it("sin valores manuales deja el cálculo automático intacto", () => {
    const auto = autoReport(90);
    expect(applyManualPillarScores(auto, undefined)).toBe(auto);
    expect(applyManualPillarScores(auto, {})).toBe(auto);
  });

  it("los 4 valores del perito mandan y el global es su promedio ponderado", () => {
    const r = applyManualPillarScores(autoReport(90), {
      safety: 80,
      mechanical: 60,
      bodywork: 100,
      equipment: 50,
    });
    expect(r.manual).toBe(true);
    expect(r.pillars.map((p) => p.healthPct)).toEqual([80, 60, 100, 50]);
    // 80·0.45 + 60·0.30 + 100·0.15 + 50·0.10 = 74
    expect(r.globalPct).toBe(74);
  });

  it("un pilar sin valor manual conserva el automático", () => {
    const r = applyManualPillarScores(autoReport(90), { safety: 40 });
    expect(r.pillars.find((p) => p.key === "safety")!.healthPct).toBe(40);
    expect(r.pillars.find((p) => p.key === "mechanical")!.healthPct).toBe(90);
  });

  it("recorta a 0-100", () => {
    const r = applyManualPillarScores(autoReport(90), { safety: 140, mechanical: -5 });
    expect(r.pillars.find((p) => p.key === "safety")!.healthPct).toBe(100);
    expect(r.pillars.find((p) => p.key === "mechanical")!.healthPct).toBe(0);
  });

  it("exige los 4 módulos para considerarse completa", () => {
    expect(hasCompletePillarScores(undefined)).toBe(false);
    expect(hasCompletePillarScores({ safety: 80, mechanical: 70, bodywork: 90 })).toBe(false);
    expect(
      hasCompletePillarScores({ safety: 80, mechanical: 70, bodywork: 90, equipment: 0 }),
    ).toBe(true);
  });
});

function section(pct: number | null): SectionHealth {
  return {
    inspected: pct === null ? 0 : 5,
    ok: 5,
    warning: 0,
    danger: 0,
    warnSeverity: 0,
    warnSeverityCosmetic: 0,
    penalty: 0,
    maxPenalty: 0,
    healthPct: pct,
  };
}

function autoHealth(): HealthReport {
  return {
    global: section(70),
    bySection: {
      chassis: section(91),
      roadTest: section(null),
      engine: section(80),
      suspension: section(85),
      electrical: section(100),
      leaks: section(99),
      bodywork: section(58),
      tires: section(50),
    },
  };
}

describe("calificación manual en los encabezados de sección del PDF", () => {
  it("sin valores manuales devuelve el mismo objeto", () => {
    const h = autoHealth();
    expect(applyManualSectionScores(h, undefined)).toBe(h);
    expect(applyManualSectionScores(h, {})).toBe(h);
  });

  it("cada sección toma el % manual de su pilar (caso FKK020)", () => {
    const h = autoHealth();
    const r = applyManualSectionScores(h, {
      safety: 90,
      mechanical: 90,
      bodywork: 78,
      equipment: 60,
    });
    expect(r.bySection.bodywork.healthPct).toBe(78);
    expect(r.bySection.chassis.healthPct).toBe(90);
    expect(r.bySection.engine.healthPct).toBe(90);
    expect(r.bySection.leaks.healthPct).toBe(90);
    expect(r.bySection.tires.healthPct).toBe(60);
    // No muta el original: los pilares automáticos se arman con él.
    expect(h.bySection.bodywork.healthPct).toBe(58);
  });

  it("una sección sin inspeccionar sigue sin nota", () => {
    const r = applyManualSectionScores(autoHealth(), { safety: 90 });
    expect(r.bySection.roadTest.healthPct).toBeNull();
  });

  it("un pilar sin valor manual deja sus secciones en automático", () => {
    const r = applyManualSectionScores(autoHealth(), { bodywork: 78 });
    expect(r.bySection.bodywork.healthPct).toBe(78);
    expect(r.bySection.chassis.healthPct).toBe(91);
  });
});
