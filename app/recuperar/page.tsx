import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { getCurrentUser } from "@/lib/server/auth";

import { RecuperarForm } from "./recuperar-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recuperar contraseña",
};

export default async function RecuperarPage() {
  // Con sesión abierta esto no tiene sentido: para cambiar la propia clave
  // está /cuenta.
  const user = await getCurrentUser();
  if (user) redirect("/cuenta");

  return (
    <AuthShell>
      <RecuperarForm />
    </AuthShell>
  );
}
