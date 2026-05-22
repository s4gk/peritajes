"use client";

import * as React from "react";
import {
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api-client";
import { formatDate } from "@/lib/utils";

type User = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: "admin" | "owner" | "employee";
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export function UsuariosClient({
  initialUsers,
  currentUserId,
  currentUserRole,
}: {
  initialUsers: User[];
  currentUserId: string;
  currentUserRole: "admin" | "owner" | "employee";
}) {
  const toast = useToast();
  const [users, setUsers] = React.useState<User[]>(initialUsers);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pwUserId, setPwUserId] = React.useState<string | null>(null);
  const [resetInfo, setResetInfo] = React.useState<{
    url: string;
    expiresAt: string;
    fullName: string;
  } | null>(null);

  async function handleGenerateResetLink(u: User) {
    const res = await apiFetch(`/api/users/${u.id}/reset-link`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.show({
        title: "No se pudo generar el link",
        description: data?.error,
        variant: "danger",
      });
      return;
    }
    setResetInfo({
      url: data.url,
      expiresAt: data.expiresAt,
      fullName: u.fullName,
    });
  }

  async function refresh() {
    const res = await fetch("/api/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
  }

  async function toggleActive(u: User) {
    const res = await apiFetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.show({
        title: "No se pudo actualizar",
        description: data?.error,
        variant: "danger",
      });
      return;
    }
    refresh();
  }

  async function handleDelete(u: User) {
    if (
      !confirm(
        `¿Eliminar a ${u.fullName} (@${u.username})? Esta acción no se puede deshacer.`,
      )
    )
      return;
    const res = await apiFetch(`/api/users/${u.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.show({
        title: "No se pudo eliminar",
        description: data?.error,
        variant: "danger",
      });
      return;
    }
    refresh();
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground">
            {users.length} usuario{users.length === 1 ? "" : "s"} registrado
            {users.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nuevo usuario
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {users.map((u) => {
              const isMe = u.id === currentUserId;
              return (
                <div
                  key={u.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{u.fullName}</span>
                      <Badge
                        variant={u.role === "admin" ? "warning" : "neutral"}
                        className="text-[10px]"
                      >
                        {u.role === "admin" ? "Admin" : "Dueño"}
                      </Badge>
                      {!u.active ? (
                        <Badge variant="danger" className="text-[10px]">
                          Inactivo
                        </Badge>
                      ) : null}
                      {isMe ? (
                        <span className="text-xs text-muted-foreground">
                          (tú)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      @{u.username}
                      {u.email ? ` · ${u.email}` : ""}
                      {" · creado "}
                      {formatDate(u.createdAt)}
                      {u.lastLoginAt
                        ? ` · último acceso ${formatDate(u.lastLoginAt)}`
                        : " · sin accesos aún"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPwUserId(u.id)}
                      className="gap-1.5"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Contraseña
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateResetLink(u)}
                      disabled={!u.active}
                      className="gap-1.5"
                      title="Generar un link de reset para enviarle al usuario"
                    >
                      <Link2 className="h-3.5 w-3.5" /> Link de reset
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActive(u)}
                      disabled={isMe}
                      className="gap-1.5"
                    >
                      {u.active ? (
                        <>
                          <UserX className="h-3.5 w-3.5" /> Desactivar
                        </>
                      ) : (
                        <>
                          <UserCheck className="h-3.5 w-3.5" /> Activar
                        </>
                      )}
                    </Button>
                    {currentUserRole === "admin" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(u)}
                        disabled={isMe}
                        className="gap-1.5 text-danger"
                        title="Eliminar usuario"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refresh}
        canCreateAdmin={currentUserRole === "admin"}
      />
      <PasswordDialog
        userId={pwUserId}
        onClose={() => setPwUserId(null)}
        onChanged={refresh}
      />
      <ResetLinkDialog info={resetInfo} onClose={() => setResetInfo(null)} />
    </div>
  );
}

function ResetLinkDialog({
  info,
  onClose,
}: {
  info: { url: string; expiresAt: string; fullName: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const expiresText = info
    ? new Date(info.expiresAt).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      toast.show({ title: "Link copiado", variant: "success" });
    } catch {
      toast.show({
        title: "No se pudo copiar",
        description: info.url,
        variant: "warning",
      });
    }
  }

  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link de reset generado</DialogTitle>
          <DialogDescription>
            Copialo y envialo a {info?.fullName} por el canal que prefieras
            (WhatsApp, llamada, presencial). El link es de un solo uso y vence el {expiresText}.
            Si se genera uno nuevo, el anterior se invalida automáticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="break-all font-mono text-xs">{info?.url}</div>
          </div>
          <Button onClick={copy} className="w-full gap-1.5">
            <Copy className="h-4 w-4" />
            Copiar link
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
  canCreateAdmin,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  canCreateAdmin: boolean;
}) {
  const toast = useToast();
  const [fullName, setFullName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"admin" | "owner" | "employee">("owner");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
      setRole("owner");
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, username, email, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error");
      toast.show({ title: "Usuario creado", variant: "success" });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.show({
        title: "No se pudo crear",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo usuario</DialogTitle>
          <DialogDescription>
            Crea una cuenta para que otra persona pueda ingresar al panel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cu-name">Nombre completo</Label>
            <Input
              id="cu-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cu-user">Usuario</Label>
              <Input
                id="cu-user"
                required
                autoCapitalize="none"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rol</Label>
              {canCreateAdmin ? (
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as "admin" | "owner" | "employee")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Dueño</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value="Dueño" disabled />
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-email">Email (opcional)</Label>
            <Input
              id="cu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-pw">Contraseña</Label>
            <Input
              id="cu-pw"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Mínimo 8 caracteres. El usuario podrá cambiarla luego.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Creando...
                </>
              ) : (
                "Crear"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  userId,
  onClose,
  onChanged,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (userId) setPassword("");
  }, [userId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error");
      toast.show({
        title: "Contraseña actualizada",
        description: "Las sesiones existentes fueron cerradas.",
        variant: "success",
      });
      onChanged();
      onClose();
    } catch (err) {
      toast.show({
        title: "No se pudo cambiar",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!userId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            Cerrará todas las sesiones activas del usuario.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">Nueva contraseña</Label>
            <Input
              id="pw-new"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Guardando...
                </>
              ) : (
                "Guardar"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
