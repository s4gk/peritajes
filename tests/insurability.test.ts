import { describe, it, expect } from "vitest";
import { renderReportHtml } from "@/lib/pdf-template";
import { analyze, computeHealth } from "@/lib/rules-engine";
import {
  APPROVAL_THRESHOLD,
  computePillars,
  insurabilityLabel,
  suggestedInsurability,
  type HardGate,
} from "@/lib/scoring";
import { pristineInspection, setChassis } from "./fixtures";

function gate(severity: HardGate["severity"]): HardGate {
  return { reason: "test", detail: "test", pillar: "safety", severity };
}

describe("suggestedInsurability", () => {
  it("no sugiere nada si el peritaje no alcanza a calificar", () => {
    expect(suggestedInsurability(null, [])).toBeNull();
    expect(suggestedInsurability(null, [gate("critical")])).toBeNull();
  });

  it("sugiere SÍ cuando la nota llega al umbral y no hay gates fuertes", () => {
    expect(suggestedInsurability(100, [])).toBe("yes");
    expect(suggestedInsurability(APPROVAL_THRESHOLD, [])).toBe("yes");
  });

  it("sugiere NO por debajo del umbral", () => {
    expect(suggestedInsurability(APPROVAL_THRESHOLD - 1, [])).toBe("no");
    expect(suggestedInsurability(0, [])).toBe("no");
  });

  it("un gate alto o crítico fuerza NO aunque la nota sea perfecta", () => {
    expect(suggestedInsurability(100, [gate("high")])).toBe("no");
    expect(suggestedInsurability(100, [gate("critical")])).toBe("no");
  });

  it("un gate medio (1 llanta crítica) NO alcanza para negar la asegurabilidad", () => {
    expect(suggestedInsurability(100, [gate("medium")])).toBe("yes");
  });
});

describe("suggestedInsurability sobre peritajes reales", () => {
  it("un peritaje impecable sugiere ASEGURABLE SÍ", () => {
    const data = pristineInspection();
    const pillars = computePillars(computeHealth(data), analyze(data));
    expect(suggestedInsurability(pillars.globalPct, pillars.gates)).toBe("yes");
  });

  it("un daño estructural confirmado sugiere ASEGURABLE NO", () => {
    const data = pristineInspection();
    setChassis(data, "front_corner_l", "struct_deform_severe");
    const pillars = computePillars(computeHealth(data), analyze(data));
    expect(pillars.gates.some((g) => g.severity === "critical")).toBe(true);
    expect(suggestedInsurability(pillars.globalPct, pillars.gates)).toBe("no");
  });
});

describe("insurabilityLabel", () => {
  it("usa el texto exacto que exige el cliente institucional", () => {
    expect(insurabilityLabel("yes")).toBe("ASEGURABLE SÍ");
    expect(insurabilityLabel("no")).toBe("ASEGURABLE NO");
  });
});

describe("portada del PDF", () => {
  it("no imprime el banner si el peritaje no trae dictamen (org sin la función)", () => {
    const data = pristineInspection();
    const html = renderReportHtml(data, analyze(data), { mode: "detailed" });
    expect(html).not.toContain("Concepto de asegurabilidad");
  });

  it("imprime ASEGURABLE SÍ en verde, junto al concepto del peritaje", () => {
    const data = pristineInspection();
    data.conclusion.generalCondition = "ESTÁNDAR";
    data.conclusion.insurability = "yes";
    const html = renderReportHtml(data, analyze(data), { mode: "detailed" });
    expect(html).toContain("Concepto de asegurabilidad");
    expect(html).toContain("ASEGURABLE SÍ");
    expect(html).toContain("Concepto del peritaje");
  });

  it("imprime ASEGURABLE NO en rojo", () => {
    const data = setChassis(
      pristineInspection(),
      "front_corner_l",
      "struct_deform_severe",
    );
    data.conclusion.insurability = "no";
    const html = renderReportHtml(data, analyze(data), { mode: "detailed" });
    expect(html).toContain("ASEGURABLE NO");
    expect(html).toContain("concepto-banner tone-danger");
  });
});
