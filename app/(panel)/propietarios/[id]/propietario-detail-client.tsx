"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardList,
  IdCard,
  Mail,
  MapPin,
  Phone,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PERITAJE_KINDS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

type Owner = {
  id: string;
  fullName: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  inspectionsCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

type InspectionLite = {
  id: string;
  plate: string | null;
  status: string;
  kind: string | null;
  createdAt: string;
  reportNumber: string | null;
  vehicleLabel: string;
  inspectorFullName: string | null;
};

export function PropietarioDetailClient({
  owner,
  inspections,
}: {
  owner: Owner;
  inspections: InspectionLite[];
}) {
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-5 py-6">
      <div>
        <Link
          href="/propietarios"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a propietarios
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <UserIcon className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {owner.fullName || "(sin nombre)"}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="px-4 py-4 space-y-3 text-sm">
            <DataLine
              icon={<IdCard className="h-4 w-4 text-muted-foreground" />}
              label="Documento"
              value={owner.document || "—"}
              mono
            />
            <DataLine
              icon={<Phone className="h-4 w-4 text-muted-foreground" />}
              label="Teléfono"
              value={owner.phone || "—"}
              mono
            />
            <DataLine
              icon={<Mail className="h-4 w-4 text-muted-foreground" />}
              label="Email"
              value={owner.email || "—"}
            />
            <DataLine
              icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
              label="Dirección"
              value={owner.address || "—"}
            />
            <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
              <div>Visto por primera vez: {formatDate(owner.firstSeenAt)}</div>
              <div>Última actividad: {formatDate(owner.lastSeenAt)}</div>
            </div>
            {owner.notes && (
              <div className="border-t pt-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Notas
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{owner.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-2 lg:col-span-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Historial de peritajes
            </h2>
            <Badge variant="neutral" className="text-[10px]">
              {inspections.length}
            </Badge>
          </div>
          <Card>
            <CardContent className="p-0">
              {inspections.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Este propietario aún no tiene peritajes ligados. Si esperabas
                  ver alguno, revisa que el documento o teléfono del peritaje
                  coincida con esta ficha.
                </div>
              ) : (
                <div className="divide-y">
                  {inspections.map((i) => (
                    <Link
                      key={i.id}
                      href={`/inspection/${i.id}`}
                      className="flex items-center justify-between gap-2  py-2 text-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium uppercase tracking-wide">
                            {i.plate ?? "sin placa"}
                          </span>
                          <Badge
                            variant={
                              i.status === "completed" ? "success" : "warning"
                            }
                            className="text-[10px]"
                          >
                            {i.status === "completed"
                              ? "Finalizado"
                              : "Borrador"}
                          </Badge>
                          {i.kind &&
                            PERITAJE_KINDS[
                              i.kind as keyof typeof PERITAJE_KINDS
                            ] && (
                              <Badge
                                variant="neutral"
                                className="text-[10px]"
                              >
                                {
                                  PERITAJE_KINDS[
                                    i.kind as keyof typeof PERITAJE_KINDS
                                  ].short
                                }
                              </Badge>
                            )}
                          {i.reportNumber && (
                            <span className="font-mono text-xs text-muted-foreground">
                              #{i.reportNumber}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {i.vehicleLabel || "vehículo sin datos"}
                          {i.inspectorFullName
                            ? ` · perito: ${i.inspectorFullName}`
                            : ""}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(i.createdAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DataLine({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className={mono ? "font-mono text-sm" : "text-sm"}>{value}</div>
      </div>
    </div>
  );
}
