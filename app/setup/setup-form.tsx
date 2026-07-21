"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

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

export function SetupForm() {
  const router = useRouter();
  const [fullName, setFullName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, username, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "No se pudo crear el administrador");
        setBusy(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <CardTitle>Configura el administrador</CardTitle>
        <CardDescription>
          Este es el primer ingreso. Crea tu cuenta de administrador para
          acceder al panel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Nombre completo</Label>
            <Input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="username">Usuario</Label>
            <Input
              id="username"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ej. admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              3-32 caracteres. Letras, números, punto, guion bajo o guion.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Es a donde llega el enlace si olvidas la contraseña.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
          </div>
          {error ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Creando...
              </>
            ) : (
              "Crear administrador y entrar"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
