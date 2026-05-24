"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Sparkles, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { useCurrentUser } from "@/components/panel/current-user";
import { listKnownVehicles } from "@/lib/inspections-store";
import type { VehicleInfo } from "@/lib/types";
import { cn, makeId } from "@/lib/utils";
import {
  OwnershipCardScanner,
  type ExtractedFields,
} from "../ownership-card-scanner";
import { useInspection } from "../inspection-context";
import { VerifikMismatchBanner } from "../verifik-mismatch-banner";

/**
 * Toma cualquier representación de un celular colombiano (con o sin +57, con
 * espacios, paréntesis, guiones) y devuelve los 10 dígitos locales formateados
 * como "XXX XXX XXXX". Si la entrada trae el código de país lo descarta. Si
 * sobran o faltan dígitos, igual devuelve lo que haya — la validación dura
 * vive en `finalize()` del summary, no acá.
 */
function formatCoMobileLocal(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  const local = digits.startsWith("57") && digits.length > 10
    ? digits.slice(2, 12)
    : digits.slice(-10);
  if (local.length <= 3) return local;
  if (local.length <= 6) return `${local.slice(0, 3)} ${local.slice(3)}`;
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 10)}`;
}

const FUEL_OPTIONS: { value: VehicleInfo["fuel"]; label: string }[] = [
  { value: "gasoline", label: "GASOLINA" },
  { value: "diesel", label: "DIÉSEL" },
  { value: "hybrid", label: "HÍBRIDO" },
  { value: "electric", label: "ELÉCTRICO" },
  { value: "gas", label: "GNV" },
];

const TX_OPTIONS: { value: VehicleInfo["transmission"]; label: string }[] = [
  { value: "manual", label: "MANUAL" },
  { value: "automatic", label: "AUTOMÁTICA" },
  { value: "cvt", label: "CVT" },
  { value: "dct", label: "DCT" },
];

// TODAS las opciones en MAYÚSCULA — así matchean con cómo viene impreso en la
// tarjeta de propiedad (que es texto en caps por el RUNT) y con lo que devuelve
// el OCR. Cambiar también acá si cambiás algo en `toVehicleFormFields`.
const BODY_TYPES = [
  "SEDÁN",
  "HATCHBACK",
  "SUV",
  "WAGON",
  "STATION WAGON",
  "PICKUP",
  "PICKUP SENCILLA",
  "PICKUP DOBLE CABINA",
  "VAN",
  "COUPÉ",
  "CONVERTIBLE",
];

const VEHICLE_CLASSES = [
  "AUTOMÓVIL",
  "CAMIONETA",
  "CAMPERO",
  "PICKUP",
  "MOTOCICLETA",
  "CAMIÓN",
  "BUS",
  "BUSETA",
  "MICROBÚS",
];

const NATIONALITY_OPTIONS = ["NACIONAL", "IMPORTADO"];

const SERVICE_OPTIONS = ["PARTICULAR", "PÚBLICO", "OFICIAL"];

// Marcas más comunes en el parque vehicular colombiano. Va por <datalist> en
// el input de marca — autocompleta sin bloquear al perito si tipea una marca
// rara que no esté en la lista.
const COMMON_MAKES = [
  "CHEVROLET", "RENAULT", "MAZDA", "TOYOTA", "HYUNDAI", "KIA", "NISSAN",
  "FORD", "VOLKSWAGEN", "SUZUKI", "HONDA", "MITSUBISHI", "FIAT", "PEUGEOT",
  "CITROËN", "AUDI", "BMW", "MERCEDES-BENZ", "SUBARU", "JEEP", "DODGE",
  "VOLVO", "LAND ROVER", "MINI", "FOTON", "JAC", "CHANGAN", "CHERY",
  "GREAT WALL", "DFM", "DFSK",
];

const COMMON_COLORS = [
  "BLANCO", "NEGRO", "GRIS", "PLATA", "PLATEADO", "ROJO", "AZUL",
  "AZUL OSCURO", "VERDE", "AMARILLO", "NARANJA", "BEIGE", "MARRÓN",
  "VINO TINTO", "CHAMPAGNE",
];


const CLAIMS_OPTIONS = ["NO", "SÍ"];

const PROPERTY_CARD_OPTIONS = ["ORIGINAL", "DUPLICADO"];

export function VehicleInfoStep() {
  const { id: currentId, data, setData } = useInspection();
  const v = data.vehicle;
  const toast = useToast();
  const currentUser = useCurrentUser();
  const [known, setKnown] = React.useState<VehicleInfo[]>([]);
  const [plateFocused, setPlateFocused] = React.useState(false);

  React.useEffect(() => {
    setKnown(listKnownVehicles().filter((x) => x.plate));
  }, [currentId]);

  // Seed perito name + license from the logged-in user's profile when this
  // peritaje doesn't have them yet. Only fills empty fields — never overwrites
  // a value the perito (or admin in /usuarios) typed by hand.
  React.useEffect(() => {
    if (!currentUser) return;
    setData((prev) => {
      const needsName = !prev.vehicle.inspector && !!currentUser.fullName;
      const needsLicense =
        !prev.vehicle.inspectorId && !!currentUser.licenseId;
      if (!needsName && !needsLicense) return prev;
      return {
        ...prev,
        vehicle: {
          ...prev.vehicle,
          inspector: needsName ? currentUser.fullName : prev.vehicle.inspector,
          inspectorId: needsLicense
            ? currentUser.licenseId ?? ""
            : prev.vehicle.inspectorId,
        },
      };
    });
  }, [currentUser, setData]);

  const plateQuery = v.plate.trim().toUpperCase();
  const suggestions = React.useMemo(() => {
    if (!plateQuery) return [];
    return known
      .filter((k) => k.plate && k.plate.toUpperCase().includes(plateQuery))
      .filter((k) => k.plate.toUpperCase() !== plateQuery)
      .slice(0, 5);
  }, [known, plateQuery]);

  function update<K extends keyof VehicleInfo>(key: K, value: VehicleInfo[K]) {
    setData((prev) => ({ ...prev, vehicle: { ...prev.vehicle, [key]: value } }));
  }

  // Autocomplete del propietario: cuando el perito tipea documento (o teléfono
  // como fallback), pegamos a /api/owners/lookup con debounce. Si hay match
  // mostramos un banner para pre-rellenar nombre/teléfono sin tipear todo de
  // nuevo. Si los campos ya están llenos con los mismos valores, no mostramos
  // nada (sería ruido). Si el peritaje ya está finalizado tampoco — la card
  // está en read-only y no hay nada que pre-rellenar.
  type OwnerHint = {
    id: string;
    fullName: string;
    document: string;
    phone: string;
    inspectionsCount: number;
  };
  const [ownerHint, setOwnerHint] = React.useState<OwnerHint | null>(null);
  const [hintDismissed, setHintDismissed] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data.status === "completed") {
      setOwnerHint(null);
      return;
    }
    const docDigits = (v.ownerDocument || "").replace(/\D/g, "");
    const phoneDigits = (v.ownerPhone || "").replace(/\D/g, "");
    // Lookup por documento si tiene ≥6 dígitos, o por teléfono ≥10 dígitos.
    // Sin estos thresholds disparamos lookups innecesarios mientras el perito
    // tipea los primeros caracteres.
    if (docDigits.length < 6 && phoneDigits.length < 10) {
      setOwnerHint(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const qs = new URLSearchParams();
        if (docDigits.length >= 6) qs.set("document", docDigits);
        if (phoneDigits.length >= 10) qs.set("phone", phoneDigits);
        const res = await fetch(`/api/owners/lookup?${qs}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { owner: OwnerHint | null };
        setOwnerHint(json.owner ?? null);
      } catch {
        // abort o red sin internet — ignoramos, el lookup es opcional.
      }
    }, 350);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [v.ownerDocument, v.ownerPhone, data.status]);

  const ownerHintActive =
    ownerHint &&
    ownerHint.id !== hintDismissed &&
    // Si los datos del wizard ya coinciden con el hint, no aportamos nada.
    !(
      ownerHint.fullName === (v.owner || "").trim().toUpperCase() &&
      (ownerHint.phone === v.ownerPhone || !ownerHint.phone)
    );

  function applyOwnerHint() {
    if (!ownerHint) return;
    setData((prev) => ({
      ...prev,
      vehicle: {
        ...prev.vehicle,
        owner: ownerHint.fullName || prev.vehicle.owner,
        ownerDocument: ownerHint.document || prev.vehicle.ownerDocument,
        ownerPhone: ownerHint.phone || prev.vehicle.ownerPhone,
      },
    }));
    toast.show({
      title: "Propietario pre-rellenado",
      description: `Datos cargados de ficha existente (${ownerHint.inspectionsCount} peritaje${ownerHint.inspectionsCount === 1 ? "" : "s"} previo${ownerHint.inspectionsCount === 1 ? "" : "s"}).`,
      variant: "success",
    });
    setHintDismissed(ownerHint.id);
  }

  function saveDocImage(side: "front" | "back", dataUrl: string | null) {
    if (!dataUrl) return;
    setData((prev) => ({
      ...prev,
      documents: {
        ...prev.documents,
        [side === "front" ? "ownershipCardFront" : "ownershipCardBack"]: [
          { id: makeId(), dataUrl },
        ],
      },
    }));
  }

  function applyOcrFields(fields: ExtractedFields, imageDataUrl: string | null) {
    setData((prev) => {
      const v = prev.vehicle;
      const next: VehicleInfo = {
        ...v,
        plate: fields.plate ?? v.plate,
        vin: fields.vin ?? v.vin,
        chassisNumber: fields.chassisNumber ?? v.chassisNumber,
        engineNumber: fields.engineNumber ?? v.engineNumber,
        make: fields.make ?? v.make,
        model: fields.model ?? v.model,
        year: fields.year ?? v.year,
        color: fields.color ?? v.color,
        bodyType: fields.bodyType ?? v.bodyType,
        fuel: fields.fuel ?? v.fuel,
        transmission: fields.transmission ?? v.transmission,
        vehicleClass: fields.vehicleClass ?? v.vehicleClass,
        nationality: fields.nationality ?? v.nationality,
        serviceType: fields.serviceType ?? v.serviceType,
        cylinderCapacity: fields.cylinderCapacity ?? v.cylinderCapacity,
        owner: fields.owner ?? v.owner,
        ownerDocument: fields.ownerDocument ?? v.ownerDocument,
        propertyCardStatus: fields.propertyCardStatus ?? v.propertyCardStatus,
      };
      return {
        ...prev,
        vehicle: next,
        documents: imageDataUrl
          ? {
              ...prev.documents,
              ownershipCardFront: [{ id: makeId(), dataUrl: imageDataUrl }],
            }
          : prev.documents,
      };
    });
  }

  function prefillFrom(source: VehicleInfo) {
    setData((prev) => ({
      ...prev,
      vehicle: {
        ...prev.vehicle,
        plate: source.plate,
        vin: source.vin || prev.vehicle.vin,
        chassisNumber: source.chassisNumber || prev.vehicle.chassisNumber,
        engineNumber: source.engineNumber || prev.vehicle.engineNumber,
        make: source.make || prev.vehicle.make,
        model: source.model || prev.vehicle.model,
        year: source.year || prev.vehicle.year,
        color: source.color || prev.vehicle.color,
        vehicleClass: source.vehicleClass || prev.vehicle.vehicleClass,
        nationality: source.nationality || prev.vehicle.nationality,
        cylinderCapacity: source.cylinderCapacity || prev.vehicle.cylinderCapacity,
        serviceType: source.serviceType || prev.vehicle.serviceType,
        paintCondition: source.paintCondition || prev.vehicle.paintCondition,
        fuel: source.fuel || prev.vehicle.fuel,
        transmission: source.transmission || prev.vehicle.transmission,
        bodyType: source.bodyType || prev.vehicle.bodyType,
        owner: source.owner || prev.vehicle.owner,
      },
    }));
    setPlateFocused(false);
    toast.show({
      title: "Datos del vehículo autocompletados",
      description: "Revisa kilometraje y fecha — esos siempre cambian.",
      variant: "success",
    });
  }

  const front = data.documents.ownershipCardFront[0];
  const back = data.documents.ownershipCardBack[0];

  // Una vez que hay foto del frente capturada, todos los campos que siguen
  // vacíos quedan "pendientes". Algunos los trae el OCR (y si quedaron vacíos
  // es porque la lectura falló), otros nunca vienen del documento (kilometraje,
  // fecha, teléfono — son siempre manuales). El resaltado los hace visibles
  // para que el perito no los pase por alto.
  const cardScanned = !!front;
  const PENDING_TARGETS: Array<{ key: keyof VehicleInfo; label: string }> = [
    { key: "plate", label: "Placa" },
    { key: "vin", label: "No. Serial" },
    { key: "chassisNumber", label: "No. Chasis" },
    { key: "engineNumber", label: "No. Motor" },
    { key: "make", label: "Marca" },
    { key: "model", label: "Línea" },
    { key: "year", label: "Modelo (año)" },
    { key: "color", label: "Color" },
    { key: "bodyType", label: "Carrocería" },
    { key: "vehicleClass", label: "Clase" },
    { key: "nationality", label: "Nacionalidad" },
    { key: "cylinderCapacity", label: "Cilindraje" },
    { key: "fuel", label: "Combustible" },
    { key: "transmission", label: "Caja" },
    { key: "serviceType", label: "Servicio" },
    { key: "mileage", label: "Kilometraje" },
    { key: "owner", label: "Propietario" },
    { key: "location", label: "Lugar" },
    { key: "date", label: "Fecha" },
    { key: "ownerDocument", label: "Documento" },
    { key: "ownerPhone", label: "Teléfono" },
    { key: "propertyCardStatus", label: "Tarjeta" },
    { key: "insurer", label: "Aseguradora" },
    { key: "hasClaimsHistory", label: "Siniestros" },
  ];
  const pendingFields = cardScanned
    ? PENDING_TARGETS.filter(({ key }) => !String(v[key] ?? "").trim())
    : [];
  const isPending = (key: keyof VehicleInfo): boolean =>
    cardScanned && !String(v[key] ?? "").trim();
  // Clase de resaltado para inputs y triggers de select pendientes.
  const HL = "border-warning bg-warning/5 ring-1 ring-warning/30 focus-visible:ring-warning";

  function focusField(targetId: string) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof (el as HTMLElement).focus === "function") {
      (el as HTMLElement).focus({ preventScroll: true });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tarjeta de propiedad / Licencia de tránsito *</CardTitle>
          <CardDescription>
            Escanea las dos caras. El frente extrae datos por OCR y rellena el formulario;
            el reverso solo se guarda como evidencia. Las dos caras son obligatorias y
            cuentan como las dos primeras fotos del peritaje.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Frente *</Label>
            {front ? (
              <div className="relative overflow-hidden rounded-md border bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={front.dataUrl}
                  alt="Tarjeta de propiedad — Frente"
                  className="h-40 w-full object-cover"
                />
                <span className="absolute right-1.5 top-1.5 rounded-full bg-success/90 px-2 py-0.5 text-[10px] font-medium text-success-foreground">
                  Capturado
                </span>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground">
                Sin captura
              </div>
            )}
            <OwnershipCardScanner
              onApply={applyOcrFields}
              buttonLabel={front ? "Re-escanear frente" : "Escanear frente (OCR)"}
              buttonLabelShort={front ? "Re-escanear frente" : "Escanear frente"}
              expectedSide="front"
              // Si el OCR detecta que la foto es el REVERSO, ofrecemos
              // guardarla directo en el slot del reverso. Evita que el perito
              // tenga que cancelar, ir al otro botón y volver a tomar la foto.
              onWrongSide={(dataUrl) => saveDocImage("back", dataUrl)}
            />
          </div>
          <div className="space-y-2">
            <Label>Reverso *</Label>
            {back ? (
              <div className="relative overflow-hidden rounded-md border bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={back.dataUrl}
                  alt="Tarjeta de propiedad — Reverso"
                  className="h-40 w-full object-cover"
                />
                <span className="absolute right-1.5 top-1.5 rounded-full bg-success/90 px-2 py-0.5 text-[10px] font-medium text-success-foreground">
                  Capturado
                </span>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground">
                Sin captura
              </div>
            )}
            <OwnershipCardScanner
              onApply={(_fields, dataUrl) => saveDocImage("back", dataUrl)}
              runOcr={false}
              buttonLabel={back ? "Re-capturar reverso" : "Capturar reverso"}
              buttonLabelShort={back ? "Re-capturar reverso" : "Capturar reverso"}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos del vehículo</CardTitle>
          <CardDescription>
            Información de identificación del vehículo inspeccionado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <VerifikMismatchBanner vehicle={v} verifik={data.verifik} />
          {pendingFields.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-medium text-warning">
                  {pendingFields.length === 1
                    ? "1 campo por completar"
                    : `${pendingFields.length} campos por completar`}
                </p>
                <p className="text-xs text-warning/80">
                  El OCR no llenó estos campos. Revísalos antes de continuar — quedan
                  resaltados abajo.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {pendingFields.slice(0, 8).map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => focusField(String(key))}
                      className="inline-flex items-center rounded-full border border-warning/40 bg-background px-2 py-0.5 text-[11px] font-medium text-warning hover:bg-warning/10"
                    >
                      {label}
                    </button>
                  ))}
                  {pendingFields.length > 8 && (
                    <span className="inline-flex items-center text-[11px] text-warning/80">
                      +{pendingFields.length - 8} más
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="plate">Placa *</Label>
            <div className="relative flex gap-2">
              <Input
                id="plate"
                value={v.plate}
                onChange={(e) => update("plate", e.target.value.toUpperCase())}
                onFocus={() => setPlateFocused(true)}
                onBlur={() => {
                  // Delay so clicks on suggestions register first
                  window.setTimeout(() => setPlateFocused(false), 150);
                }}
                placeholder="ABC123"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                maxLength={8}
                className={cn(
                  "h-11 flex-1 text-base font-semibold tracking-wider sm:h-10 sm:text-sm",
                  isPending("plate") && HL,
                )}
              />
              {data.verifik && (
                <span
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-3 text-xs font-medium text-success sm:h-10"
                  title={`Consultado el ${new Date(data.verifik.queriedAt).toLocaleString("es-CO")} · datos cacheados`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Consultado</span>
                </span>
              )}
              {plateFocused && suggestions.length > 0 && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Peritajes previos
                  </div>
                  {suggestions.map((s, i) => (
                    <button
                      key={`${s.plate}-${i}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => prefillFrom(s)}
                      className="flex w-full items-center gap-3 border-t px-3 py-2 text-left hover:bg-accent"
                    >
                      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{s.plate}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[s.make, s.model, s.year].filter(Boolean).join(" · ") ||
                            "Datos incompletos"}
                        </div>
                      </div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-primary">
                        Rellenar
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!plateFocused && known.length > 0 && !plateQuery && (
              <p className="text-[11px] text-muted-foreground">
                Tip: al escribir la placa te sugerimos peritajes previos para autocompletar.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vin">No. Serial</Label>
            <Input
              id="vin"
              value={v.vin}
              onChange={(e) => update("vin", e.target.value.toUpperCase())}
              placeholder="17 caracteres"
              maxLength={17}
              className={cn("h-11 sm:h-10", isPending("vin") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chassisNumber">No. Chasis</Label>
            <Input
              id="chassisNumber"
              value={v.chassisNumber}
              onChange={(e) => update("chassisNumber", e.target.value.toUpperCase())}
              placeholder="Estampado en chasis"
              className={cn("h-11 sm:h-10", isPending("chassisNumber") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="engineNumber">No. Motor</Label>
            <Input
              id="engineNumber"
              value={v.engineNumber}
              onChange={(e) => update("engineNumber", e.target.value.toUpperCase())}
              placeholder="Estampado en bloque"
              className={cn("h-11 sm:h-10", isPending("engineNumber") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="make">Marca *</Label>
            <Input
              id="make"
              list="vehicle-makes-list"
              value={v.make}
              onChange={(e) => update("make", e.target.value.toUpperCase())}
              placeholder="TOYOTA"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              className={cn("h-11 uppercase sm:h-10", isPending("make") && HL)}
            />
            <datalist id="vehicle-makes-list">
              {COMMON_MAKES.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model">Línea *</Label>
            <Input
              id="model"
              value={v.model}
              onChange={(e) => update("model", e.target.value.toUpperCase())}
              placeholder="COROLLA XEI 1.8"
              autoCapitalize="characters"
              className={cn("h-11 uppercase sm:h-10", isPending("model") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="year">Modelo *</Label>
            <Input
              id="year"
              inputMode="numeric"
              value={v.year}
              onChange={(e) => update("year", e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="2020"
              className={cn("h-11 sm:h-10", isPending("year") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="color">Color</Label>
            <Input
              id="color"
              list="vehicle-colors-list"
              value={v.color}
              onChange={(e) => update("color", e.target.value.toUpperCase())}
              placeholder="BLANCO"
              autoComplete="off"
              autoCapitalize="characters"
              className={cn("h-11 uppercase sm:h-10", isPending("color") && HL)}
            />
            <datalist id="vehicle-colors-list">
              {COMMON_COLORS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Carrocería</Label>
            <Select
              value={v.bodyType || undefined}
              onValueChange={(val) => update("bodyType", val)}
            >
              <SelectTrigger id="bodyType" className={cn("h-11 sm:h-10", isPending("bodyType") && HL)}>
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {BODY_TYPES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Clase</Label>
            <Select
              value={v.vehicleClass || undefined}
              onValueChange={(val) => update("vehicleClass", val)}
            >
              <SelectTrigger id="vehicleClass" className={cn("h-11 sm:h-10", isPending("vehicleClass") && HL)}>
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nacionalidad</Label>
            <Select
              value={v.nationality || undefined}
              onValueChange={(val) => update("nationality", val)}
            >
              <SelectTrigger id="nationality" className={cn("h-11 sm:h-10", isPending("nationality") && HL)}>
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {NATIONALITY_OPTIONS.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cylinderCapacity">Cilindraje (cc)</Label>
            <Input
              id="cylinderCapacity"
              inputMode="numeric"
              value={v.cylinderCapacity}
              onChange={(e) => update("cylinderCapacity", e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="1598"
              className={cn("h-11 sm:h-10", isPending("cylinderCapacity") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Combustible</Label>
            <Select
              value={v.fuel || undefined}
              onValueChange={(val) => update("fuel", val as VehicleInfo["fuel"])}
            >
              <SelectTrigger id="fuel" className={cn("h-11 sm:h-10", isPending("fuel") && HL)}>
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {FUEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de caja</Label>
            <Select
              value={v.transmission || undefined}
              onValueChange={(val) => update("transmission", val as VehicleInfo["transmission"])}
            >
              <SelectTrigger id="transmission" className={cn("h-11 sm:h-10", isPending("transmission") && HL)}>
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {TX_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Servicio</Label>
            <Select
              value={v.serviceType || undefined}
              onValueChange={(val) => update("serviceType", val)}
            >
              <SelectTrigger id="serviceType" className={cn("h-11 sm:h-10", isPending("serviceType") && HL)}>
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mileage">Kilometraje *</Label>
            <Input
              id="mileage"
              inputMode="numeric"
              value={v.mileage}
              onChange={(e) => update("mileage", e.target.value.replace(/\D/g, ""))}
              placeholder="85000"
              className={cn("h-11 sm:h-10", isPending("mileage") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner">Propietario</Label>
            <Input
              id="owner"
              value={v.owner}
              onChange={(e) => update("owner", e.target.value.toUpperCase())}
              placeholder="NOMBRE DEL TITULAR"
              autoCapitalize="characters"
              className={cn("h-11 uppercase sm:h-10", isPending("owner") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Lugar de inspección</Label>
            <Input
              id="location"
              value={v.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Ciudad / dirección"
              className={cn("h-11 sm:h-10", isPending("location") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Fecha *</Label>
            <Input
              id="date"
              type="date"
              value={v.date}
              onChange={(e) => update("date", e.target.value)}
              className={cn("h-11 sm:h-10", isPending("date") && HL)}
            />
          </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentación</CardTitle>
          <CardDescription>
            Datos del propietario, póliza particular y reporte de siniestros. Lo que el RUNT no entrega lo digita el perito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ownerHintActive && ownerHint && (
            <div className="flex flex-col gap-2 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-success">
                <UserCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">
                    Cliente recurrente: {ownerHint.fullName || "(sin nombre)"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ownerHint.inspectionsCount} peritaje
                    {ownerHint.inspectionsCount === 1 ? "" : "s"} previo
                    {ownerHint.inspectionsCount === 1 ? "" : "s"}
                    {ownerHint.phone ? ` · ${ownerHint.phone}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setHintDismissed(ownerHint.id)}
                >
                  Ignorar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={applyOwnerHint}
                >
                  Pre-rellenar
                </Button>
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ownerDocument">Documento o NIT</Label>
            <Input
              id="ownerDocument"
              value={v.ownerDocument}
              onChange={(e) => update("ownerDocument", e.target.value)}
              placeholder="1.020.456.789"
              className={cn("h-11 sm:h-10", isPending("ownerDocument") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ownerPhone">Teléfono</Label>
            <div
              className={cn(
                "flex h-11 items-stretch overflow-hidden rounded-md border border-input bg-background ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 sm:h-10",
                isPending("ownerPhone") && HL,
              )}
            >
              <span className="flex shrink-0 items-center border-r border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                +57
              </span>
              <Input
                id="ownerPhone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={formatCoMobileLocal(v.ownerPhone)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  update("ownerPhone", digits ? `+57 ${formatCoMobileLocal(digits)}` : "");
                }}
                placeholder="310 555 1234"
                maxLength={12}
                className="h-full flex-1 rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Tarjeta de Propiedad</Label>
            <Select
              value={v.propertyCardStatus || undefined}
              onValueChange={(val) => update("propertyCardStatus", val)}
            >
              <SelectTrigger
                id="propertyCardStatus"
                className={cn("h-11 sm:h-10", isPending("propertyCardStatus") && HL)}
              >
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_CARD_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="insurer">Aseguradora (todo riesgo)</Label>
            <Input
              id="insurer"
              value={v.insurer}
              onChange={(e) => update("insurer", e.target.value)}
              placeholder="Sura, Bolívar, Allianz…"
              className={cn("h-11 sm:h-10", isPending("insurer") && HL)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reporta siniestros</Label>
            <Select
              value={v.hasClaimsHistory || undefined}
              onValueChange={(val) => {
                update("hasClaimsHistory", val);
                if (val !== "SÍ") {
                  update("claimsCount", "");
                  update("claimsValue", "");
                }
              }}
            >
              <SelectTrigger
                id="hasClaimsHistory"
                className={cn("h-11 sm:h-10", isPending("hasClaimsHistory") && HL)}
              >
                <SelectValue placeholder="Seleccione" />
              </SelectTrigger>
              <SelectContent>
                {CLAIMS_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {v.hasClaimsHistory === "SÍ" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="claimsCount">Número de siniestros</Label>
                <Input
                  id="claimsCount"
                  inputMode="numeric"
                  value={v.claimsCount}
                  onChange={(e) => update("claimsCount", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="0"
                  className="h-11 sm:h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claimsValue">Valor de reclamaciones (COP)</Label>
                <Input
                  id="claimsValue"
                  inputMode="numeric"
                  value={v.claimsValue}
                  onChange={(e) => update("claimsValue", e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className="h-11 sm:h-10"
                />
              </div>
            </>
          )}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
