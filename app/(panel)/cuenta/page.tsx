import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

import { CuentaClient } from "./cuenta-client";

export const dynamic = "force-dynamic";

export default async function CuentaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <CuentaClient
      user={{
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        licenseId: user.licenseId,
        signatureDataUrl: user.signatureDataUrl,
        waPhone: user.waPhone,
        role: user.role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      }}
    />
  );
}
