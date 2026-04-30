"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/wizard/theme-toggle";
import { formatDate } from "@/lib/utils";

type Profile = {
  username: string;
  fullName: string;
  email: string | null;
  role: "admin" | "perito";
  createdAt: string;
  lastLoginAt: string | null;
};

export function CuentaClient({ user }: { user: Profile }) {
  const toast = useToast();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.show({
        title: "Las contraseñas no coinciden",
        variant: "danger",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Error");
      }
      toast.show({
        title: "Contraseña actualizada",
        description: "Vuelve a iniciar sesión.",
        variant: "success",
      });
      setTimeout(() => {
        window.location.href = "/login";
      }, 800);
    } catch (err) {
      toast.show({
        title: "No se pudo cambiar",
        description: err instanceof Error ? err.message : undefined,
        variant: "danger",
      });
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-3xl space-y-5 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Mi cuenta
        </h1>
        <p className="text-sm text-muted-foreground">
          Tu perfil y preferencias.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perfil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Nombre">{user.fullName}</Row>
          <Row label="Usuario">@{user.username}</Row>
          <Row label="Email">{user.email || "—"}</Row>
          <Row label="Rol">
            {user.role === "admin" ? "Administrador" : "Perito"}
          </Row>
          <Row label="Cuenta creada">{formatDate(user.createdAt)}</Row>
          <Row label="Último acceso">
            {user.lastLoginAt ? formatDate(user.lastLoginAt) : "—"}
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tema</CardTitle>
          <CardDescription>
            Claro, oscuro o alto contraste para uso al sol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cambiar contraseña</CardTitle>
          <CardDescription>
            Al cambiarla, se cierra esta sesión y deberás ingresar de nuevo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="np">Nueva contraseña</Label>
              <Input
                id="np"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np2">Confirmar</Label>
              <Input
                id="np2"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Guardando...
                </>
              ) : (
                "Cambiar contraseña"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
