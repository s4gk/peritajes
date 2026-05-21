"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  Plus,
  Share2,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { initStore, listInspections } from "@/lib/inspections-store";
import { analyze, riskTone } from "@/lib/rules-engine";
import type { StoredInspection } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type FindingTotal = { label: string; count: number; tone: "warning" | "critical" | "info" };
type MakeTotal = { make: string; count: number };
type MonthBucket = { key: string; label: string; total: number; completed: number };
type ShareStats = {
  totalLinks: number;
  totalAccesses: number;
  accessedLinks: number;
  liveLinks: number;
  inspectionsShared: number;
};

type Stats = {
  total: number;
  thisMonth: number;
  lastMonth: number;
  delta: number;
  completed: number;
  drafts: number;
  riskLow: number;
  riskMedium: number;
  riskHigh: number;
  avgCompletionHours: number | null;
  completionRate: number; // 0..1
  topFindings: FindingTotal[];
  topMakes: MakeTotal[];
  monthly: MonthBucket[];
  recent: StoredInspection[];
};

const MONTH_NAMES_ES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastNMonths(n: number): MonthBucket[] {
  const out: MonthBucket[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: monthKey(d),
      label: MONTH_NAMES_ES[d.getMonth()],
      total: 0,
      completed: 0,
    });
  }
  return out;
}

