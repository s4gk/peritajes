"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RecuperarForm() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // El endpoint responde 200 siempre, exista o no la cuenta, para no
    // convertirse en un oráculo de qué correos están registrados. Por eso acá
    // no hay rama de error: pase lo que pase mostramos la misma confirmación.
    try {
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* sin conexión: igual mostramos la confirmación, ver comentario arriba */
    }
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
          <MailCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Revisa tu correo</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Si <span className="font-medium text-foreground">{email}</span>{" "}
          corresponde a una cuenta activa, te acabamos de enviar un enlace para
          crear una contraseña nueva.
        </p>
        <div className="mt-6 space-y-3 rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            El enlace sirve <strong className="text-foreground">una sola vez</strong>{" "}
            y vence en 24 horas.
          </p>
          <p>
            ¿No te llegó? Revisa la carpeta de spam. Si en unos minutos sigue sin
            aparecer, pídele al dueño de tu empresa que te genere un enlace desde
            el panel.
          </p>
        </div>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link href="/login">Volver al inicio de sesión</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Recupera tu contraseña
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Escribe el correo con el que está registrada tu cuenta y te enviamos un
          enlace para crear una nueva.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="tu@correo.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Enviando…
            </>
          ) : (
            "Enviarme el enlace"
          )}
        </Button>
      </form>

      <Link
        href="/login"
        className="mt-8 flex items-center justify-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver al inicio de sesión
      </Link>
    </div>
  );
}
