import { redirect } from "next/navigation";

import { getCurrentUser, listUsers } from "@/lib/server/auth";

import { UsuariosClient } from "./usuarios-client";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Si soy employee, no debería entrar acá (la sidebar lo oculta) — pero por
  // si llega por URL directa, redirigimos al dashboard. No es secreto, solo
  // que no aplica al rol.
  if (user.role === "employee") {
    redirect("/dashboard");
  }
  return (
    <UsuariosClient
      initialUsers={await listUsers(user)}
      currentUserId={user.id}
      currentUserRole={user.role}
    />
  );
}
