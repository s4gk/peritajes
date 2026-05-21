import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

import { WhatsAppClient } from "./whatsapp-client";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <div className="container max-w-2xl py-10">
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Solo los administradores pueden conectar el WhatsApp del negocio.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-md px-4 py-6 sm:px-6 lg:px-8">
      <WhatsAppClient />
    </div>
  );
}
