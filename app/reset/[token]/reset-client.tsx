"use client";

import * as React from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  token: string;
  fullName: string;
  username: string;
};

export function ResetClient({ token, fullName, username }: Props) {
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/reset/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "No se pudo restablecer la contraseña.");
        return;
      }
      setDone(true);
    } catch {
      setError("Error de red. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h1 className="text-lg font-semibold">Contraseña restablecida</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ya puedes ingresar con tu nueva contraseña.
          </p>
          <Button asChild className="mt-4 w-full">
            <a href="/login">Ir al login</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">Restablecer contraseña</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hola <span className="font-medium text-foreground">{fullName}</span> (
            <span className="font-mono">@{username}</span>). Elige una nueva
            contraseña para tu cuenta.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-pw">Nueva contraseña</Label>
          <Input
            id="new-pw"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-pw">Confirmar</Label>
          <Input
            id="confirm-pw"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            "Restablecer contraseña"
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Al cambiar la contraseña se cerrarán todas tus sesiones activas.
        </p>
      </form>
    </div>
  );
}
