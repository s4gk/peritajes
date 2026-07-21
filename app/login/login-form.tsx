"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wipeLocalUserData } from "@/lib/inspections-store";

// Guarda el id del último usuario que se autenticó en ESTE navegador. Si entra
// uno distinto, su estado local (drafts en IDB, cola de sync, cachés del SW)
// se limpia antes de continuar — así el trabajo pendiente de un perito que no
// cerró sesión NO termina sincronizándose bajo la cuenta del siguiente (era el
// origen de los peritajes que quedaban a nombre de otro).
const ACTIVE_UID_KEY = "perito_active_uid";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "No se pudo iniciar sesión");
        setBusy(false);
        return;
      }
      // Detectar cambio de usuario en este dispositivo. /api/auth/me ahora va
      // siempre a red (el SW no lo cachea), así que devuelve la identidad real
      // recién autenticada.
      try {
        const me = await fetch("/api/auth/me", { credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const newUid: string | null = me?.user?.id ?? null;
        let prevUid: string | null = null;
        try {
          prevUid = localStorage.getItem(ACTIVE_UID_KEY);
        } catch {
          /* localStorage no disponible */
        }
        if (newUid && prevUid && prevUid !== newUid) {
          // Usuario distinto al anterior → botar su estado local para no
          // heredar ni resincronizar nada suyo bajo esta cuenta.
          await wipeLocalUserData().catch(() => {});
        }
        if (newUid) {
          try {
            localStorage.setItem(ACTIVE_UID_KEY, newUid);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* best-effort: si algo falla, seguimos al panel igual */
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Inicia sesión</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Entra con tu usuario para acceder a tus peritajes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="username">Usuario</Label>
          <Input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={!!error}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Link
              href="/recuperar"
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ¿La olvidaste?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              className="pr-10"
            />
            {/* Ver la contraseña importa más de lo normal acá: se teclea en un
                celular, con guantes o a pleno sol, y un typo silencioso gasta
                un intento del rate limit (8 por 15 min). */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
              aria-pressed={showPassword}
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Ingresando…
            </>
          ) : (
            "Iniciar sesión"
          )}
        </Button>
      </form>

      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        ¿No tienes cuenta? Las crea el dueño de tu empresa desde el panel.
      </p>
    </div>
  );
}
