import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";
import {
  getVehicleOwner,
  listOwnerInspections,
} from "@/lib/server/vehicle-owners";

import { PropietarioDetailClient } from "./propietario-detail-client";

export const dynamic = "force-dynamic";

export default async function PropietarioDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const owner = await getVehicleOwner(user, params.id);
  if (!owner) notFound();

  const inspections = await listOwnerInspections(owner, 50);
  return <PropietarioDetailClient owner={owner} inspections={inspections} />;
}
