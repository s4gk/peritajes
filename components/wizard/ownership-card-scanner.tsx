"use client";

import * as React from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCopy,
  ImageIcon,
  Loader2,
  RefreshCcw,
  ScanLine,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Botón "Escanear tarjeta de propiedad" + flow de captura.
 * - En vez del native `capture="environment"` (que en algunos Android abría
 *   la cámara en negro o no devolvía la imagen), usamos `getUserMedia` para
 *   mostrar una preview en vivo dentro del dialog y capturamos un frame con
 *   canvas. Mucho más controlable y consistente entre dispositivos.
 * - Fallback siempre disponible: "Subir desde galería" con file input puro
 *   (sin capture), por si la cámara está negada o el dispositivo no la
 *   soporta vía getUserMedia.
 */

export type ExtractedFields = {
  plate?: string;
  licenseNumber?: string;
  vin?: string;
  chassisNumber?: string;
  engineNumber?: string;
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  bodyType?: string;
  fuel?: "gasoline" | "diesel" | "hybrid" | "electric" | "gas";
  transmission?: "manual" | "automatic" | "cvt" | "dct";
  vehicleClass?: string;
  nationality?: string;
  serviceType?: string;
  cylinderCapacity?: string;
  owner?: string;
};

type Props = {
  /** Callback al confirmar. Recibe los campos OCR (vacío si runOcr=false o no
   *  se detectó nada) y el data URL de la imagen capturada para guardarla como
   *  evidencia. */
  onApply: (fields: ExtractedFields, imageDataUrl: string | null) => void;
  /** Si false, no se ejecuta OCR — solo se captura la imagen. Útil para el
   *  reverso de la tarjeta, donde la cara con datos ya fue escaneada. */
  runOcr?: boolean;
  /** Texto del botón disparador. */
  buttonLabel?: string;
  /** Texto compacto para móvil. */
  buttonLabelShort?: string;
};

const FIELD_LABELS: Record<keyof ExtractedFields, string> = {
  plate: "Placa",
  licenseNumber: "No. Licencia tránsito",
  vin: "No. Serial (VIN)",
  chassisNumber: "No. Chasis",
  engineNumber: "No. Motor",
  make: "Marca",
  model: "Línea",
  year: "Modelo",
  color: "Color",
  bodyType: "Carrocería",
  fuel: "Combustible",
  transmission: "Caja",
  vehicleClass: "Clase",
  nationality: "Nacionalidad",
  serviceType: "Servicio",
  cylinderCapacity: "Cilindraje (cc)",
  owner: "Propietario",
};

const FUEL_LABELS: Record<NonNullable<ExtractedFields["fuel"]>, string> = {
  gasoline: "Gasolina",
  diesel: "Diésel",
  hybrid: "Híbrido",
  electric: "Eléctrico",
  gas: "GNV",
};

const TX_LABELS: Record<NonNullable<ExtractedFields["transmission"]>, string> = {
  manual: "Manual",
  automatic: "Automática",
  cvt: "CVT",
  dct: "DCT",
};

function displayValue(key: keyof ExtractedFields, value: unknown): string {
  if (value == null || value === "") return "";
  if (key === "fuel") return FUEL_LABELS[value as keyof typeof FUEL_LABELS] ?? String(value);
  if (key === "transmission")
    return TX_LABELS[value as keyof typeof TX_LABELS] ?? String(value);
  return String(value);
}

/**
 * Carga una fuente (Blob/HTMLVideoElement) en un canvas redimensionado al
 * `maxDim` con suavizado de alta calidad y, en el caso de Blob, respetando la
 * rotación EXIF. Sin esto, una foto de tarjeta tomada en vertical desde la
 * galería se renderizaba estirada/borrosa y el OCR no leía nada.
 */
async function blobToBitmap(
  blob: Blob,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // imageOrientation: 'from-image' aplica la rotación EXIF para que el
      // canvas reciba el frame ya orientado.
      return await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
    } catch {
      // Algunos browsers (Safari < 17 con HEIC) tiran acá — caemos al fallback.
    }
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = (e) => reject(e);
    i.src = dataUrl;
  });
}

