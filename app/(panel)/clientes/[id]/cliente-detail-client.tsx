"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Crown,
  FileEdit,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Store,
  Trash2,
  TrendingUp,
  UserCheck,
  UserX,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";
import { PERITAJE_KINDS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

type MonthBucket = { key: string; label: string; count: number };
type RecentInspection = {
  id: string;
  plate: string | null;
  status: string;
  kind: string | null;
  createdAt: string;
  inspectorFullName: string | null;
};
type WaStatusLite = {
  status: string;
  phone: string | null;
  connectedAt: string | null;
  queueSize: number;
};

type Member = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: "admin" | "owner" | "employee";
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type OrgSummary = {
  id: string;
  name: string;
  ownerUserId: string | null;
  ownerUsername: string | null;
  ownerFullName: string | null;
  employeesCount: number;
  inspectionsThisMonth: number;
  active: boolean;
  createdAt: string;
};

type OrgStats = {
  thisMonth: {
    total: number;
    completed: number;
    draft: number;
    byKind: Record<string, number>;
  };
  allTime: {
    total: number;
    completed: number;
  };
};

const MONTH_LABEL = new Date().toLocaleDateString("es-CO", {
  month: "long",
  year: "numeric",
});

export function ClienteDetailClient({
  org,
  members,
  stats,
  trend,
  recentInspections,
  waStatus,
}: {
  org: OrgSummary;
  members: Member[];
  stats: OrgStats;
  trend: MonthBucket[];
  recentInspections: RecentInspection[];
  waStatus: WaStatusLite;
}) {
  const router = useRouter();
  const toast = useToast();
  const owner = members.find((m) => m.id === org.ownerUserId) ?? null;
  const employees = members.filter((m) => m.role === "employee");
  const [busy, setBusy] = React.useState<"suspend" | "activate" | "delete" | "impersonate" | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState("");

  async function impersonate(userId: string) {
    setBusy("impersonate");
    try {
      const res = await apiFetch(`/api/admin/impersonate/${userId}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo entrar como ese user",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: `Operando como ${data.target?.fullName ?? "el dueño"}`,
        description: "Recargando el panel con la nueva sesión.",
        variant: "success",
      });
      // Forzamos navegación dura para que el panel re-monte con la sesión
      // nueva (cookies y user actual cambiaron).
      window.location.href = "/dashboard";
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive() {
    const willActivate = !org.active;
    setBusy(willActivate ? "activate" : "suspend");
    try {
      const res = await apiFetch(`/api/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: willActivate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo cambiar el estado",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: willActivate ? "Empresa reactivada" : "Empresa suspendida",
        description: willActivate
          ? "Los usuarios pueden volver a entrar al panel."
          : "Los usuarios fueron deslogueados. No podrán entrar hasta que la reactives.",
        variant: "success",
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrg() {
    if (deleteConfirm.trim() !== org.name.trim()) {
      toast.show({
        title: "Confirmación incorrecta",
        description: "Escribe el nombre exacto de la empresa para confirmar.",
        variant: "warning",
      });
      return;
    }
    setBusy("delete");
    try {
      const res = await apiFetch(`/api/orgs/${org.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo eliminar",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: "Empresa eliminada",
        description: `${org.name} fue eliminada permanentemente.`,
        variant: "success",
      });
      router.push("/clientes");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a clientes
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {org.name}
            </h1>
            {!org.active && (
              <Badge variant="danger" className="text-[10px]">
                Suspendida
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Creada el {formatDate(org.createdAt)} · {employees.length} empleado
            {employees.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleActive}
            disabled={busy !== null}
            className="gap-1.5"
          >
            {busy === "suspend" || busy === "activate" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : org.active ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {org.active ? "Suspender" : "Reactivar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteOpen(true);
            }}
            disabled={busy !== null}
            className="gap-1.5 text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar
          </Button>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(o) => !busy && setDeleteOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar empresa</DialogTitle>
            <DialogDescription>
              Vas a eliminar <strong>{org.name}</strong> permanentemente: el
              owner, sus empleados, su configuración y la ficha de propietarios
              de la org. Los peritajes y citas quedarán como datos huérfanos
              accesibles solo para ti como admin (no se borran por trazabilidad).
              <br />
              <br />
              Escribe <code className="font-mono">{org.name}</code> para
              confirmar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delconfirm">Nombre de la empresa</Label>
            <Input
              id="delconfirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={org.name}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={busy === "delete"}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={deleteOrg}
              disabled={busy === "delete" || deleteConfirm.trim() !== org.name.trim()}
              className="gap-1.5 bg-danger text-danger-foreground hover:bg-danger/90"
            >
              {busy === "delete" && <Loader2 className="h-4 w-4 animate-spin" />}
              Eliminar permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Dueño
        </h2>
        <Card>
          <CardContent className="px-4 py-3">
            {owner ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-600" />
                    <span className="font-medium">{owner.fullName}</span>
                    {!owner.active && (
                      <Badge variant="danger" className="text-[10px]">
                        Inactivo
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    @{owner.username}
                    {owner.email ? ` · ${owner.email}` : ""}
                    {owner.lastLoginAt
                      ? ` · último acceso ${formatDate(owner.lastLoginAt)}`
                      : " · sin accesos aún"}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => impersonate(owner.id)}
                  disabled={busy === "impersonate"}
                  className="gap-1.5"
                  title="Entrar al panel viendo lo que ve el dueño (sesión de soporte)"
                >
                  {busy === "impersonate" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" />
                  )}
                  Entrar como
                </Button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Esta empresa no tiene dueño asignado.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Actividad — {MONTH_LABEL}
          </h2>
          <span className="text-xs text-muted-foreground">
            Histórico: {stats.allTime.total} peritaje
            {stats.allTime.total === 1 ? "" : "s"} · {stats.allTime.completed}{" "}
            finalizado{stats.allTime.completed === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={<ClipboardList className="h-4 w-4 text-muted-foreground" />}
            label="Creados este mes"
            value={stats.thisMonth.total}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4 text-success" />}
            label="Finalizados"
            value={stats.thisMonth.completed}
          />
          <StatCard
            icon={<FileEdit className="h-4 w-4 text-warning" />}
            label="En borrador"
            value={stats.thisMonth.draft}
          />
        </div>

        <Card>
          <CardContent className="px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Por tipo (este mes)
            </div>
            {stats.thisMonth.total === 0 ? (
              <div className="py-2 text-sm text-muted-foreground">
                Sin peritajes este mes.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(PERITAJE_KINDS) as Array<
                  keyof typeof PERITAJE_KINDS
                >).map((k) => {
                  const n = stats.thisMonth.byKind[k] ?? 0;
                  const pct =
                    stats.thisMonth.total > 0
                      ? Math.round((n / stats.thisMonth.total) * 100)
                      : 0;
                  return (
                    <div
                      key={k}
                      className="rounded-md border bg-muted/20 px-3 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">
                          {PERITAJE_KINDS[k].short}
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {n}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {pct}% del mes
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Trend 6 meses */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tendencia — últimos 6 meses
        </h2>
        <Card>
          <CardContent className="px-4 py-4">
            <MiniBarChart data={trend} />
          </CardContent>
        </Card>
      </section>

      {/* Estado WhatsApp + últimos peritajes en grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Últimos peritajes ({recentInspections.length})
          </h2>
          <Card>
            <CardContent className="p-0">
              {recentInspections.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Esta empresa no tiene peritajes todavía.
                </div>
              ) : (
                <ul className="divide-y">
                  {recentInspections.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/inspection/${r.id}`}
                        className="flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors hover:bg-muted/40"
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
                              {r.status === "completed"
                                ? "Finalizado"
                                : "Borrador"}
                            </Badge>
                            {r.kind &&
                              PERITAJE_KINDS[
                                r.kind as keyof typeof PERITAJE_KINDS
                              ] && (
                                <Badge
                                  variant="neutral"
                                  className="text-[10px]"
                                >
                                  {
                                    PERITAJE_KINDS[
                                      r.kind as keyof typeof PERITAJE_KINDS
                                    ].short
                                  }
                                </Badge>
                              )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {r.inspectorFullName ?? "sin perito asignado"}
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

        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            WhatsApp
          </h2>
          <Card>
            <CardContent className="px-4 py-4 space-y-2">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <WaStatusBadge status={waStatus.status} />
              </div>
              {waStatus.phone ? (
                <div className="text-sm font-medium tabular-nums">
                  {waStatus.phone}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Sin número vinculado
                </div>
              )}
              {waStatus.connectedAt && (
                <div className="text-xs text-muted-foreground">
                  Conectado desde {formatDate(waStatus.connectedAt)}
                </div>
              )}
              {waStatus.queueSize > 0 && (
                <div className="text-xs text-muted-foreground">
                  {waStatus.queueSize} mensaje
                  {waStatus.queueSize === 1 ? "" : "s"} pendiente
                  {waStatus.queueSize === 1 ? "" : "s"} en cola
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Empleados ({employees.length})
        </h2>
        <Card>
          <CardContent className="p-0">
            {employees.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Esta empresa todavía no tiene empleados. Los da de alta el
                dueño desde su propio panel.
              </div>
            ) : (
              <div className="divide-y">
                {employees.map((e) => (
                  <div
                    key={e.id}
                    className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{e.fullName}</span>
                        {e.active ? (
                          <Badge variant="neutral" className="gap-1 text-[10px]">
                            <UserCheck className="h-3 w-3" /> Activo
                          </Badge>
                        ) : (
                          <Badge variant="danger" className="gap-1 text-[10px]">
                            <UserX className="h-3 w-3" /> Inactivo
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        @{e.username}
                        {e.email ? ` · ${e.email}` : ""}
                        {" · creado "}
                        {formatDate(e.createdAt)}
                        {e.lastLoginAt
                          ? ` · último acceso ${formatDate(e.lastLoginAt)}`
                          : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function MiniBarChart({ data }: { data: MonthBucket[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-32 items-end gap-2 sm:gap-3">
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
                style={{
                  height: `${heightPct}%`,
                  minHeight: d.count > 0 ? 2 : 0,
                }}
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

function WaStatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "success" | "warning" | "danger" | "neutral"; label: string }> = {
    connected: { variant: "success", label: "Conectado" },
    connecting: { variant: "warning", label: "Conectando…" },
    qr: { variant: "warning", label: "Esperando QR" },
    error: { variant: "danger", label: "Error" },
    disconnected: { variant: "neutral", label: "Desconectado" },
  };
  const cfg = map[status] ?? { variant: "neutral" as const, label: status };
  return (
    <Badge variant={cfg.variant} className="text-[10px]">
      {cfg.label}
    </Badge>
  );
}
