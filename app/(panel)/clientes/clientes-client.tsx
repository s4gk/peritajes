"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList, LogIn, Loader2, Pause, Plus, Store, Users } from "lucide-react";

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
import { formatDate } from "@/lib/utils";

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

export function ClientesClient({ initialOrgs }: { initialOrgs: OrgSummary[] }) {
  const toast = useToast();
  const [orgs, setOrgs] = React.useState<OrgSummary[]>(initialOrgs);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [impersonatingId, setImpersonatingId] = React.useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/orgs");
    if (res.ok) {
      const data = await res.json();
      setOrgs(data.orgs ?? []);
    }
  }

  // Ingresar al panel del cliente: abrimos una sesión de impersonation sobre
  // su dueño. Al volcar la cookie, todo el panel (peritajes, vehículos,
  // propietarios, etc.) se reescopea a esa empresa. Funciona incluso si la
  // empresa está suspendida — útil para soporte/auditoría.
  async function ingresar(ownerUserId: string | null, orgName: string) {
    if (!ownerUserId) {
      toast.show({
        title: "Empresa sin dueño",
        description: "No tiene un dueño asignado al cual ingresar.",
        variant: "warning",
      });
      return;
    }
    setImpersonatingId(ownerUserId);
    try {
      const res = await apiFetch(`/api/admin/impersonate/${ownerUserId}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo ingresar",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: `Ingresando a ${orgName}`,
        description: "Verás el panel tal como lo ve el cliente.",
        variant: "success",
      });
      // Navegación dura: el panel re-monta con la sesión nueva.
      window.location.href = "/dashboard";
    } finally {
      setImpersonatingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            {orgs.length} empresa{orgs.length === 1 ? "" : "s"} cliente
            {orgs.length === 1 ? "" : "s"} del servicio.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nueva empresa
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {orgs.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Aún no hay empresas. Crea la primera con “Nueva empresa”.
            </div>
          ) : (
            <div className="divide-y">
              {orgs.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <Link
                    href={`/clientes/${o.id}`}
                    className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{o.name}</span>
                        {!o.active && (
                          <Badge variant="danger" className="gap-1 text-[10px]">
                            <Pause className="h-2.5 w-2.5" /> Suspendida
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Dueño:{" "}
                        {o.ownerFullName
                          ? `${o.ownerFullName} (@${o.ownerUsername})`
                          : "— sin asignar —"}
                        {" · creada "}
                        {formatDate(o.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground sm:mr-4">
                      <span
                        className="inline-flex items-center gap-1"
                        title="Empleados activos en la empresa"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {o.employeesCount} empleado
                        {o.employeesCount === 1 ? "" : "s"}
                      </span>
                      <span
                        className="inline-flex items-center gap-1"
                        title="Peritajes creados este mes"
                      >
                        <ClipboardList className="h-3.5 w-3.5" />
                        {o.inspectionsThisMonth} este mes
                      </span>
                    </div>
                  </Link>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => ingresar(o.ownerUserId, o.name)}
                    disabled={impersonatingId !== null || !o.ownerUserId}
                    className="shrink-0 gap-1.5"
                    title={
                      o.ownerUserId
                        ? `Ingresar al panel de ${o.name}`
                        : "Sin dueño asignado"
                    }
                  >
                    {impersonatingId === o.ownerUserId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogIn className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden sm:inline">Ingresar</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateOrgDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refresh}
      />
    </div>
  );
}

function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [orgName, setOrgName] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setOrgName("");
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgName,
          owner: {
            username,
            password,
            fullName,
            email: email || null,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({
          title: "No se pudo crear la empresa",
          description: data?.error,
          variant: "danger",
        });
        return;
      }
      toast.show({
        title: "Empresa creada",
        description: `${orgName} dada de alta con su dueño @${username}.`,
        variant: "success",
      });
      onOpenChange(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva empresa cliente</DialogTitle>
          <DialogDescription>
            Crea la empresa y su dueño en un solo paso. El dueño podrá entrar
            con estas credenciales y gestionar sus propios empleados desde su
            panel.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">Nombre de la empresa</Label>
            <Input
              id="orgName"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Peritajes del Llano"
              required
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dueño del negocio
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Juan Pérez"
                required
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="juan.perez"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email (opcional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="juan@empresa.co"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña inicial</Label>
              <Input
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mínimo 8 caracteres"
                minLength={8}
                required
              />
              <p className="text-xs text-muted-foreground">
                El dueño la podrá cambiar desde Mi cuenta una vez entre.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear empresa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
