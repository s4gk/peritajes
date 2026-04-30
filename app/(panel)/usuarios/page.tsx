import { redirect } from "next/navigation";

import { getCurrentUser, listUsers } from "@/lib/server/auth";

import { UsuariosClient } from "./usuarios-client";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="container max-w-2xl py-10">
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Solo los administradores pueden gestionar usuarios.
        </div>
      </div>
    );
  }
  return <UsuariosClient initialUsers={await listUsers()} currentUserId={user.id} />;
}
