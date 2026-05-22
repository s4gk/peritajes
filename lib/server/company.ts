import "server-only";

import { query } from "./db";

/**
 * Configuración de empresa POR ORGANIZACIÓN. Cada org (cliente de Vestel)
 * tiene su propia identidad — NIT, branding, datos de contacto — que se
 * inyecta en su PDF y comunicaciones. El admin (Vestel) no tiene config
 * propia: si pide config sin orgId, devolvemos defaults razonables.
 *
 * En DB la tabla tiene una columna `org_id` UNIQUE. La fila legacy id=1
 * quedó asociada al org default en la migración multi-tenant; nuevas orgs
 * obtienen su fila al primer `updateCompanyConfig(orgId, ...)` o al primer
 * `getCompanyConfig(orgId)` (que inserta defaults si no existe).
 */

export type CompanyConfig = {
  name: string;
  tagline: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logoDataUrl: string;
  updatedAt: string;
};

type CompanyRow = {
  name: string;
  tagline: string | null;
  nit: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_data_url: string | null;
  updated_at: Date | string;
};

const DEFAULTS: CompanyConfig = {
  name: "Peritaje del Llano",
  tagline: "Peritaje vehicular profesional",
  nit: "",
  address: "Colombia",
  phone: "",
  email: "",
  website: "",
  logoDataUrl: "",
  updatedAt: new Date(0).toISOString(),
};

function rowToConfig(row: CompanyRow): CompanyConfig {
  const updatedAt =
    typeof row.updated_at === "string"
      ? row.updated_at
      : row.updated_at.toISOString();
  return {
    name: row.name,
    tagline: row.tagline ?? "",
    nit: row.nit ?? "",
    address: row.address ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    logoDataUrl: row.logo_data_url ?? "",
    updatedAt,
  };
}

/**
 * Lee la config de una org. Si `orgId` es null (admin sin tenant) o no
 * existe fila para ese org, devolvemos defaults — el PDF queda con
 * branding genérico, lo cual es lo correcto para previews o peritajes
 * cross-org de admin.
 */
export async function getCompanyConfig(
  orgId: string | null,
): Promise<CompanyConfig> {
  if (!orgId) return DEFAULTS;
  const r = await query<CompanyRow>(
    "SELECT * FROM company_config WHERE org_id = $1",
    [orgId],
  );
  return r.rows[0] ? rowToConfig(r.rows[0]) : DEFAULTS;
}

export type CompanyConfigInput = {
  name: string;
  tagline?: string;
  nit?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logoDataUrl?: string;
};

/**
 * Update upsert por org_id. Si la fila no existe (orgs nuevas creadas
 * después de la migración inicial), la insertamos. La fila legacy id=1
 * conserva su PK para no romper otras consultas, pero la matching key es
 * `org_id`.
 */
export async function updateCompanyConfig(
  orgId: string,
  input: CompanyConfigInput,
): Promise<CompanyConfig> {
  if (!orgId) {
    throw new Error("Falta orgId para actualizar configuración de empresa.");
  }
  if (!input.name?.trim()) {
    throw new Error("El nombre de la empresa es requerido.");
  }
  const params = [
    input.name.trim(),
    input.tagline ?? "",
    input.nit ?? "",
    input.address ?? "",
    input.phone ?? "",
    input.email ?? "",
    input.website ?? "",
    input.logoDataUrl ?? "",
    orgId,
  ];
  // ¿Existe fila para esta org? Si sí, UPDATE; si no, INSERT con id sintético
  // para no chocar con la PK legacy `id=1`. Usamos un MAX(id)+1 atómico.
  const existing = await query<{ id: number }>(
    "SELECT id FROM company_config WHERE org_id = $1",
    [orgId],
  );
  if (existing.rowCount === 0) {
    await query(
      `INSERT INTO company_config
        (id, name, tagline, nit, address, phone, email, website, logo_data_url, org_id, updated_at)
       VALUES (
         COALESCE((SELECT MAX(id) FROM company_config), 0) + 1,
         $1, $2, $3, $4, $5, $6, $7, $8, $9, now()
       )`,
      params,
    );
  } else {
    await query(
      `UPDATE company_config
       SET name = $1, tagline = $2, nit = $3, address = $4, phone = $5,
           email = $6, website = $7, logo_data_url = $8, updated_at = now()
       WHERE org_id = $9`,
      params,
    );
  }
  return getCompanyConfig(orgId);
}
