import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";
import { listOrganizationsWithDetails } from "@/lib/server/orgs";

import { ClientesClient } from "./clientes-client";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Sección "Administrador" — solo Vestel. Cualquier owner/employee va al dash.
  if (user.role !== "admin") redirect("/dashboard");
  return <ClientesClient initialOrgs={await listOrganizationsWithDetails()} />;
}
