"use client";

import * as React from "react";
import { Filter, Loader2, RefreshCcw, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuditEntry = {
  id: string;
  userId: string | null;
  username: string | null;
  fullName: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
};

type Page = {
  entries: AuditEntry[];
  nextCursor: string | null;
};

type UserOption = { id: string; fullName: string; username: string };

type Props = {
  initialPage: Page;
  users: UserOption[];
  actions: string[];
};

type Filters = {
  userId: string;
  action: string;
  from: string;
  to: string;
};

const EMPTY: Filters = { userId: "", action: "", from: "", to: "" };

/**
 * Acciones que distinguimos visualmente con un tono — el resto cae a neutral.
 * Categorizamos por prefijo así no hay que mantener una lista exacta.
 */
function actionTone(action: string): "default" | "success" | "warning" | "danger" | "neutral" {
  if (action.endsWith(".deleted") || action.includes("failed")) return "danger";
  if (action.endsWith(".created")) return "success";
  if (action.endsWith(".completed")) return "success";
  if (action.includes("password")) return "warning";
  if (action.includes("login")) return "default";
  return "neutral";
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildQuery(filters: Filters, before: string | null): string {
  const sp = new URLSearchParams();
  if (filters.userId) sp.set("userId", filters.userId);
  if (filters.action) sp.set("action", filters.action);
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (before) sp.set("before", before);
  return sp.toString();
}

export function AuditoriaClient({ initialPage, users, actions }: Props) {
  const [entries, setEntries] = React.useState<AuditEntry[]>(initialPage.entries);
  const [cursor, setCursor] = React.useState<string | null>(initialPage.nextCursor);
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [busy, setBusy] = React.useState(false);

  async function load(opts: { reset?: boolean } = {}) {
    setBusy(true);
    try {
      const before = opts.reset ? null : cursor;
      const qs = buildQuery(filters, before);
      const res = await fetch(`/api/audit${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as Page;
      setEntries((prev) => (opts.reset ? json.entries : [...prev, ...json.entries]));
      setCursor(json.nextCursor);
    } finally {
      setBusy(false);
    }
  }

  function applyFilters() {
    load({ reset: true });
  }

  function clearFilters() {
    setFilters(EMPTY);
    // Cargamos sin filtros después de limpiar el state.
    setTimeout(() => load({ reset: true }), 0);
  }

  const userById = React.useMemo(() => {
    const m = new Map<string, UserOption>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Auditoría
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro inmutable de acciones del sistema: logins, peritajes, usuarios y datos.
          </p>
        </div>
        <Button onClick={() => load({ reset: true })} variant="outline" size="sm" disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-1.5 h-4 w-4" />
          )}
          Refrescar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-muted-foreground" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="audit-user">Usuario</Label>
              <Select
                value={filters.userId || "__all__"}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, userId: v === "__all__" ? "" : v }))
                }
              >
                <SelectTrigger id="audit-user">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName} ({u.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-action">Acción</Label>
              <Select
                value={filters.action || "__all__"}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, action: v === "__all__" ? "" : v }))
                }
              >
                <SelectTrigger id="audit-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas</SelectItem>
                  {actions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-from">Desde</Label>
              <Input
                id="audit-from"
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-to">Hasta</Label>
              <Input
                id="audit-to"
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={applyFilters} disabled={busy} size="sm">
              Aplicar
            </Button>
            <Button onClick={clearFilters} variant="ghost" size="sm" disabled={busy}>
              <X className="mr-1 h-3.5 w-3.5" />
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No hay registros que coincidan con los filtros.
            </div>
          ) : (
            <div className="divide-y">
              {entries.map((entry) => {
                const u = entry.userId ? userById.get(entry.userId) : null;
                const userLabel =
                  entry.fullName || u?.fullName || entry.username || u?.username || (entry.userId ? entry.userId : "—");
                return (
                  <div key={entry.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                    <div className="w-44 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {fmtDateTime(entry.createdAt)}
                    </div>
                    <Badge variant={actionTone(entry.action)} className="self-start text-[10px] font-mono">
                      {entry.action}
                    </Badge>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">{userLabel}</div>
                      {entry.detail && (
                        <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                          {entry.detail}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {cursor && (
        <div className="flex justify-center">
          <Button onClick={() => load()} variant="outline" disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
}
