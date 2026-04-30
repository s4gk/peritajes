import { redirect } from "next/navigation";

import { countUsers, getCurrentUser } from "@/lib/server/auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  if ((await countUsers()) === 0) redirect("/setup");

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
      <LoginForm />
    </div>
  );
}
