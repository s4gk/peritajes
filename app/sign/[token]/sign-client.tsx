"use client";

import * as React from "react";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/shared/signature-pad";

type SessionContext = {
  plate?: string;
  make?: string;
  model?: string;
  year?: string;
  inspector?: string;
  owner?: string;
};

type SessionState = {
  status: "loading" | "ready" | "submitting" | "signed" | "expired" | "error";
  context: SessionContext;
  error?: string;
};

export function SignClientPage({ token }: { token: string }) {
  const [state, setState] = React.useState<SessionState>({
    status: "loading",
    context: {},
  });
  const [signature, setSignature] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sign/session/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setState({ status: "expired", context: {} });
          return;
        }
        if (!res.ok) {
          setState({ status: "error", context: {}, error: "No se pudo cargar la sesión." });
          return;
        }
        const data = (await res.json()) as {
          context: SessionContext;
          signature: string | null;
        };
        if (data.signature) {
          setState({ status: "signed", context: data.context });
        } else {
          setState({ status: "ready", context: data.context });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error", context: {}, error: "Sin conexión con el servidor." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit() {
    if (!signature) return;
    setState((s) => ({ ...s, status: "submitting" }));
    try {
      const res = await fetch(`/api/sign/session/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      if (res.status === 404) {
        setState((s) => ({ ...s, status: "expired" }));
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        setState((s) => ({
          ...s,
          status: "error",
          error: text || "No se pudo enviar la firma.",
        }));
        return;
      }
      setState((s) => ({ ...s, status: "signed" }));
    } catch {
      setState((s) => ({ ...s, status: "error", error: "Error de red." }));
    }
  }

  const ctx = state.context;

  return (
    <div className="min-h-[100svh] bg-muted/30 px-4 py-6">
      <div className="mx-auto max-w-md space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Firma del peritaje</h1>
        </div>

        {state.status === "loading" && (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Cargando sesión...
          </div>
        )}

        {state.status === "expired" && (
          <div className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div>
              <div className="font-semibold text-danger">Enlace no disponible</div>
              <p className="text-muted-foreground">
                La sesión de firma expiró o nunca existió. Pida al perito un nuevo QR.
              </p>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
            {state.error ?? "Error al procesar la firma."}
          </div>
        )}

        {(state.status === "ready" ||
          state.status === "submitting" ||
          state.status === "signed") && (
          <>
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Vehículo
                </div>
                <div className="text-base font-semibold">
                  {ctx.plate || "Sin placa"}
                  {ctx.make || ctx.model ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      · {[ctx.make, ctx.model, ctx.year].filter(Boolean).join(" ")}
                    </span>
                  ) : null}
                </div>
              </div>
              {ctx.inspector && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Perito inspector
                  </div>
                  <div className="text-sm">{ctx.inspector}</div>
                </div>
              )}
              {ctx.owner && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Propietario
                  </div>
                  <div className="text-sm">{ctx.owner}</div>
                </div>
              )}
            </div>

            {state.status === "signed" ? (
              <div className="flex items-start gap-3 rounded-lg border border-success/50 bg-success/10 p-4 text-sm">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <div>
                  <div className="font-semibold text-success">¡Firma recibida!</div>
                  <p className="text-muted-foreground">
                    Ya puede cerrar esta ventana. El perito verá su firma automáticamente.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Al firmar abajo, usted declara haber recibido el informe de peritaje
                    del vehículo descrito.
                  </p>
                  <SignaturePad
                    label="Firma del cliente"
                    hint={ctx.owner || undefined}
                    value={signature}
                    onChange={(v) => setSignature(v)}
                  />
                </div>

                <Button
                  size="lg"
                  className="h-12 w-full text-base"
                  disabled={!signature || state.status === "submitting"}
                  onClick={submit}
                >
                  {state.status === "submitting" ? "Enviando..." : "Enviar firma"}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
