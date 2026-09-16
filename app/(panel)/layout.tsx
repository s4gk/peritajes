import { redirect } from "next/navigation";

import { ImpersonateBanner } from "@/components/panel/impersonate-banner";
import { PanelShell } from "@/components/panel/panel-shell";
import { PushSubscriber } from "@/components/shared/push-subscriber";
import { countUsers, getCurrentUser } from "@/lib/server/auth";
import { getCompanyConfig } from "@/lib/server/company";

export const dynamic = "force-dynamic";

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if ((await countUsers()) === 0) redirect("/setup");

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Interruptores de producto de la org. Van embebidos en el shell (y no por
  // fetch) para que el wizard offline los tenga sin red.
  const company = await getCompanyConfig(user.orgId);

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
      features={{ insurabilityVerdict: company.insurabilityVerdict }}
    >
      {user.impersonatedBy && (
        <ImpersonateBanner targetFullName={user.fullName} />
      )}
      {children}
      <PushSubscriber />
    </PanelShell>
  );
}
