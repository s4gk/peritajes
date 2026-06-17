import { notFound, redirect } from "next/navigation";

import {
  getOrgMonthlyTrend,
  listRecentInspectionsForOrg,
} from "@/lib/server/admin-stats";
import { getCurrentUser, listUsersFor } from "@/lib/server/auth";
import { getOrgStats, getOrgSummary } from "@/lib/server/orgs";
import { getMetaStatus } from "@/lib/server/whatsapp-meta";

import { ClienteDetailClient } from "./cliente-detail-client";

export const dynamic = "force-dynamic";

export default async function ClienteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  const org = await getOrgSummary(params.id);
  if (!org) notFound();

  const [allUsers, stats, trend, recentInspections] = await Promise.all([
    listUsersFor(user),
    getOrgStats(org.id),
    getOrgMonthlyTrend(org.id, 6),
    listRecentInspectionsForOrg(org.id, 15),
  ]);
  const members = allUsers.filter((u) => u.orgId === org.id);
  const waStatus = getMetaStatus();

  return (
    <ClienteDetailClient
      org={org}
      members={members}
      stats={stats}
      trend={trend}
      recentInspections={recentInspections}
      waStatus={{
        status: waStatus.status,
        phone: waStatus.phone,
        connectedAt: waStatus.connectedAt
          ? new Date(waStatus.connectedAt).toISOString()
          : null,
        queueSize: waStatus.queueSize,
      }}
    />
  );
}
