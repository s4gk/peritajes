import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

import { BackupClient } from "./backup-client";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "employee") redirect("/dashboard");
  return <BackupClient />;
}
