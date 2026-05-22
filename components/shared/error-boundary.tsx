"use client";

import * as React from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

type Props = {
  /** Texto principal del fallback. */
  title?: string;
  /** Texto secundario describiendo qué pasó. */
  description?: string;
  /** Si está set, lo llamamos al hacer "Reintentar" para que el caller resetee
   *  estado externo (p. ej. limpiar IDB corrupta). */
  onReset?: () => void;
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Atrapa errores que ocurren durante el render del subárbol y los muestra como
 * un panel con CTA para reintentar / recargar. Sin esto, un error en hidratar
 * la inspección desde IndexedDB tiraba la página entera a una pantalla blanca.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Mandamos a stderr para que el log del proceso (pm2) lo registre — en
    // dev igual aparece en consola del browser.
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || "Error desconocido";
    return (
      <div className="mx-auto my-12 max-w-md rounded-lg border border-danger/40 bg-danger/5 p-5 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" />
        <h2 className="text-base font-semibold">
          {this.props.title ?? "Algo salió mal"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {this.props.description ??
            "Ocurrió un error al cargar esta vista. Prueba reintentar; si persiste, recarga la página."}
        </p>
        <pre className="mt-3 max-h-32 overflow-auto rounded bg-card p-2 text-left text-[11px] leading-snug text-foreground">
          {message}
        </pre>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" onClick={this.reset}>
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={this.reload}>
            Recargar página
          </Button>
        </div>
      </div>
    );
  }
}
