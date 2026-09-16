import { test, expect } from "vitest";
import { writeFileSync } from "node:fs";

import { InspectionDataSchema } from "@/lib/inspection-schema";
import { getCompanyConfig, updateCompanyConfig } from "@/lib/server/company";
import { query } from "@/lib/server/db";
import { renderInspectionPdf } from "@/lib/server/pdf-render";
import type { InspectionData } from "@/lib/types";
import { pristineInspection, setChassis } from "./fixtures";

/**
 * Peritaje END-TO-END del concepto de asegurabilidad, contra la base real.
 *
 * Corre en una ORG DE PRUEBA propia (no toca la org del cliente) y borra todo
 * al final. Valida la cadena completa que las pruebas unitarias no alcanzan:
 * migración → config de empresa → zod → jsonb → lectura → PDF con branding real.
 *
 *   npx vitest run --config vitest.gen.config.ts tests/_e2e-insurability.gen.test.ts
 */
const TEST_ORG = "org_TEST_asegurabilidad";
const TEST_INSPECTION = "insp_TEST_asegurabilidad";
const OUT_DIR = process.env.PREVIEW_DIR || "/tmp";

function finalizedInspection(): InspectionData {
  let data = pristineInspection();
  data.vehicle.plate = "TST001";
  data.vehicle.owner = "Cliente de Prueba";
  data.vehicle.ownerDocument = "1.111.111.111";
  data = setChassis(data, "front_corner_l", "struct_deform_severe");
  data.conclusion.generalCondition = "ASEGURABILIDAD SUJETA A POLÍTICAS";
  data.conclusion.insurability = "no";
  data.conclusion.observations =
    "Peritaje de prueba generado para validar el concepto de asegurabilidad.";
  data.conclusion.recommendation = "Registro de prueba — no corresponde a un vehículo real.";
  data.status = "completed";
  return data;
}

test("peritaje end-to-end con concepto de asegurabilidad", async () => {
  // 1. Migración: la columna nueva. Idempotente, igual que en db.ts.
  await query(
    `ALTER TABLE company_config
       ADD COLUMN IF NOT EXISTS insurability_verdict BOOLEAN NOT NULL DEFAULT FALSE`,
  );
  const col = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'company_config' AND column_name = 'insurability_verdict'`,
  );
  expect(col.rowCount).toBe(1);
  console.log("✓ migración aplicada: company_config.insurability_verdict existe");

  try {
    // 2. Org de prueba + config con la función PRENDIDA.
    await query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_ORG, "ZZ Prueba Asegurabilidad"],
    );
    await updateCompanyConfig(TEST_ORG, {
      name: "ZZ Prueba Asegurabilidad",
      nit: "900.123.456-7",
      phone: "300 000 0000",
      insurabilityVerdict: true,
    });

    // 3. Round-trip de la config: es la fuente del gate que el panel inyecta.
    const cfg = await getCompanyConfig(TEST_ORG);
    expect(cfg.insurabilityVerdict).toBe(true);
    console.log("✓ company config: insurabilityVerdict = true (org lo tiene prendido)");

    const otherOrg = await getCompanyConfig("org_JXH51RiXMPdf");
    expect(otherOrg.insurabilityVerdict).toBe(false);
    console.log("✓ la org del cliente real sigue en false (no se le prendió nada)");

    // 4. Validación zod — la misma que corre el server al recibir el PUT.
    const raw = finalizedInspection();
    const parsed = InspectionDataSchema.parse(raw);
    expect(parsed.conclusion.insurability).toBe("no");
    console.log("✓ zod acepta y conserva conclusion.insurability");

    // 5. Guardado real en Postgres (jsonb).
    await query(
      `INSERT INTO inspections (id, user_id, status, plate, data, org_id, report_number)
       VALUES ($1, NULL, 'completed', $2, $3::jsonb, $4, $5)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [
        TEST_INSPECTION,
        raw.vehicle.plate,
        JSON.stringify(parsed),
        TEST_ORG,
        "PER-TEST-0001",
      ],
    );

    // 6. Lectura desde la base — el veredicto tiene que sobrevivir el jsonb.
    const row = await query<{ data: InspectionData }>(
      `SELECT data FROM inspections WHERE id = $1`,
      [TEST_INSPECTION],
    );
    const stored = row.rows[0].data;
    expect(stored.conclusion.insurability).toBe("no");
    console.log("✓ jsonb round-trip: el veredicto vuelve intacto desde Postgres");

    // 7. PDF por la ruta real del server (branding desde la config de la org).
    const pdf = await renderInspectionPdf({
      data: stored,
      mode: "detailed",
      orgId: TEST_ORG,
      reportNumber: "PER-TEST-0001",
    });
    const out = `${OUT_DIR}/peritaje-e2e-asegurable-no.pdf`;
    writeFileSync(out, pdf.buffer);
    console.log(`✓ PDF real generado: ${out} (${Math.round(pdf.buffer.length / 1024)} KB)`);
  } finally {
    // 8. Limpieza. La FK de inspections es ON DELETE SET NULL, así que el
    //    peritaje se borra explícito ANTES que la org (si no, queda huérfano).
    await query(`DELETE FROM inspections WHERE id = $1`, [TEST_INSPECTION]);
    await query(`DELETE FROM company_config WHERE org_id = $1`, [TEST_ORG]);
    await query(`DELETE FROM organizations WHERE id = $1`, [TEST_ORG]);
    const left = await query(
      `SELECT count(*)::int AS n FROM inspections WHERE id = $1 OR org_id = $2`,
      [TEST_INSPECTION, TEST_ORG],
    );
    expect(left.rows[0].n).toBe(0);
    console.log("✓ limpieza: org y peritaje de prueba borrados");
  }
}, 180_000);
