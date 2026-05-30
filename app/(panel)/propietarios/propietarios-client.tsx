"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList, Phone, Search, User as UserIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";

type Owner = {
  id: string;
  fullName: string;
  document: string;
  phone: string;
  email: string;
  inspectionsCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export function PropietariosClient({
  initialOwners,
}: {
  initialOwners: Owner[];
}) {
  const [q, setQ] = React.useState("");
  const [owners, setOwners] = React.useState<Owner[]>(initialOwners);
  const [loading, setLoading] = React.useState(false);

  // Debounce de búsqueda — pega a /api/owners cuando el query cambia y
  // está vacío o tiene >= 2 chars (evitar fetch por cada tecla).
  React.useEffect(() => {
    const trimmed = q.trim();
    if (trimmed && trimmed.length < 2) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/owners?q=${encodeURIComponent(trimmed)}`,
        );
        if (res.ok) {
          const data = await res.json();
          setOwners(data.owners ?? []);
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Propietarios
        </h1>
        <p className="text-sm text-muted-foreground">
          Cartera de dueños de vehículos que han pasado por peritajes o citas.
          La ficha se actualiza automáticamente al guardar un peritaje.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, documento o teléfono…"
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {owners.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {loading
                ? "Buscando…"
                : q
                  ? "No hay resultados para esa búsqueda."
                  : "Aún no hay propietarios registrados. Aparecerán acá al guardar peritajes o crear citas."}
            </div>
          ) : (
            <div className="divide-y">
              {owners.map((o) => (
                <Link
                  key={o.id}
                  href={`/propietarios/${o.id}`}
                  className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {o.fullName || "(sin nombre)"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {o.document ? `CC ${o.document}` : "sin documento"}
                      {o.phone && (
                        <>
                          {" · "}
                          <Phone className="inline h-3 w-3" /> {o.phone}
                        </>
                      )}
                      {o.email ? ` · ${o.email}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span
                      className="inline-flex items-center gap-1"
                      title="Peritajes finalizados de este propietario"
                    >
                      <ClipboardList className="h-3.5 w-3.5" />
                      {o.inspectionsCount}
                    </span>
                    <span title={`Última actividad: ${o.lastSeenAt}`}>
                      visto {formatDate(o.lastSeenAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
