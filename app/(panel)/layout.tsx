import { redirect } from "next/navigation";

import { PanelShell } from "@/components/panel/panel-shell";
import { countUsers, getCurrentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if ((await countUsers()) === 0) redirect("/setup");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <PanelShell
      user={{
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      }}
    >
      {children}
    </PanelShell>
  );
}
