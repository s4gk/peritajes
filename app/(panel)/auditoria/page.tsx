import { redirect } from "next/navigation";

import { getCurrentUser, listUsers } from "@/lib/server/auth";
import { listAuditActions, listAuditLog } from "@/lib/server/audit";

import { AuditoriaClient } from "./auditoria-client";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="container max-w-2xl py-10">
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Solo los administradores pueden ver la auditoría.
        </div>
      </div>
    );
  }

  const [initialPage, users, actions] = await Promise.all([
    listAuditLog({ limit: 100 }),
    listUsers(),
    listAuditActions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
      <AuditoriaClient
        initialPage={initialPage}
        users={users.map((u) => ({ id: u.id, fullName: u.fullName, username: u.username }))}
        actions={actions}
      />
    </div>
  );
}
