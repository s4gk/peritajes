import { redirect } from "next/navigation";

import { getCurrentUser, listUsers } from "@/lib/server/auth";

import { UsuariosClient } from "./usuarios-client";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <UsuariosClient
      initialUsers={await listUsers()}
      currentUserId={user.id}
      currentUserRole={user.role}
    />
  );
}
