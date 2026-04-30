"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Plus,
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
import { formatDate } from "@/lib/utils";

type Stats = {
  total: number;
  thisMonth: number;
  completed: number;
  drafts: number;
  riskLow: number;
  riskMedium: number;
  riskHigh: number;
  recent: StoredInspection[];
};

function compute(items: StoredInspection[]): Stats {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let thisMonth = 0;
  let completed = 0;
  let drafts = 0;
  let riskLow = 0;
  let riskMedium = 0;
  let riskHigh = 0;
  for (const it of items) {
    if (it.createdAt?.startsWith(monthKey)) thisMonth += 1;
    if (it.data.status === "completed") completed += 1;
    else drafts += 1;
    const r = analyze(it.data);
    if (r.level === "low") riskLow += 1;
    else if (r.level === "medium") riskMedium += 1;
    else riskHigh += 1;
  }
  return {
    total: items.length,
    thisMonth,
    completed,
    drafts,
    riskLow,
    riskMedium,
    riskHigh,
    recent: items.slice(0, 5),
  };
}

export function DashboardClient() {
  const router = useRouter();
  const [stats, setStats] = React.useState<Stats | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await initStore();
      if (cancelled) return;
      setStats(compute(listInspections()));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Cargando dashboard...
      </div>
    );
  }

  return (
    <div className="container max-w-6xl space-y-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Resumen de tu actividad de peritajes.
          </p>
        </div>
        <Button onClick={() => router.push("/intake")} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nuevo peritaje
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total"
          value={stats.total}
          icon={ClipboardList}
          tone="primary"
        />
        <StatCard
          label="Este mes"
          value={stats.thisMonth}
          icon={TrendingUp}
          tone="primary"
        />
        <StatCard
          label="Finalizados"
          value={stats.completed}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Borradores"
          value={stats.drafts}
          icon={Clock}
          tone="muted"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución de riesgo</CardTitle>
            <CardDescription>
              Clasificación según el motor de reglas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RiskDistribution
              low={stats.riskLow}
              medium={stats.riskMedium}
              high={stats.riskHigh}
            />
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

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
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
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-5">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
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
          <li
            key={s.label}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${s.className}`}
              />
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
            <span className="truncate text-sm font-medium">
              {v.plate || "Sin placa"}
            </span>
            <Badge variant={tone} className="text-[10px]">
              {report.level === "low"
                ? "Bajo"
                : report.level === "medium"
                  ? "Medio"
                  : "Alto"}
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
