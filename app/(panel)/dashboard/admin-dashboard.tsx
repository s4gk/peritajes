import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Crown,
  FileEdit,
  Minus,
  Sparkles,
  Store,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PERITAJE_KINDS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

import type {
  GlobalKPIs,
  MonthBucket,
  NewOrg,
  OrgAlert,
  RecentInspection,
  TopOrg,
} from "@/lib/server/admin-stats";

const MONTH_LABEL = new Date().toLocaleDateString("es-CO", {
  month: "long",
  year: "numeric",
});

export function AdminDashboard({
  kpis,
  topOrgs,
  trend,
  kindBreakdown,
  alerts,
  newOrgs,
  recent,
}: {
  kpis: GlobalKPIs;
  topOrgs: TopOrg[];
  trend: MonthBucket[];
  kindBreakdown: Record<string, number>;
  alerts: OrgAlert[];
  newOrgs: NewOrg[];
  recent: RecentInspection[];
}) {
  const breakdownTotal = Object.values(kindBreakdown).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-6 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Panel de administración
        </h1>
        <p className="text-sm text-muted-foreground">
          Vista agregada de todos los clientes — {MONTH_LABEL}
        </p>
      </div>

      {/* KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
          label="Empresas activas"
          value={kpis.activeOrgs}
          hint={`de ${kpis.totalOrgs} totales`}
        />
        <KpiCard
          icon={<ClipboardList className="h-4 w-4 text-muted-foreground" />}
          label="Peritajes este mes"
          value={kpis.inspectionsThisMonth}
          delta={kpis.deltaPct}
          hint={
            kpis.inspectionsPrevMonth > 0
              ? `${kpis.inspectionsPrevMonth} el mes pasado`
              : "primer mes con datos"
          }
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          label="Finalizados"
          value={kpis.completedThisMonth}
          hint={
            kpis.inspectionsThisMonth > 0
              ? `${Math.round(
                  (kpis.completedThisMonth / kpis.inspectionsThisMonth) * 100,
                )}% del mes`
              : "—"
          }
        />
        <KpiCard
          icon={<FileEdit className="h-4 w-4 text-warning" />}
          label="En borrador"
          value={kpis.draftThisMonth}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Tendencia 6 meses */}
        <Card className="lg:col-span-2">
          <CardContent className="px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Peritajes por mes
                </div>
                <p className="text-xs text-muted-foreground">
                  Últimos 6 meses (global)
                </p>
              </div>
            </div>
            <BarChart data={trend} />
          </CardContent>
        </Card>

        {/* Breakdown por tipo */}
        <Card>
          <CardContent className="px-4 py-4">
            <div className="mb-3 text-sm font-medium">Por tipo (este mes)</div>
            {breakdownTotal === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Sin peritajes este mes.
              </div>
            ) : (
              <div className="space-y-3">
                {(Object.keys(PERITAJE_KINDS) as Array<
                  keyof typeof PERITAJE_KINDS
                >).map((k) => {
                  const n = kindBreakdown[k] ?? 0;
                  const pct =
                    breakdownTotal > 0
                      ? Math.round((n / breakdownTotal) * 100)
                      : 0;
                  return (
                    <div key={k}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span>{PERITAJE_KINDS[k].short}</span>
                        <span className="tabular-nums">
                          {n}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({pct}%)
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top clientes */}
        <Card>
          <CardContent className="px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">
                Top clientes por actividad
              </div>
              <Link
                href="/clientes"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Ver todos →
              </Link>
            </div>
            {topOrgs.every((o) => o.count === 0) ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aún nadie ha hecho peritajes este mes.
              </div>
            ) : (
              <ol className="space-y-1.5">
                {topOrgs.map((o, idx) => (
                  <li key={o.id}>
                    <Link
                      href={`/clientes/${o.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {idx + 1}
                        </span>
                        <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{o.name}</span>
                        {o.ownerFullName && (
                          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                            · {o.ownerFullName}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 tabular-nums font-semibold">
                        {o.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Clientes en alerta */}
        <Card>
          <CardContent className="px-4 py-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Sin actividad este mes
              <Badge variant="neutral" className="text-[10px]">
                {alerts.length}
              </Badge>
            </div>
            {alerts.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Todas las empresas tuvieron al menos un peritaje. 🎯
              </div>
            ) : (
              <ul className="divide-y">
                {alerts.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/clientes/${a.id}`}
                      className="flex flex-col gap-0.5 px-2 py-2 text-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        <Store className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{a.name}</span>
                      </div>
                      <div className="pl-5 text-xs text-muted-foreground">
                        {a.ownerFullName ? `${a.ownerFullName} · ` : ""}
                        {a.lastInspectionAt
                          ? `último peritaje ${formatDate(a.lastInspectionAt)}`
                          : "nunca ha creado peritajes"}
                      </div>
                    </Link>
                  </li>
                ))}
                {alerts.length > 8 && (
                  <li className="px-2 pt-2 text-xs text-muted-foreground">
                    + {alerts.length - 8} más…
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Nuevos clientes del mes */}
        <Card>
          <CardContent className="px-4 py-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-success" />
              Nuevos clientes del mes
              <Badge variant="neutral" className="text-[10px]">
                {newOrgs.length}
              </Badge>
            </div>
            {newOrgs.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Sin nuevas empresas este mes.
              </div>
            ) : (
              <ul className="divide-y">
                {newOrgs.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/clientes/${o.id}`}
                      className="flex items-center justify-between gap-2 px-2 py-2 text-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{o.name}</div>
                          {o.ownerFullName && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Crown className="h-3 w-3" /> {o.ownerFullName}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(o.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Actividad reciente */}
        <Card>
          <CardContent className="px-4 py-4">
            <div className="mb-3 text-sm font-medium">Actividad reciente</div>
            {recent.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aún no hay actividad.
              </div>
            ) : (
              <ul className="divide-y">
                {recent.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/inspection/${r.id}`}
                      className="flex items-center justify-between gap-2 px-2 py-2 text-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium uppercase tracking-wide">
                            {r.plate ?? "sin placa"}
                          </span>
                          <Badge
                            variant={
                              r.status === "completed" ? "success" : "warning"
                            }
                            className="text-[10px]"
                          >
                            {r.status === "completed" ? "Finalizado" : "Borrador"}
                          </Badge>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.orgName ?? "sin org"}
                          {r.inspectorFullName
                            ? ` · ${r.inspectorFullName}`
                            : ""}
                          {r.kind && PERITAJE_KINDS[r.kind as keyof typeof PERITAJE_KINDS]
                            ? ` · ${PERITAJE_KINDS[r.kind as keyof typeof PERITAJE_KINDS].short}`
                            : ""}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(r.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  delta?: number | null;
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {delta !== undefined && delta !== null && (
            <DeltaPill pct={delta} />
          )}
        </div>
        {hint && (
          <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

function DeltaPill({ pct }: { pct: number }) {
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  const cls =
    pct > 0
      ? "text-success"
      : pct < 0
        ? "text-danger"
        : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${cls}`}>
      <Icon className="h-3 w-3" />
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

/** Bar chart minimalista en divs. Sin dependencias extra. */
function BarChart({ data }: { data: MonthBucket[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-40 items-end gap-2 sm:gap-3">
      {data.map((d) => {
        const heightPct = (d.count / max) * 100;
        return (
          <div
            key={d.key}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${d.label}: ${d.count} peritajes`}
          >
            <div className="flex h-full w-full items-end">
              <div
                className="w-full rounded-t bg-primary/80 transition-colors hover:bg-primary"
                style={{ height: `${heightPct}%`, minHeight: d.count > 0 ? 2 : 0 }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground">{d.label}</div>
            <div className="text-xs font-medium tabular-nums">{d.count}</div>
          </div>
        );
      })}
    </div>
  );
}
