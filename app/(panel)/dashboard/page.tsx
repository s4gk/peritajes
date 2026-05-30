import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/auth";
import {
  getGlobalKPIs,
  getKindBreakdownThisMonth,
  getMonthlyTrend,
  getNewOrgsThisMonth,
  getOrgsInAlert,
  getRecentActivity,
  getTopOrgsThisMonth,
} from "@/lib/server/admin-stats";
import { getInspectorStats } from "@/lib/server/org-stats";

import { AdminDashboard } from "./admin-dashboard";
import { DashboardClient } from "./dashboard-client";
import { InspectorStats } from "./inspector-stats";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "employee") redirect("/peritajes");

  if (user.role === "admin") {
    const [kpis, topOrgs, trend, kindBreakdown, alerts, newOrgs, recent] =
      await Promise.all([
        getGlobalKPIs(),
        getTopOrgsThisMonth(10),
        getMonthlyTrend(6),
        getKindBreakdownThisMonth(),
        getOrgsInAlert(),
        getNewOrgsThisMonth(),
        getRecentActivity(10),
      ]);
    return (
      <AdminDashboard
        kpis={kpis}
        topOrgs={topOrgs}
        trend={trend}
        kindBreakdown={kindBreakdown}
        alerts={alerts}
        newOrgs={newOrgs}
        recent={recent}
      />
    );
  }

  const inspectorStats = user.orgId
    ? await getInspectorStats(user.orgId).catch(() => [])
    : [];

  return (
    <div className="space-y-6">
      <DashboardClient />
      {inspectorStats.length > 1 && <InspectorStats stats={inspectorStats} />}
    </div>
  );
}
