import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

import { BackupClient } from "./backup-client";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="container max-w-2xl py-10">
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Solo los administradores pueden gestionar backups.
        </div>
      </div>
    );
  }
  return <BackupClient />;
}
