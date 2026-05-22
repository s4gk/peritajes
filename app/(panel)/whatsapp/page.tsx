import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";

import { WhatsAppClient } from "./whatsapp-client";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "employee") redirect("/dashboard");

  return (
    <div className="mx-auto w-full max-w-screen-md px-4 py-6 sm:px-6 lg:px-8">
      <WhatsAppClient />
    </div>
  );
}
