import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";
import { listAppointmentsFor } from "@/lib/server/appointments";

import { AgendaClient } from "./agenda-client";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const appointments = await listAppointmentsFor(user);

  return (
    <div className="mx-auto w-full max-w-screen-2xl py-6">
      <AgendaClient
        initialAppointments={appointments}
        currentUser={{ id: user.id, role: user.role }}
      />
    </div>
  );
}
