import { redirect } from "next/navigation";
import { Settings } from "lucide-react";

import { getCurrentUser } from "@/lib/server/auth";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Configuración de plataforma
        </h1>
      </div>

      <Card>
        <CardContent className="px-4 py-6 text-sm text-muted-foreground space-y-2">
          <p>Sección reservada para configuración global del servicio.</p>
          <p>
            Próximamente: planes y precios, branding por defecto para nuevas
            empresas, límites de peritajes por org, integraciones globales.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
