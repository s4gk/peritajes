import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";
import { getCompanyConfig } from "@/lib/server/company";

import { CompanyForm } from "./company-form";

export const dynamic = "force-dynamic";

export default async function EmpresaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const company = await getCompanyConfig();
  return (
    <div className="container max-w-3xl py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Empresa
        </h1>
        <p className="text-sm text-muted-foreground">
          Datos que aparecen en el encabezado del PDF y comunicaciones.
        </p>
      </div>
      <CompanyForm initial={company} />
    </div>
  );
}
