import "server-only";

import { query } from "./db";

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

export async function getCompanyConfig(): Promise<CompanyConfig> {
  const r = await query<CompanyRow>(
    "SELECT * FROM company_config WHERE id = 1",
  );
  return rowToConfig(r.rows[0]);
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

export async function updateCompanyConfig(
  input: CompanyConfigInput,
): Promise<CompanyConfig> {
  if (!input.name?.trim()) {
    throw new Error("El nombre de la empresa es requerido.");
  }
  await query(
    `UPDATE company_config
     SET name = $1, tagline = $2, nit = $3, address = $4, phone = $5,
         email = $6, website = $7, logo_data_url = $8, updated_at = now()
     WHERE id = 1`,
    [
      input.name.trim(),
      input.tagline ?? "",
      input.nit ?? "",
      input.address ?? "",
      input.phone ?? "",
      input.email ?? "",
      input.website ?? "",
      input.logoDataUrl ?? "",
    ],
  );
  return getCompanyConfig();
}
