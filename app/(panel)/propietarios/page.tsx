import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";
import { listVehicleOwners } from "@/lib/server/vehicle-owners";

import { PropietariosClient } from "./propietarios-client";

export const dynamic = "force-dynamic";

export default async function PropietariosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Todos los roles pueden ver la cartera. listVehicleOwners ya filtra por
  // org del actor (admin = todos, owner+employee = los de su org).
  const owners = await listVehicleOwners(user);
  return <PropietariosClient initialOwners={owners} />;
}
