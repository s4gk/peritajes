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
type MonthBucket = { key: string; label: string; total: number };
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
  riskLow: number;
  riskMedium: number;
  riskHigh: number;
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
  let riskLow = 0;
  let riskMedium = 0;
  let riskHigh = 0;

  const findingsAcc = new Map<string, FindingTotal>();
  const makesAcc = new Map<string, number>();
  const monthly = lastNMonths(6);
  const monthlyByKey = new Map(monthly.map((m) => [m.key, m]));

  for (const it of items) {
    const created = it.createdAt?.slice(0, 7);
    if (created === thisKey) thisMonth += 1;
    if (created === lastKey) lastMonth += 1;
    if (created) {
      const bucket = monthlyByKey.get(created);
      if (bucket) bucket.total += 1;
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

  const delta = lastMonth === 0 ? (thisMonth > 0 ? 1 : 0) : (thisMonth - lastMonth) / lastMonth;

  return {
    total: items.length,
    thisMonth,
    lastMonth,
    delta,
    riskLow,
    riskMedium,
    riskHigh,
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          label="Riesgo alto"
          value={stats.riskHigh}
          icon={AlertTriangle}
          tone={stats.riskHigh > 0 ? "danger" : "muted"}
          subtitle={
            stats.total > 0
              ? `${Math.round((stats.riskHigh / stats.total) * 100)}% del total`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Tendencia mensual</CardTitle>
          <CardDescription>Últimos 6 meses.</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlyTrend data={stats.monthly} />
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

function MonthlyTrend({ data }: { data: MonthBucket[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  if (data.length === 0) return null;

  const totalSeisMeses = data.reduce((a, m) => a + m.total, 0);

  // Escala mínima: nunca menos de 5, redondeado hacia arriba al siguiente
  // múltiplo de 5. Así un peritaje suelto en un mes no spike-ea al tope del
  // chart cuando los demás están en 0.
  const rawMax = Math.max(0, ...data.map((d) => d.total));
  const max = Math.max(5, Math.ceil(rawMax / 5) * 5);
  const W = 100;
  const H = 40;
  const padTop = 4;
  const padBottom = 2;
  const usable = H - padTop - padBottom;
  const stepX = data.length > 1 ? W / (data.length - 1) : 0;

  const points: [number, number][] = data.map((m, i) => [
    i * stepX,
    H - padBottom - (m.total / max) * usable,
  ]);

  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;

  const activeIdx = hover ?? data.length - 1;
  const active = data[activeIdx];
  const activeLeftPct = data.length > 1 ? (activeIdx / (data.length - 1)) * 100 : 50;
  const activeYPct = ((H - padBottom - (active.total / max) * usable) / H) * 100;

  // Delta vs mes anterior — se recalcula contra el mes activo (hovered o
  // actual). Si el mes anterior tiene 0, no calculamos % (división por cero),
  // pero igual reservamos el espacio para evitar saltos de layout al hover.
  const prevOfActive = activeIdx > 0 ? data[activeIdx - 1] : null;
  const activeDelta =
    prevOfActive && prevOfActive.total > 0
      ? (active.total - prevOfActive.total) / prevOfActive.total
      : prevOfActive && prevOfActive.total === 0 && active.total > 0
        ? 1
        : null;
  const positive = (activeDelta ?? 0) > 0;
  const neutral = activeDelta === null || Math.abs(activeDelta) < 0.001;
  const showDelta = !neutral && prevOfActive !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-semibold tabular-nums leading-none">
            {active.total}
          </span>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              peritajes · {active.label.toLowerCase()}
              {hover === null ? " (actual)" : ""}
            </span>
            <span
              aria-hidden={!showDelta}
              className={cn(
                "mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold",
                showDelta
                  ? positive
                    ? "text-success"
                    : "text-danger"
                  : "invisible text-muted-foreground",
              )}
            >
              {showDelta ? (
                positive ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )
              ) : (
                <ArrowUpRight className="h-3 w-3" />
              )}
              {showDelta
                ? `${Math.abs(Math.round((activeDelta ?? 0) * 100))}% vs ${prevOfActive!.label.toLowerCase()}`
                : "—"}
            </span>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{totalSeisMeses}</span> peritajes en
          los últimos 6 meses
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-32 w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="monthlyTrendArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#monthlyTrendArea)" className="text-primary" />
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="text-primary"
          />
        </svg>

        <div
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm transition-[left,top]"
          style={{ left: `${activeLeftPct}%`, top: `${activeYPct}%` }}
        />

        <div className="absolute inset-0 flex" onMouseLeave={() => setHover(null)}>
          {data.map((m, i) => (
            <button
              key={m.key}
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={(e) => {
                if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
                  setHover(null);
                }
              }}
              className="flex-1 cursor-default focus:outline-none"
              aria-label={`${m.label}: ${m.total} peritajes`}
            />
          ))}
        </div>
      </div>

      <div className="flex text-[11px] uppercase tracking-wide text-muted-foreground">
        {data.map((m, i) => (
          <span
            key={m.key}
            className={cn(
              "flex-1 text-center",
              i === activeIdx && "font-semibold text-foreground",
            )}
          >
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Interpolación cúbica monotónica (Fritsch-Carlson). A diferencia de
 * Catmull-Rom, garantiza que la curva no haga overshoot: si un punto es un
 * mínimo local (típicamente 0 entre dos valores altos), la tangente ahí es 0
 * y la curva no se mete por debajo. Esencial para sparkines de meses con
 * muchos ceros — antes la curva se dibujaba fuera del área y se veía maluco.
 */
function smoothPath(points: [number, number][]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0][0]} ${points[0][1]}`;

  const dx: number[] = new Array(n - 1);
  const slope: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    slope[i] = (points[i + 1][1] - points[i][1]) / dx[i];
  }

  const tangent: number[] = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0;
    } else {
      tangent[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const cp1x = points[i][0] + dx[i] / 3;
    const cp1y = points[i][1] + (tangent[i] * dx[i]) / 3;
    const cp2x = points[i + 1][0] - dx[i] / 3;
    const cp2y = points[i + 1][1] - (tangent[i + 1] * dx[i]) / 3;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${points[i + 1][0]} ${points[i + 1][1]}`;
  }
  return d;
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
