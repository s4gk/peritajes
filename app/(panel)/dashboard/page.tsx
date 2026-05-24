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

import { AdminDashboard } from "./admin-dashboard";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // El admin (Vestel) ve la vista agregada cross-org. Owner/employee siguen
  // viendo el dashboard original orientado a sus propios peritajes.
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

  return <DashboardClient />;
}
