"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Search } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createInspection, initStore } from "@/lib/inspections-store";
import type { VehicleInfo } from "@/lib/types";
import type { VerifikSnapshot } from "@/lib/verifik/types";

const DOCUMENT_TYPES = [
  { value: "CC", label: "Cédula de ciudadanía" },
  { value: "CE", label: "Cédula de extranjería" },
  { value: "TI", label: "Tarjeta de identidad" },
  { value: "PA", label: "Pasaporte" },
  { value: "NIT", label: "NIT" },
];

type LookupResponse = {
  configured?: boolean;
  message?: string;
  result?: Partial<VehicleInfo>;
  snapshot?: VerifikSnapshot;
  warnings?: string[];
  error?: string;
};

export default function IntakePage() {
  const router = useRouter();
  const toast = useToast();

  const [documentType, setDocumentType] = React.useState("CC");
  const [documentNumber, setDocumentNumber] = React.useState("");
  const [plate, setPlate] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    void initStore();
  }, []);

  const canSubmit =
    !!documentType.trim() && !!documentNumber.trim() && plate.trim().length >= 5;

  async function startWithLookup() {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        documentType,
        documentNumber: documentNumber.trim(),
        plate: plate.trim().toUpperCase(),
      });
      const res = await fetch(`/api/plate-lookup?${params.toString()}`);
      const body = (await res.json().catch(() => ({}))) as LookupResponse;

      if (res.status === 501) {
        toast.show({
          title: "Verifik no está configurado",
          description:
            body.message ?? "Falta VERIFIK_TOKEN en el servidor. Inicia manual mientras se configura.",
          variant: "warning",
        });
        return;
      }
      if (!res.ok || (!body.result && !body.snapshot)) {
        toast.show({
          title: "No se pudo consultar la placa",
          description: body.error ?? `El proveedor respondió con error (${res.status}).`,
          variant: "danger",
        });
        return;
      }

      const seed = body.result ?? {};
      const snapshot = body.snapshot;

      const created = createInspection({
        vehicle: {
          ...seed,
          plate: plate.trim().toUpperCase(),
          owner: seed.owner ?? "",
        },
        verifik: snapshot,
      });

      if (body.warnings && body.warnings.length > 0) {
        toast.show({
          title: "Consulta parcial",
          description: body.warnings.join(" · "),
          variant: "warning",
        });
      } else {
        toast.show({
          title: "Datos importados",
          description: "FASECOLDA + RUNT cargados. Verifica los campos antes de continuar.",
          variant: "success",
        });
      }
      router.push(`/inspection/${created.id}`);
    } catch (err) {
      toast.show({
        title: "Sin conexión al proveedor",
        description: (err as Error)?.message ?? "Verifica tu red e inténtalo de nuevo.",
        variant: "danger",
      });
    } finally {
      setLoading(false);
    }
  }

  function startManual() {
    const created = createInspection(
      plate.trim()
        ? { vehicle: { plate: plate.trim().toUpperCase() } }
        : undefined,
    );
    router.push(`/inspection/${created.id}`);
  }

  return (
    <div className="min-h-screen bg-muted/30 py-6">
      <div className="container max-w-2xl">
        <div className="mb-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/peritajes")}
            className="h-9 px-2 text-muted-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Volver
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Nuevo peritaje</CardTitle>
            <CardDescription>
              Ingresa la placa y la cédula del propietario para consultar
              FASECOLDA + RUNT y precargar el peritaje. Esta consulta tiene
              costo (~0.8 USD por placa).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="docType">Tipo de documento del propietario *</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger id="docType" className="h-11 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="docNumber">Número de documento *</Label>
                <Input
                  id="docNumber"
                  inputMode="numeric"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value.replace(/\s+/g, ""))}
                  placeholder="123456789"
                  className="h-11 sm:h-10"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="plate">Placa del vehículo *</Label>
                <Input
                  id="plate"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                  placeholder="ABC123"
                  maxLength={7}
                  className="h-11 text-base font-semibold tracking-wider sm:h-10 sm:text-sm"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <p>
                <strong>¿Qué se consulta?</strong> FASECOLDA (marca, línea, valor de mercado, equipamiento)
                + RUNT (VIN, motor, color, prendas, SOAT, RTM, historial). Los datos pre-llenan el
                formulario, pero vos siempre verificás contra el carro físico.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={startManual}
                disabled={loading}
                className="h-11 sm:h-10"
              >
                Iniciar manual sin consulta
              </Button>
              <Button
                type="button"
                onClick={startWithLookup}
                disabled={!canSubmit || loading}
                className="h-11 sm:h-10"
              >
                {loading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-1.5 h-4 w-4" />
                )}
                {loading ? "Consultando…" : "Consultar y empezar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
