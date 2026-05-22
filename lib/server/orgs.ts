import "server-only";

import crypto from "node:crypto";

import { logAudit, query } from "./db";

/**
 * Organizaciones (multi-tenant).
 *
 *  - admin       → no pertenece a ninguna org (`orgId === null`).
 *  - owner       → dueño del negocio. Es `owner_user_id` de SU org.
 *                  Ve todos los peritajes de su org (propios + empleados).
 *  - employee    → perito asalariado. Miembro de la org del owner.
 *                  Solo ve sus propios peritajes.
 *
 * Las relaciones se mantienen vía `users.org_id`. Las tablas con scope por
 * tenant (inspections, appointments, audit_log) llevan su propio `org_id`
 * para que el filtro de autorización sea un JOIN simple en lugar de un walk
 * por user_id.
 */

export type Organization = {
  id: string;
  name: string;
  ownerUserId: string | null;
  createdAt: string;
};

type OrgRow = {
  id: string;
  name: string;
  owner_user_id: string | null;
  created_at: Date | string;
};

function rowToOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
  };
}

function makeOrgId(): string {
  return `org_${crypto.randomBytes(9).toString("base64url")}`;
}

export async function listOrganizations(): Promise<Organization[]> {
  const r = await query<OrgRow>(
    "SELECT * FROM organizations ORDER BY created_at ASC",
  );
  return r.rows.map(rowToOrg);
}

export async function getOrgById(id: string): Promise<Organization | null> {
  const r = await query<OrgRow>(
    "SELECT * FROM organizations WHERE id = $1",
    [id],
  );
  return r.rows[0] ? rowToOrg(r.rows[0]) : null;
}

export type CreateOrgInput = {
  name: string;
  ownerUserId: string | null;
};

export async function createOrganization(
  input: CreateOrgInput,
  createdBy: string | null,
): Promise<Organization> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre de la organización es requerido.");

  const id = makeOrgId();
  await query(
    `INSERT INTO organizations (id, name, owner_user_id)
     VALUES ($1, $2, $3)`,
    [id, name, input.ownerUserId],
  );
  await logAudit(createdBy, "org.created", JSON.stringify({ id, name }));
  const created = await getOrgById(id);
  if (!created) throw new Error("No se pudo crear la organización.");
  return created;
}

export async function setOrgOwner(
  orgId: string,
  ownerUserId: string | null,
  changedBy: string | null,
): Promise<void> {
  await query(
    "UPDATE organizations SET owner_user_id = $1 WHERE id = $2",
    [ownerUserId, orgId],
  );
  await logAudit(
    changedBy,
    "org.owner_changed",
    JSON.stringify({ orgId, ownerUserId }),
  );
}

export async function renameOrganization(
  orgId: string,
  name: string,
  changedBy: string | null,
): Promise<Organization | null> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("El nombre de la organización es requerido.");
  await query("UPDATE organizations SET name = $1 WHERE id = $2", [
    trimmed,
    orgId,
  ]);
  await logAudit(
    changedBy,
    "org.renamed",
    JSON.stringify({ orgId, name: trimmed }),
  );
  return getOrgById(orgId);
}
