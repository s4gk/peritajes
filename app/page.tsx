import { redirect } from "next/navigation";

import { countUsers, getCurrentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  if ((await countUsers()) === 0) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect("/dashboard");
}
