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

  // La cookie CSRF la siembra el middleware en GETs de rutas del panel — no
  // se puede mutar desde este Server Component.

  return (
    <PanelShell
      user={{
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        licenseId: user.licenseId,
        signatureDataUrl: user.signatureDataUrl,
        role: user.role,
        orgId: user.orgId,
      }}
    >
      {children}
    </PanelShell>
  );
}
