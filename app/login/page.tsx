import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { countUsers, getCurrentUser } from "@/lib/server/auth";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  if ((await countUsers()) === 0) redirect("/setup");

  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
