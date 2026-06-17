import { test } from "vitest";
import { writeFileSync } from "node:fs";

import { renderReportHtml } from "@/lib/pdf-template";
import { analyze } from "@/lib/rules-engine";
import {
  pristineInspection,
  setBodywork,
  setChassis,
  setEngine,
  setLeak,
  setRoadTest,
} from "./fixtures";

// Construye un peritaje con una mezcla realista de hallazgos para que el PDF
// tenga contenido en (casi) todas las secciones y se vean los cortes de página.
function sampleInspection() {
  let data = pristineInspection();
  data.vehicle.owner = "Juan Pérez Gómez";
  data.vehicle.ownerDocument = "1.234.567.890";
  data.conclusion.observations =
    "Vehículo en condición general aceptable. Se detectan reparaciones de latonería en costado derecho y fuga leve por tapa de válvulas. Se recomienda seguimiento.";
  data = setBodywork(data, "bodywork_front_bumper", "repainted");
  data = setBodywork(data, "bodywork_right_front_door", "repaired");
  data = setChassis(data, "chassis_right_rail", "minor_damage");
  data = setEngine(data, "engine_oil_level", "regular");
  data = setLeak(data, "leaks_valve_cover", "minor");
  data = setRoadTest(data, "roadtest_brakes", "deficient");
  return data;
}

test("genera preview HTML del PDF", () => {
  const data = sampleInspection();
  const report = analyze(data);
  const html = renderReportHtml(data, report, { mode: "detailed" });

  const out = process.env.PREVIEW_OUT || "/tmp/perito-preview.html";
  writeFileSync(out, html, "utf8");
  // eslint-disable-next-line no-console
  console.log(`HTML escrito en ${out} (${(html.length / 1024).toFixed(0)} KB)`);
});
