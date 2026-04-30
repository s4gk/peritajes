import { redirect } from "next/navigation";

import { countUsers } from "@/lib/server/auth";

import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
      <SetupForm />
    </div>
  );
}
