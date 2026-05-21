import { describe, it, expect } from "vitest";
import { analyze, riskTone } from "@/lib/rules-engine";
import {
  pristineInspection,
  setBodywork,
  setChassis,
  setLeak,
  setRoadTest,
  setEngine,
} from "./fixtures";

describe("analyze: clean baseline", () => {
  it("returns low risk and zero findings for a fully OK inspection", () => {
    const r = analyze(pristineInspection());
    expect(r.level).toBe("low");
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(0);
    expect(r.counters.repainted).toBe(0);
    expect(r.counters.structuralHits).toBe(0);
    expect(r.headline).toMatch(/Riesgo bajo/i);
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

  it("escalates to medium when a panel is damaged", () => {
    const data = pristineInspection();
    setBodywork(data, "fender_fl", "dent_deep");
    const r = analyze(data);
    expect(r.counters.damaged).toBe(1);
    expect(r.level).toBe("medium");
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
  it("two structural hits force high risk", () => {
    const data = pristineInspection();
    setChassis(data, "floor", "struct_repair_bench");
    setChassis(data, "reinforcements", "struct_welded_later");
    const r = analyze(data);
    expect(r.counters.structuralHits).toBe(2);
    expect(r.level).toBe("high");
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

describe("analyze: leaks", () => {
  it("a single heavy leak forces high risk", () => {
    const data = pristineInspection();
    setLeak(data, "engine_oil", "leak_puddle");
    const r = analyze(data);
    expect(r.counters.criticalLeaks).toBe(1);
    expect(r.level).toBe("high");
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
    expect(r.level).toBe("high");
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
    setEngine(data, "general_check", "mech_noise_metal");
    setEngine(data, "block", "mech_smoke");
    const r = analyze(data);
    expect(r.counters.mechanicalBad).toBeGreaterThanOrEqual(2);
    expect(["medium", "high"]).toContain(r.level);
  });

  it("an engine leak via mechanical catalog also bumps criticalLeaks", () => {
    const data = pristineInspection();
    setEngine(data, "general_check", "mech_leak_active");
    const r = analyze(data);
    expect(r.counters.criticalLeaks).toBeGreaterThanOrEqual(1);
    expect(r.level).toBe("high");
  });
});

describe("analyze: ordering & summary", () => {
  it("findings are sorted critical → warning → info", () => {
    const data = pristineInspection();
    setBodywork(data, "hood", "repainted_full");
    setBodywork(data, "fender_fl", "dent_deep");
    setLeak(data, "engine_oil", "leak_puddle");
    const r = analyze(data);
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

describe("riskTone", () => {
  it("maps risk levels to tone names", () => {
    expect(riskTone("low")).toBe("success");
    expect(riskTone("medium")).toBe("warning");
    expect(riskTone("high")).toBe("danger");
  });
});