async function resizeBlob(
  blob: Blob,
  maxDim = 2000,
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const source = await blobToBitmap(blob);
  const srcW =
    source instanceof HTMLImageElement
      ? source.naturalWidth || source.width
      : source.width;
  const srcH =
    source instanceof HTMLImageElement
      ? source.naturalHeight || source.height
      : source.height;
  if (!srcW || !srcH) throw new Error("Imagen sin dimensiones legibles.");

  const ratio = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.round(srcW * ratio);
  const h = Math.round(srcH * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear el canvas para redimensionar.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  // Liberar el bitmap si aplica (createImageBitmap path)
  if ("close" in source && typeof source.close === "function") {
    try {
      source.close();
    } catch {
      /* noop */
    }
  }
  const compressed = canvas.toDataURL("image/jpeg", 0.92);
  const match = compressed.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!match) throw new Error("No se pudo codificar la imagen.");
  return { mimeType: match[1], base64: match[2], previewUrl: compressed };
}

type CameraState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "live" }
  | { phase: "error"; message: string };

export function OwnershipCardScanner({
  onApply,
  runOcr = true,
  buttonLabel = "Escanear tarjeta de propiedad",
  buttonLabelShort = "Escanear tarjeta",
}: Props) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  // Marca el componente como vivo. Sin esto, una llamada al OCR que termina
  // después de que el perito navegó a otro paso disparaba setState sobre un
  // árbol desmontado (warning de React + posible inconsistencia de UI).
  const mountedRef = React.useRef(true);
  // Permite cancelar el fetch en curso si el usuario cierra el dialog o reescaneo.
  const abortRef = React.useRef<AbortController | null>(null);
  const toast = useToast();

  const [open, setOpen] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [fields, setFields] = React.useState<ExtractedFields | null>(null);
  const [excluded, setExcluded] = React.useState<Set<keyof ExtractedFields>>(new Set());
  const [cameraState, setCameraState] = React.useState<CameraState>({ phase: "idle" });
  // Error inline dentro del dialog. Lo mostramos en una card con copy-to-clipboard
  // así el perito puede leerlo (los toasts se descartan demasiado rápido).
  const [errorDetail, setErrorDetail] = React.useState<{
    title: string;
    detail: string;
    status?: number;
  } | null>(null);
  // Modo "vivo": preview de cámara con getUserMedia. Solo lo intentamos cuando
  // efectivamente está disponible (HTTPS + soporte). Si no, mostramos directo
  // la UI de subir foto, que es la que funciona en cualquier dispositivo.
  const [liveMode, setLiveMode] = React.useState(false);

  const liveCameraAvailable =
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext;

  function stopStream() {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  const startCamera = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      const isSecure = window.isSecureContext;
      setCameraState({
        phase: "error",
        message: isSecure
          ? "Este navegador no expone la cámara. Usá 'Tomar foto' o 'Subir desde galería'."
          : "La cámara en vivo solo funciona sobre HTTPS. Usá 'Tomar foto' (abre la cámara del sistema) o 'Subir desde galería'.",
      });
      return;
    }
    setCameraState({ phase: "starting" });
    stopStream();
    try {
      // Pedimos cámara trasera; si no hay, el browser cae a la disponible.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // iOS necesita playsInline + muted antes de play()
        video.muted = true;
        video.playsInline = true;
        try {
          await video.play();
        } catch {
          // Algunos browsers requieren un gesto del usuario. La preview ya
          // está conectada — el usuario puede presionar capturar igual.
        }
      }
      setCameraState({ phase: "live" });
    } catch (err) {
      const name = (err as DOMException)?.name;
      let message = "No se pudo abrir la cámara.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        message =
          "Permiso de cámara denegado. Activalo en la configuración del navegador o usá 'Subir desde galería'.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        message = "No se encontró una cámara compatible. Usá 'Subir desde galería'.";
      } else if (name === "NotReadableError") {
        message =
          "La cámara está siendo usada por otra app. Cerrá las otras apps que usen cámara y reintentá.";
      }
      setCameraState({ phase: "error", message });
    }
  }, []);

  function reset() {
    stopStream();
    setPreviewUrl(null);
    setFields(null);
    setExcluded(new Set());
    setBusy(false);
    setCameraState({ phase: "idle" });
    setLiveMode(false);
    setErrorDetail(null);
  }

  const close = React.useCallback(() => {
    setOpen(false);
    // Defer reset hasta que termine la animación de cierre
    window.setTimeout(reset, 200);
  }, []);

  // Cleanup al desmontar
  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      stopStream();
    };
  }, []);

  // Si el usuario activa modo vivo y aún no hemos arrancado la cámara, lo hacemos.
  React.useEffect(() => {
    if (!open) return;
    if (!liveMode) return;
    if (previewUrl) return;
    if (cameraState.phase !== "idle") return;
    void startCamera();
  }, [open, liveMode, previewUrl, cameraState.phase, startCamera]);

  function openScanner() {
    setOpen(true);
  }

  async function captureFromVideo() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      toast.show({
        title: "La cámara aún no está lista",
        description: "Esperá un segundo y volvé a intentar.",
        variant: "warning",
      });
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      toast.show({
        title: "No se pudo leer la cámara",
        description: "Probá cerrar y reabrir el escaneo.",
        variant: "warning",
      });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (!blob) {
      toast.show({
        title: "No se pudo capturar la imagen",
        variant: "danger",
      });
      return;
    }
    stopStream();
    await processBlob(blob);
  }

  async function handleFile(file: File) {
    await processBlob(file);
  }

  async function processBlob(input: Blob) {
    // Cancelamos un fetch previo si el usuario reintentó rápido.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setFields(null);
    setExcluded(new Set());
    setErrorDetail(null);
    try {
      const { base64, mimeType, previewUrl } = await resizeBlob(input);
      if (!mountedRef.current || controller.signal.aborted) return;
      setPreviewUrl(previewUrl);
      if (!runOcr) {
        // Modo "solo captura" (reverso): no llamamos al endpoint, dejamos los
        // campos vacíos y mostramos preview lista para Aplicar.
        setFields({});
        return;
      }
      const res = await fetch("/api/ocr/ownership-card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl: `data:${mimeType};base64,${base64}` }),
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        if (!mountedRef.current || controller.signal.aborted) return;
        let parsed: { error?: string; detail?: string } | null = null;
        try {
          parsed = raw ? (JSON.parse(raw) as { error?: string; detail?: string }) : null;
        } catch {
          parsed = null;
        }
        const title =
          res.status === 401
            ? "Sesión expirada"
            : res.status === 429
              ? "Demasiados escaneos"
              : res.status === 413
                ? "Imagen muy pesada"
                : res.status === 400
                  ? "Imagen inválida"
                  : "No se pudo leer la tarjeta";
        const detailText =
          parsed?.detail ??
          parsed?.error ??
          (raw ? raw.slice(0, 500) : `HTTP ${res.status} ${res.statusText}`);
        setErrorDetail({
          title,
          detail: `${detailText}\n\n(HTTP ${res.status})`,
          status: res.status,
        });
        return;
      }
      const data = (await res.json()) as { fields: ExtractedFields };
      if (!mountedRef.current || controller.signal.aborted) return;
      setFields(data.fields);
      const count = Object.keys(data.fields).length;
      if (count === 0) {
        setErrorDetail({
          title: "No detecté datos en la imagen",
          detail:
            "Probá con una foto más nítida, mejor iluminada o más cerca de la tarjeta. Asegurate que toda la tarjeta esté visible.",
        });
      }
    } catch (err) {
      // AbortError: el usuario reintentó / cerró el dialog — silencioso.
      if ((err as { name?: string })?.name === "AbortError") return;
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : "Error desconocido";
      const stack = err instanceof Error && err.stack ? err.stack.slice(0, 600) : "";
      setErrorDetail({
        title: "No se pudo procesar la imagen",
        detail: stack ? `${message}\n\n${stack}` : message,
      });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function retake() {
    setPreviewUrl(null);
    setFields(null);
    setExcluded(new Set());
    setCameraState({ phase: "idle" });
    if (liveMode && liveCameraAvailable) {
      void startCamera();
    } else {
      setLiveMode(false);
    }
  }

  function toggleExclude(key: keyof ExtractedFields) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function apply() {
    if (!fields) return;
    const filtered: ExtractedFields = {};
    (Object.keys(fields) as (keyof ExtractedFields)[]).forEach((k) => {
      if (excluded.has(k)) return;
      const v = fields[k];
      if (v != null && v !== "") (filtered as Record<string, unknown>)[k] = v;
    });
    onApply(filtered, previewUrl);
    const appliedCount = Object.keys(filtered).length;
    toast.show({
      title: !runOcr
        ? "Reverso guardado"
        : appliedCount > 0
          ? "Datos aplicados al formulario"
          : "Foto guardada como evidencia",
      description: !runOcr
        ? "Reverso registrado como una de las fotos del peritaje."
        : appliedCount > 0
          ? "Revisá los campos antes de continuar."
          : "Completá los datos del vehículo a mano.",
      variant: "success",
    });
    close();
  }

  const detectedKeys = fields
    ? (Object.keys(fields) as (keyof ExtractedFields)[]).filter(
        (k) => fields[k] != null && fields[k] !== "",
      )
    : [];

  const showCamera = !previewUrl && !fields && !busy;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            stopStream();
            setOpen(true);
            void handleFile(file);
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openScanner}
        className="gap-1.5"
      >
        <ScanLine className="h-4 w-4" />
        <span className="hidden sm:inline">{buttonLabel}</span>
        <span className="sm:hidden">{buttonLabelShort}</span>
      </Button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              {previewUrl || fields || busy ? "Tarjeta escaneada" : "Escanear tarjeta"}
            </DialogTitle>
            <DialogDescription>
              {showCamera
                ? liveMode
                  ? "Encuadrá la tarjeta dentro del recuadro y presioná Capturar."
                  : "Subí una foto de la tarjeta de propiedad y la IA extrae los datos."
                : "Revisá los datos detectados antes de aplicarlos al formulario."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {showCamera && !liveMode && (
              <div className="space-y-3">
                <div className="rounded-md border border-dashed bg-muted/30 p-5 text-center">
                  <ImageIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Subí una foto de la tarjeta</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    Tomá la foto con la app de cámara de tu celular y subila acá.
                    Funciona mejor con buena luz, sin reflejos y la tarjeta lo más
                    cuadrada posible.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full"
                  size="lg"
                >
                  <ImageIcon className="mr-1.5 h-4 w-4" /> Subir foto
                </Button>
                {liveCameraAvailable && (
                  <button
                    type="button"
                    onClick={() => setLiveMode(true)}
                    className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    o usá la cámara en vivo dentro del navegador
                  </button>
                )}
              </div>
            )}

            {showCamera && liveMode && (
              <div className="space-y-3">
                <div className="relative aspect-[4/3] overflow-hidden rounded-md border bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={cn(
                      "h-full w-full object-cover transition-opacity",
                      cameraState.phase === "live" ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {cameraState.phase === "starting" && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Iniciando cámara…
                    </div>
                  )}
                  {cameraState.phase === "error" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/90">
                      <X className="h-6 w-6 text-warning" />
                      <p className="leading-snug">{cameraState.message}</p>
                      <div className="mt-1 flex flex-wrap justify-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void startCamera()}
                        >
                          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            stopStream();
                            setLiveMode(false);
                            setCameraState({ phase: "idle" });
                          }}
                        >
                          Volver a subir foto
                        </Button>
                      </div>
                    </div>
                  )}
                  {cameraState.phase === "live" && (
                    <div className="pointer-events-none absolute inset-4 rounded-md border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    onClick={captureFromVideo}
                    disabled={cameraState.phase !== "live"}
                    className="w-full"
                  >
                    <Camera className="mr-1.5 h-4 w-4" /> Capturar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      stopStream();
                      setLiveMode(false);
                      setCameraState({ phase: "idle" });
                    }}
                    className="w-full"
                  >
                    Cancelar cámara en vivo
                  </Button>
                </div>
              </div>
            )}

            {previewUrl && (
              <div className="overflow-hidden rounded-md border bg-muted">
                <img
                  src={previewUrl}
                  alt="Tarjeta"
                  className="max-h-48 w-full object-contain"
                />
              </div>
            )}

            {errorDetail && !busy && (
              <ErrorPanel
                title={errorDetail.title}
                detail={errorDetail.detail}
                onRetry={retake}
                onCopy={() => {
                  const text = `${errorDetail.title}\n\n${errorDetail.detail}`;
                  if (navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(text).then(() => {
                      toast.show({ title: "Error copiado al portapapeles", variant: "default" });
                    });
                  } else {
                    toast.show({
                      title: "Tu navegador no soporta copiar al portapapeles",
                      variant: "warning",
                    });
                  }
                }}
                onUseAnyway={
                  previewUrl
                    ? () => {
                        // El OCR falló pero la foto está OK — la subimos como
                        // evidencia y el perito completa los campos a mano.
                        onApply({}, previewUrl);
                        toast.show({
                          title: "Foto guardada como evidencia",
                          description: "Completá los datos del vehículo a mano.",
                          variant: "success",
                        });
                        close();
                      }
                    : undefined
                }
              />
            )}

            {busy ? (
              <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {runOcr ? "Leyendo la tarjeta..." : "Procesando imagen..."}
              </div>
            ) : fields && !errorDetail ? (
              !runOcr ? (
                // Modo "solo captura" (reverso): no esperamos campos, la foto
                // ya está lista para guardar. Mostramos confirmación y nada más.
                <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="font-medium">Reverso listo para guardar</span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-success/90">
                    Esta imagen cuenta como evidencia (1 de las fotos requeridas).
                  </p>
                </div>
              ) : detectedKeys.length === 0 ? (
                // OCR corrió pero no detectó nada. En vez de bloquear, ofrecemos
                // continuar a mano — la foto igual sirve como evidencia.
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    No detecté datos en la tarjeta
                  </div>
                  <p className="mt-1 text-xs leading-snug text-warning/90">
                    Probá con una foto más nítida o mejor iluminada. Si querés, podés
                    igual guardar la foto como evidencia y completar los campos a mano.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border bg-card">
                  <div className="border-b px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                    {detectedKeys.length} campo{detectedKeys.length === 1 ? "" : "s"} detectado
                    {detectedKeys.length === 1 ? "" : "s"}
                  </div>
                  <ul className="divide-y">
                    {detectedKeys.map((k) => {
                      const value = displayValue(k, fields[k]);
                      const isExcluded = excluded.has(k);
                      return (
                        <li key={k}>
                          <button
                            type="button"
                            onClick={() => toggleExclude(k)}
                            className={cn(
                              "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50",
                              isExcluded && "opacity-50",
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {FIELD_LABELS[k]}
                              </div>
                              <div className="truncate text-sm font-medium">{value}</div>
                            </div>
                            {!isExcluded ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                            ) : (
                              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                                Omitir
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              Cancelar
            </Button>
            {previewUrl && fields && (
              <Button type="button" variant="outline" onClick={retake}>
                <RefreshCcw className="mr-1.5 h-4 w-4" /> Otra foto
              </Button>
            )}
            <Button
              type="button"
              onClick={apply}
              disabled={busy || !previewUrl || !fields}
            >
              {!runOcr
                ? "Guardar reverso"
                : detectedKeys.length === 0
                  ? "Guardar foto y completar a mano"
                  : "Aplicar datos al formulario"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ErrorPanel({
  title,
  detail,
  onRetry,
  onCopy,
  onUseAnyway,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  onCopy: () => void;
  /** Si está definido, agrega un botón para guardar la foto como evidencia
   *  aunque el OCR haya fallado. El perito completa los campos a mano. */
  onUseAnyway?: () => void;
}) {
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
      <div className="mb-2 flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <div className="flex-1 text-sm font-semibold text-danger">{title}</div>
      </div>
      <pre className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-card p-2 text-[11px] leading-snug text-foreground">
        {detail}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onRetry}>
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
        </Button>
        {onUseAnyway && (
          <Button type="button" size="sm" variant="secondary" onClick={onUseAnyway}>
            <ImageIcon className="mr-1.5 h-3.5 w-3.5" /> Usar la foto sin OCR
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onCopy}>
          <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Copiar error
        </Button>
      </div>
    </div>
  );
}