function compute(items: StoredInspection[]): Stats {
  const now = new Date();
  const thisKey = monthKey(now);
  const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastKey = monthKey(lastDate);

  let thisMonth = 0;
  let lastMonth = 0;
  let completed = 0;
  let drafts = 0;
  let riskLow = 0;
  let riskMedium = 0;
  let riskHigh = 0;

  const findingsAcc = new Map<string, FindingTotal>();
  const makesAcc = new Map<string, number>();
  const monthly = lastNMonths(6);
  const monthlyByKey = new Map(monthly.map((m) => [m.key, m]));
  const completionMs: number[] = [];

  for (const it of items) {
    const created = it.createdAt?.slice(0, 7);
    if (created === thisKey) thisMonth += 1;
    if (created === lastKey) lastMonth += 1;
    if (created) {
      const bucket = monthlyByKey.get(created);
      if (bucket) {
        bucket.total += 1;
        if (it.data.status === "completed") bucket.completed += 1;
      }
    }
    if (it.data.status === "completed") {
      completed += 1;
      if (it.data.completedAt && it.createdAt) {
        const ms = new Date(it.data.completedAt).getTime() - new Date(it.createdAt).getTime();
        if (ms > 0 && ms < 1000 * 60 * 60 * 24 * 30) completionMs.push(ms);
      }
    } else {
      drafts += 1;
    }

    const r = analyze(it.data);
    if (r.level === "low") riskLow += 1;
    else if (r.level === "medium") riskMedium += 1;
    else riskHigh += 1;

    for (const f of r.findings) {
      const key = `${f.section}|${f.item}`;
      const existing = findingsAcc.get(key);
      if (existing) existing.count += 1;
      else
        findingsAcc.set(key, {
          label: `${f.item} · ${f.section}`,
          count: 1,
          tone: f.level,
        });
    }

    const make = it.data.vehicle.make?.trim();
    if (make) makesAcc.set(make, (makesAcc.get(make) ?? 0) + 1);
  }

  const topFindings = Array.from(findingsAcc.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const topMakes = Array.from(makesAcc.entries())
    .map(([make, count]) => ({ make, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const avgCompletionHours =
    completionMs.length > 0
      ? completionMs.reduce((a, b) => a + b, 0) / completionMs.length / (1000 * 60 * 60)
      : null;
  const delta = lastMonth === 0 ? (thisMonth > 0 ? 1 : 0) : (thisMonth - lastMonth) / lastMonth;
  const completionRate = items.length === 0 ? 0 : completed / items.length;

  return {
    total: items.length,
    thisMonth,
    lastMonth,
    delta,
    completed,
    drafts,
    riskLow,
    riskMedium,
    riskHigh,
    avgCompletionHours,
    completionRate,
    topFindings,
    topMakes,
    monthly,
    recent: items.slice(0, 5),
  };
}

export function DashboardClient() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [shareStats, setShareStats] = React.useState<ShareStats | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await initStore();
      if (cancelled) return;
      setStats(compute(listInspections()));
      try {
        const res = await fetch("/api/share/stats", { cache: "no-store" });
        if (!cancelled && res.ok) {
          setShareStats((await res.json()) as ShareStats);
        }
      } catch {
        // No bloquea el dashboard si el endpoint falla.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // El refresh del server corre en background — cuando termina, recomputamos
  // stats con los datos canónicos para no quedarnos con la foto vieja de IDB.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onRefresh = () => setStats(compute(listInspections()));
    window.addEventListener("perito:store-refreshed", onRefresh);
    return () => window.removeEventListener("perito:store-refreshed", onRefresh);
  }, []);

  if (!stats) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando dashboard...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Control de tu actividad de peritajes.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/intake">
            <Plus className="mr-1 h-4 w-4" /> Nuevo peritaje
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Este mes"
          value={stats.thisMonth}
          delta={stats.delta}
          icon={TrendingUp}
          tone="primary"
        />
        <HeroStat
          label="Total acumulado"
          value={stats.total}
          icon={ClipboardList}
          tone="primary"
        />
        <HeroStat
          label="Finalizados"
          value={stats.completed}
          icon={CheckCircle2}
          tone="success"
          subtitle={`${Math.round(stats.completionRate * 100)}% del total`}
        />
        <HeroStat
          label="En borrador"
          value={stats.drafts}
          icon={Clock}
          tone="muted"
          subtitle={
            stats.avgCompletionHours !== null
              ? `Cierre promedio ${formatHours(stats.avgCompletionHours)}`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Tendencia mensual</CardTitle>
            <CardDescription>Últimos 6 meses · finalizados vs borrador.</CardDescription>
          </div>
          <span className="text-xs text-muted-foreground">
            {stats.monthly.reduce((a, m) => a + m.total, 0)} peritajes
          </span>
        </CardHeader>
        <CardContent>
          <MonthlyBars data={stats.monthly} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución de riesgo</CardTitle>
            <CardDescription>Según motor de reglas.</CardDescription>
          </CardHeader>
          <CardContent>
            <RiskDistribution
              low={stats.riskLow}
              medium={stats.riskMedium}
              high={stats.riskHigh}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hallazgos más frecuentes</CardTitle>
            <CardDescription>Top tipos en todos los peritajes.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.topFindings.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aún no hay hallazgos registrados.
              </div>
            ) : (
              <ul className="space-y-2">
                {stats.topFindings.map((f) => (
                  <li key={f.label} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "inline-block h-2 w-2 shrink-0 rounded-full",
                        f.tone === "critical"
                          ? "bg-danger"
                          : f.tone === "warning"
                            ? "bg-warning"
                            : "bg-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {f.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Marcas peritadas</CardTitle>
            <CardDescription>Top 5 por volumen.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.topMakes.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Sin datos suficientes.
              </div>
            ) : (
              <ul className="space-y-2">
                {stats.topMakes.map((m) => {
                  const pct = stats.total === 0 ? 0 : (m.count / stats.total) * 100;
                  return (
                    <li key={m.make} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{m.make}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {m.count} · {Math.round(pct)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Engagement de clientes</CardTitle>
            </div>
            <CardDescription>Aperturas de los enlaces compartidos.</CardDescription>
          </CardHeader>
          <CardContent>
            {!shareStats ? (
              <div className="text-sm text-muted-foreground">Cargando...</div>
            ) : shareStats.totalLinks === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aún no compartiste ningún peritaje. Generá un link en el resumen.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="Aperturas totales" value={shareStats.totalAccesses} icon={Eye} />
                  <MiniStat label="Links emitidos" value={shareStats.totalLinks} icon={Share2} />
                </div>
                <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Links activos</span>
                    <span className="font-medium text-foreground">{shareStats.liveLinks}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Peritajes únicos compartidos</span>
                    <span className="font-medium text-foreground">
                      {shareStats.inspectionsShared}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Tasa de apertura</span>
                    <span className="font-medium text-foreground">
                      {shareStats.totalLinks === 0
                        ? "—"
                        : `${Math.round((shareStats.accessedLinks / shareStats.totalLinks) * 100)}%`}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Peritajes recientes</CardTitle>
              <CardDescription>Últimos 5 actualizados.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/peritajes">Ver todos</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {stats.recent.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="divide-y">
                {stats.recent.map((it) => (
                  <RecentRow key={it.id} item={it} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function HeroStat({
  label,
  value,
  delta,
  subtitle,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  delta?: number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "primary" | "success" | "muted" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "danger"
        ? "bg-danger/10 text-danger"
        : tone === "muted"
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary";

  const showDelta = delta !== undefined && Number.isFinite(delta);
  const positive = (delta ?? 0) > 0;
  const neutral = Math.abs(delta ?? 0) < 0.001;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-5">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
            {showDelta && !neutral && (
              <span
                className={cn(
                  "inline-flex items-center text-xs font-semibold",
                  positive ? "text-success" : "text-danger",
                )}
              >
                {positive ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {Math.abs(Math.round((delta ?? 0) * 100))}%
              </span>
            )}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${toneClass}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MonthlyBars({ data }: { data: MonthBucket[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 sm:gap-3">
        {data.map((m) => {
          const pct = (m.total / max) * 100;
          const completedPct = m.total === 0 ? 0 : (m.completed / m.total) * 100;
          return (
            <div key={m.key} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="text-[10px] font-mono tabular-nums text-muted-foreground">
                {m.total}
              </div>
              <div className="relative h-32 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className="absolute bottom-0 left-0 right-0 bg-primary/30 transition-all"
                  style={{ height: `${pct}%` }}
                />
                <div
                  className="absolute bottom-0 left-0 right-0 bg-primary transition-all"
                  style={{ height: `${(pct * completedPct) / 100}%` }}
                  title={`${m.completed} finalizados`}
                />
              </div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {m.label}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary" />
          Finalizados
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary/30" />
          En borrador
        </span>
      </div>
    </div>
  );
}

function RiskDistribution({
  low,
  medium,
  high,
}: {
  low: number;
  medium: number;
  high: number;
}) {
  const total = Math.max(1, low + medium + high);
  const segs = [
    { label: "Bajo", value: low, className: "bg-success" },
    { label: "Medio", value: medium, className: "bg-warning" },
    { label: "Alto", value: high, className: "bg-danger" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segs.map((s) => (
          <div
            key={s.label}
            className={s.className}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {segs.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.className}`} />
              {s.label}
            </span>
            <span className="font-medium">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentRow({ item }: { item: StoredInspection }) {
  const v = item.data.vehicle;
  const report = analyze(item.data);
  const tone = riskTone(report.level);
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <Link
        href={`/inspection/${item.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ClipboardList className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{v.plate || "Sin placa"}</span>
            <Badge variant={tone} className="text-[10px]">
              {report.level === "low" ? "Bajo" : report.level === "medium" ? "Medio" : "Alto"}
            </Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {v.make && v.model
              ? `${v.make} ${v.model}${v.year ? ` · ${v.year}` : ""}`
              : "Datos incompletos"}
            {" · "}
            {formatDate(item.updatedAt)}
          </div>
        </div>
      </Link>
      {item.data.status === "completed" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="text-sm text-muted-foreground">
        Aún no hay peritajes. Crea el primero para ver datos aquí.
      </div>
      <Button asChild size="sm">
        <Link href="/intake">
          <Plus className="mr-1 h-4 w-4" /> Nuevo peritaje
        </Link>
      </Button>
    </div>
  );
}
