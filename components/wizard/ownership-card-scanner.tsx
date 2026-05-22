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
  RotateCw,
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  recognizeOwnershipCard,
  warmUpOcr,
} from "@/lib/client/ocr-ownership-card";
import { cn } from "@/lib/utils";

/**
 * Botón "Escanear tarjeta de propiedad" + flow de captura.
 *
 * Tres vías de input:
 *  - "Tomar foto" → cámara propia in-browser con `getUserMedia` + overlay
 *    horizontal proporción tarjeta (~1.585:1). Forzamos landscape para que
 *    el perito siempre capture la tarjeta con la orientación correcta y el
 *    OCR funcione mejor. Si `getUserMedia` falla o el permiso se niega,
 *    caemos al `<input capture>` nativo del sistema.
 *  - "Cámara del sistema" → `<input type="file" capture="environment">`
 *    como fallback explícito cuando la cámara propia no anda.
 *  - "Desde galería" → `<input type="file">` (sin capture) → picker normal.
 * Todas las vías terminan en `handleFile(file)` → `processBlob` → OCR.
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
  ownerDocument?: string;
  propertyCardStatus?: "Original" | "Duplicado";
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
  /** Cara que ESPERA capturar este scanner. Si el OCR detecta la cara
   *  contraria, mostramos un banner ofreciendo guardar la foto en la cara
   *  correcta (vía `onWrongSide`). Solo aplica cuando runOcr=true. */
  expectedSide?: "front" | "back";
  /** Callback opcional que se dispara cuando el perito decide aceptar la
   *  sugerencia "esta foto es del otro lado". Recibe el dataURL de la foto
   *  para guardarla en el slot correcto. Si no se provee, el banner solo
   *  muestra la advertencia sin botón de acción. */
  onWrongSide?: (imageDataUrl: string) => void;
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
  ownerDocument: "Doc. propietario",
  propertyCardStatus: "Tipo tarjeta",
};

const FUEL_LABELS: Record<NonNullable<ExtractedFields["fuel"]>, string> = {
  gasoline: "GASOLINA",
  diesel: "DIÉSEL",
  hybrid: "HÍBRIDO",
  electric: "ELÉCTRICO",
  gas: "GNV",
};

const TX_LABELS: Record<NonNullable<ExtractedFields["transmission"]>, string> = {
  manual: "MANUAL",
  automatic: "AUTOMÁTICA",
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

// Campos donde forzamos mayúsculas Y quitamos espacios al editar — códigos
// alfanuméricos donde el OCR suele equivocar 1 char (8↔B, 0↔O, 5↔S, etc).
const UPPER_ALPHANUM_FIELDS = new Set<keyof ExtractedFields>([
  "plate",
  "vin",
  "chassisNumber",
  "engineNumber",
]);

// Campos de texto libre que renderizamos en mayúsculas (sin quitar espacios)
// para que coincidan con cómo está impresa la tarjeta y con los selects del
// formulario, que ahora también están en mayúsculas.
const UPPER_TEXT_FIELDS = new Set<keyof ExtractedFields>([
  "make",
  "model",
  "color",
  "bodyType",
  "vehicleClass",
  "nationality",
  "serviceType",
  "owner",
  "propertyCardStatus",
]);

// Campos puramente numéricos. inputMode="numeric" abre teclado numérico en
// móvil y filtramos no-dígitos en el onChange.
const NUMERIC_FIELDS = new Set<keyof ExtractedFields>([
  "licenseNumber",
  "year",
  "cylinderCapacity",
]);

// Hint visible debajo del input para campos con formato esperado conocido. Le
// ayuda al perito a detectar errores de OCR (p.ej. VIN debería tener 17 chars).
const FIELD_HINTS: Partial<Record<keyof ExtractedFields, string>> = {
  vin: "17 caracteres, sin I/O/Q",
  chassisNumber: "Suele coincidir con el VIN",
  year: "4 dígitos",
  plate: "Formato ABC123 o ABC12D",
};

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

/**
 * Aplica una corrección de fondo adaptativa in-place a un buffer grayscale:
 * para cada pixel, le resta el promedio de luminancia de un entorno cuadrado y
 * recentra en 128. El radio se escala con el tamaño de la imagen (~3% del lado
 * menor) para que el blur capture el "fondo" sin tragarse los glyphs.
 *
 * Usa integral image (summed-area table) para que el cálculo sea O(N) sin
 * importar el radio. En una imagen 1500×1000 el costo total es <50ms.
 */
function applyAdaptiveBackground(
  lumas: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  if (width < 8 || height < 8) return;
  // Integral image: integral[(y)*(W+1) + (x)] = suma de lumas[0..y-1][0..x-1].
  // Le agregamos 1 columna/fila de ceros al inicio para evitar el if de borde.
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOut = (y + 1) * stride;
    const rowOutPrev = y * stride;
    const rowIn = y * width;
    for (let x = 0; x < width; x++) {
      rowSum += lumas[rowIn + x];
      integral[rowOut + (x + 1)] = integral[rowOutPrev + (x + 1)] + rowSum;
    }
  }
  // Radio: ~3% del lado menor, mínimo 8, máximo 60. Demasiado chico → el
  // background "sigue" los glyphs y se pierde detalle. Demasiado grande → no
  // corrige iluminación local. 3% es un punto medio probado para tarjetas.
  const radius = Math.min(60, Math.max(8, Math.round(Math.min(width, height) * 0.03)));
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    const rowOut = y * width;
    const idxY0 = y0 * stride;
    const idxY1 = y1 * stride;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const area = (x1 - x0) * (y1 - y0);
      const sum =
        integral[idxY1 + x1] -
        integral[idxY0 + x1] -
        integral[idxY1 + x0] +
        integral[idxY0 + x0];
      const mean = sum / area;
      // Recentrado: cualquier desviación del fondo local se preserva.
      const v = lumas[rowOut + x] - mean + 128;
      lumas[rowOut + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

async function resizeBlob(
  blob: Blob,
  maxDim = 2000,
  ocrMaxDim = 1500,
): Promise<{
  previewUrl: string;
  ocrBlob: Blob;
}> {
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
  const compressed = canvas.toDataURL("image/jpeg", 0.92);
  const match = compressed.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!match) throw new Error("No se pudo codificar la imagen.");

  // Versión optimizada para Tesseract: más chica (procesa más rápido),
  // grayscale + contrast stretch para que el OCR no se ahogue interpretando
  // píxeles con poco contraste. Esta NO se guarda ni se muestra — sólo
  // viaja al endpoint /api/ocr/ownership-card.
  const ocrRatio = Math.min(1, ocrMaxDim / Math.max(srcW, srcH));
  const ow = Math.max(1, Math.round(srcW * ocrRatio));
  const oh = Math.max(1, Math.round(srcH * ocrRatio));
  const ocrCanvas = document.createElement("canvas");
  ocrCanvas.width = ow;
  ocrCanvas.height = oh;
  const octx = ocrCanvas.getContext("2d");
  if (!octx) throw new Error("No se pudo crear el canvas OCR.");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(source, 0, 0, ow, oh);

  // Liberar el bitmap si aplica (createImageBitmap path)
  if ("close" in source && typeof source.close === "function") {
    try {
      source.close();
    } catch {
      /* noop */
    }
  }

  const img = octx.getImageData(0, 0, ow, oh);
  const data = img.data;
  const total = data.length >> 2;
  const lumas = new Uint8ClampedArray(total);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    lumas[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // Normalización adaptativa de iluminación: una tarjeta fotografiada con luz
  // despareja (sombra en una esquina, brillo en otra) genera glyphs oscuros
  // sobre fondo oscuro en una zona y casi blancos en otra. El stretch global
  // por percentiles que sigue NO arregla eso — al contrario, agrava la zona
  // mal iluminada porque comprime todo al mismo rango.
  //
  // Solución: restamos a cada pixel el promedio local de su entorno (background
  // estimado vía blur grande) y recentramos en 128. El detalle fino (bordes de
  // letras) sobrevive porque difiere mucho del promedio local; los gradientes
  // de iluminación se planchan porque el background los sigue. Implementado
  // con integral image — O(N), <50ms en 1500×1000.
  applyAdaptiveBackground(lumas, ow, oh);

  // Stretch lineal de contraste usando percentiles 2/98 — descarta sombras y
  // brillos extremos y reasigna el resto al rango [0,255]. Después del paso
  // adaptativo de arriba, el stretch trabaja sobre una imagen ya nivelada y
  // expande el rango dinámico real de los glyphs.
  const hist = new Array(256).fill(0);
  for (let i = 0; i < total; i++) hist[lumas[i]]++;
  const cutLo = Math.floor(total * 0.02);
  const cutHi = Math.floor(total * 0.98);
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= cutLo) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= cutHi) {
      hi = i;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, Math.round(((lumas[j] - lo) * 255) / range)));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  octx.putImageData(img, 0, 0);

  // Padding blanco alrededor de la imagen procesada antes de mandarla al OCR.
  // Tesseract pierde precisión con glyphs pegados al borde — típico cuando el
  // perito enmarca la tarjeta muy ajustada y los últimos dígitos del número
  // de licencia o el último carácter del VIN quedan rozando el margen. Una
  // banda blanca de ~5% del lado menor (mínimo 40px) le da al motor el
  // "respiro" que necesita para detectar todos los chars. El padding NO afecta
  // el preview que ve el perito ni la evidencia guardada — solo la imagen que
  // viaja al recognizer.
  const pad = Math.max(40, Math.round(Math.min(ow, oh) * 0.05));
  const paddedCanvas = document.createElement("canvas");
  paddedCanvas.width = ow + pad * 2;
  paddedCanvas.height = oh + pad * 2;
  const pctx = paddedCanvas.getContext("2d");
  if (!pctx) throw new Error("No se pudo crear el canvas con padding OCR.");
  pctx.fillStyle = "#ffffff";
  pctx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
  pctx.drawImage(ocrCanvas, pad, pad);

  const ocrBlob = await new Promise<Blob>((resolve, reject) =>
    paddedCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("No se pudo codificar la imagen para OCR."))),
      "image/jpeg",
      0.9,
    ),
  );

  // Match se mantiene por compatibilidad — el data URL todavía se usa para
  // el preview en el dialog (ya armado arriba como `compressed`).
  void match;

  return {
    previewUrl: compressed,
    ocrBlob,
  };
}

export function OwnershipCardScanner({
  onApply,
  runOcr = true,
  buttonLabel = "Escanear tarjeta de propiedad",
  buttonLabelShort = "Escanear tarjeta",
  expectedSide,
  onWrongSide,
}: Props) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);
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
  const [progress, setProgress] = React.useState<{ status: string; pct: number } | null>(null);
  const [fields, setFields] = React.useState<ExtractedFields | null>(null);
  // Keys que se muestran como editables — se fija cuando llega el resultado del
  // OCR y NO cambia aunque el perito vacíe un input. Sin esto, escribir y
  // borrar un campo lo hacía desaparecer de la lista (no podía recuperarlo).
  const [shownKeys, setShownKeys] = React.useState<(keyof ExtractedFields)[]>([]);
  const [excluded, setExcluded] = React.useState<Set<keyof ExtractedFields>>(new Set());
  // Cara detectada por el OCR — frente, reverso o desconocido. Lo usamos para
  // mostrar un banner de advertencia si no coincide con `expectedSide`.
  const [detectedSide, setDetectedSide] = React.useState<
    "front" | "back" | "unknown" | null
  >(null);
  // Error inline dentro del dialog. Lo mostramos en una card con copy-to-clipboard
  // así el perito puede leerlo (los toasts se descartan demasiado rápido).
  const [errorDetail, setErrorDetail] = React.useState<{
    title: string;
    detail: string;
    status?: number;
  } | null>(null);

  // Cámara propia in-browser. `cameraLive` activa el overlay con video stream;
  // el stream y el video viven en refs porque setSrcObject del video requiere
  // referencia directa al DOM (no se puede pasar como prop reactiva).
  const [cameraLive, setCameraLive] = React.useState(false);
  const [cameraStarting, setCameraStarting] = React.useState(false);
  const [isPortrait, setIsPortrait] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const stopLiveCamera = React.useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraLive(false);
    setCameraStarting(false);
  }, []);

  function reset() {
    setPreviewUrl(null);
    setFields(null);
    setExcluded(new Set());
    setShownKeys([]);
    setDetectedSide(null);
    setBusy(false);
    setErrorDetail(null);
    stopLiveCamera();
  }

  const close = React.useCallback(() => {
    setOpen(false);
    // Defer reset hasta que termine la animación de cierre
    window.setTimeout(reset, 200);
    // `reset` es estable dentro del scope del componente — no necesita estar
    // en deps. La regla no puede inferirlo desde una function declaration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup al desmontar
  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      const stream = streamRef.current;
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, []);

  // Detectar orientación del dispositivo mientras la cámara está activa. Si
  // está en portrait, mostramos un hint para rotar — la tarjeta entra mejor en
  // landscape y el OCR rinde mejor con mayor resolución horizontal.
  React.useEffect(() => {
    if (!cameraLive || typeof window === "undefined") return;
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [cameraLive]);

  // Si el dialog se cierra (X o backdrop), garantizamos que el stream se libere.
  // Sin esto la cámara puede quedar encendida en background — el indicador del
  // navegador se queda prendido y consume batería.
  React.useEffect(() => {
    if (!open) stopLiveCamera();
  }, [open, stopLiveCamera]);

  async function startLiveCamera() {
    if (cameraStarting) return;
    // Si el browser no soporta getUserMedia, caemos directo al input capture.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }
    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 },
        },
      });
      if (!mountedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      setCameraLive(true);
      // Esperamos al próximo tick para que el <video> esté montado y
      // podamos setear el srcObject sobre el ref.
      queueMicrotask(() => {
        const video = videoRef.current;
        if (video && streamRef.current) {
          video.srcObject = streamRef.current;
          void video.play().catch(() => {
            /* Algunos navegadores devuelven NotAllowedError si la pestaña
             * está en background — silencioso, el user verá frame congelado
             * y puede tocar Capturar igual. */
          });
        }
      });
    } catch (err) {
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      const description = denied
        ? "Permiso de cámara denegado. Otórgalo en los ajustes del navegador, o usa la cámara del sistema."
        : "No pudimos abrir la cámara. Prueba con la cámara del sistema o sube la foto desde galería.";
      toast.show({
        title: "Cámara no disponible",
        description,
        variant: "warning",
      });
    } finally {
      if (mountedRef.current) setCameraStarting(false);
    }
  }

  async function captureFromLiveCamera() {
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, vw, vh);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    stopLiveCamera();
    if (!blob) {
      toast.show({
        title: "No se pudo capturar el frame",
        variant: "warning",
      });
      return;
    }
    const file = new File([blob], "tarjeta.jpg", { type: "image/jpeg" });
    await handleFile(file);
  }

  function openScanner() {
    setOpen(true);
    // Pre-cargá Tesseract en background mientras el perito elige la foto: así
    // cuando dispare el recognize, el wasm y el lang pack ya están listos.
    if (runOcr) warmUpOcr();
  }

  async function handleFile(file: File) {
    await processBlob(file);
  }

  async function processBlob(input: Blob) {
    // Cancelamos un OCR previo si el usuario reintentó rápido.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setFields(null);
    setExcluded(new Set());
    setShownKeys([]);
    setDetectedSide(null);
    setErrorDetail(null);
    // Limpiamos cualquier preview de un intento previo. Sin esto, si la
    // captura anterior se ejecutó pero la nueva falla en resizeBlob, el
    // ErrorPanel mostraría la foto VIEJA bajo el botón "Usar la foto sin
    // OCR" — y guardaríamos la imagen incorrecta como evidencia.
    setPreviewUrl(null);
    setProgress({ status: "Preparando imagen…", pct: 0 });
    try {
      const { previewUrl, ocrBlob } = await resizeBlob(input);
      if (!mountedRef.current || controller.signal.aborted) return;
      setPreviewUrl(previewUrl);
      if (!runOcr) {
        // Modo "solo captura" (reverso): no corremos OCR, dejamos los
        // campos vacíos y mostramos preview lista para Aplicar.
        setFields({});
        return;
      }
      setProgress({ status: "Leyendo la tarjeta…", pct: 0.05 });
      const {
        fields: detected,
        side: detectedSideResult,
      } = await recognizeOwnershipCard(ocrBlob, {
          signal: controller.signal,
          onProgress: ({ status, progress }) => {
            if (!mountedRef.current || controller.signal.aborted) return;
            setProgress({
              status:
                status === "recognizing text"
                  ? "Leyendo la tarjeta…"
                  : status === "loading language traineddata"
                    ? "Descargando reconocedor (sólo la primera vez)…"
                    : status === "initializing api"
                      ? "Inicializando OCR…"
                      : "Procesando…",
              pct: Math.max(0.05, Math.min(0.99, progress)),
            });
          },
        });
      if (!mountedRef.current || controller.signal.aborted) return;
      setFields(detected);
      setDetectedSide(detectedSideResult);
      const initialKeys = (Object.keys(detected) as (keyof ExtractedFields)[]).filter(
        (k) => {
          // El parser nuevo (VehicleFormFields) es un subset estructural de
          // ExtractedFields, así que algunos keys del Set no existen en runtime
          // — el `!= null` los descarta naturalmente.
          const v = (detected as Record<string, unknown>)[k];
          return v != null && v !== "";
        },
      );
      setShownKeys(initialKeys);
      const count = initialKeys.length;
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
      if (mountedRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  function cancelProcessing() {
    abortRef.current?.abort();
    setBusy(false);
    setProgress(null);
    setPreviewUrl(null);
    setFields(null);
  }

  function retake() {
    setPreviewUrl(null);
    setFields(null);
    setExcluded(new Set());
    setShownKeys([]);
    setDetectedSide(null);
    setErrorDetail(null);
  }

  function toggleExclude(key: keyof ExtractedFields) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updateField<K extends keyof ExtractedFields>(
    key: K,
    value: ExtractedFields[K] | undefined,
  ) {
    setFields((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (value == null || value === "") {
        // Mantenemos la key en `shownKeys` pero seteamos undefined — así el
        // input sigue visible y vacío, y al aplicar simplemente no se manda.
        next[key] = undefined as ExtractedFields[K];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function sanitizeInputValue(
    key: keyof ExtractedFields,
    raw: string,
  ): string {
    let v = raw;
    if (UPPER_ALPHANUM_FIELDS.has(key)) {
      v = v.toUpperCase().replace(/\s+/g, "");
    } else if (UPPER_TEXT_FIELDS.has(key)) {
      v = v.toUpperCase();
    }
    if (NUMERIC_FIELDS.has(key)) {
      v = v.replace(/[^0-9]/g, "");
    }
    return v;
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
          ? "Revisa los campos antes de continuar."
          : "Completa los datos del vehículo a mano.",
      variant: "success",
    });
    close();
  }

  // Keys que se renderizan en el panel — usamos `shownKeys` (capturado cuando
  // llegó el resultado del OCR) para que vaciar un input no haga desaparecer
  // la fila. Para detectar "no se extrajo nada" usamos los valores actuales.
  const renderKeys = shownKeys;
  const nonEmptyKeys = fields
    ? renderKeys.filter((k) => {
        const v = fields[k];
        return v != null && v !== "" && !excluded.has(k);
      })
    : [];
  const hasDetections = renderKeys.length > 0;

  const showCamera = !previewUrl && !fields && !busy && !cameraLive;

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
            setOpen(true);
            if (runOcr) warmUpOcr();
            void handleFile(file);
          }
        }}
      />
      {/* Segundo input con capture=environment — en móvil dispara la cámara
          trasera del sistema en vez de abrir el picker de galería. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            setOpen(true);
            if (runOcr) warmUpOcr();
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
        {/* Layout flex con header/footer pegados y middle scrolleable. Sin
            esto, cuando el OCR detecta 10+ campos editables el contenido se
            desbordaba debajo del viewport y no se llegaba a los botones de
            "Aplicar"/"Cancelar". Con max-h:92dvh el dialog respeta el alto
            visible (incluye safe-area en móvil), y solo el área central
            scrollea. */}
        <DialogContent className="flex max-h-[92dvh] max-w-lg flex-col gap-3 p-4 sm:p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              {previewUrl || fields || busy ? "Tarjeta escaneada" : "Escanear tarjeta"}
            </DialogTitle>
            <DialogDescription>
              {showCamera
                ? "Toma una foto con la cámara o sube una desde galería — el OCR extrae los datos en tu mismo dispositivo."
                : "Revisa los datos detectados antes de aplicarlos al formulario."}
            </DialogDescription>
          </DialogHeader>

          {/* Cuerpo scrolleable. -mx + px compensa para que la scrollbar viva
              al borde del dialog sin recortar el contenido. pb-1 evita que el
              focus ring del último input se corte arriba del footer. */}
          <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
            {showCamera && (
              <div className="space-y-3">
                <div className="rounded-md border border-dashed bg-muted/30 p-5 text-center">
                  <ScanLine className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Escaneá la tarjeta</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    Tomá la foto con el celular en horizontal, buena luz y sin
                    reflejos. Encuadrá la tarjeta dentro del marco blanco.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={startLiveCamera}
                  size="lg"
                  className="w-full"
                  disabled={cameraStarting}
                >
                  {cameraStarting ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="mr-1.5 h-4 w-4" />
                  )}{" "}
                  {cameraStarting ? "Abriendo cámara…" : "Tomar foto"}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <Camera className="mr-1.5 h-4 w-4" /> Cámara del sistema
                  </Button>
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <ImageIcon className="mr-1.5 h-4 w-4" /> Desde galería
                  </Button>
                </div>
              </div>
            )}

            {cameraLive && (
              <div className="space-y-3">
                {isPortrait && (
                  <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                    <RotateCw className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      <strong>Rotá el teléfono en horizontal</strong> — la
                      tarjeta cabe completa y el OCR funciona mejor.
                    </span>
                  </div>
                )}
                <div className="relative aspect-video overflow-hidden rounded-md bg-black">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="h-full w-full object-cover"
                  />
                  {/* Marco horizontal con proporción de la tarjeta (ID-1:
                   *  85.60 × 53.98 mm ≈ 1.585:1). El shadow expande el
                   *  oscurecido a todo el viewport para que el marco recorte
                   *  visualmente el área de captura. */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div
                      className="rounded-md border-2 border-white/85"
                      style={{
                        aspectRatio: "1.585 / 1",
                        width: "82%",
                        boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={stopLiveCamera}
                    size="lg"
                  >
                    <X className="mr-1.5 h-4 w-4" /> Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={captureFromLiveCamera}
                    size="lg"
                  >
                    <Camera className="mr-1.5 h-4 w-4" /> Capturar
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

            {/* Banner de cara equivocada: si esperábamos frente y el OCR
                detectó reverso (o viceversa), avisamos. Si hay onWrongSide,
                ofrecemos un botón para guardar la foto directo en el slot
                correcto, sin obligar al perito a re-tomar la foto. */}
            {!busy &&
              previewUrl &&
              expectedSide &&
              detectedSide &&
              detectedSide !== "unknown" &&
              detectedSide !== expectedSide && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <div className="mb-1 flex items-start gap-2 font-medium text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Esta foto parece ser el{" "}
                      {detectedSide === "back" ? "REVERSO" : "FRENTE"} de la
                      tarjeta
                    </span>
                  </div>
                  <p className="ml-6 text-xs leading-snug text-warning/90">
                    {expectedSide === "front"
                      ? "Este botón es para el FRENTE (extrae los datos por OCR)."
                      : "Este botón es para el REVERSO (solo evidencia, sin OCR)."}{" "}
                    {onWrongSide
                      ? "Puedes guardarla en el slot correcto con un click."
                      : "Cancela y usa el otro botón."}
                  </p>
                  {onWrongSide && (
                    <div className="mt-2 ml-6">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          onWrongSide(previewUrl);
                          toast.show({
                            title:
                              detectedSide === "back"
                                ? "Guardado como reverso"
                                : "Guardado como frente",
                            variant: "success",
                          });
                          close();
                        }}
                      >
                        Guardar como{" "}
                        {detectedSide === "back" ? "reverso" : "frente"}
                      </Button>
                    </div>
                  )}
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
              <div className="space-y-2 rounded-md border bg-muted/40 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span className="flex-1 truncate">
                    {progress?.status ??
                      (runOcr ? "Leyendo la tarjeta..." : "Procesando imagen...")}
                  </span>
                  {progress ? (
                    <span className="tabular-nums text-xs font-medium">
                      {Math.round(progress.pct * 100)}%
                    </span>
                  ) : null}
                </div>
                {progress ? (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width] duration-200"
                      style={{ width: `${Math.round(progress.pct * 100)}%` }}
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={cancelProcessing}
                  className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Cancelar
                </button>
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
              ) : !hasDetections ? (
                // OCR corrió pero no detectó nada. En vez de bloquear, ofrecemos
                // continuar a mano — la foto igual sirve como evidencia.
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    No detecté datos en la tarjeta
                  </div>
                  <p className="mt-1 text-xs leading-snug text-warning/90">
                    Prueba con una foto más nítida o mejor iluminada. Si quieres, puedes
                    igual guardar la foto como evidencia y completar los campos a mano.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border bg-card">
                  <div className="border-b px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                    <div className="font-medium uppercase tracking-wider">
                      {renderKeys.length} campo{renderKeys.length === 1 ? "" : "s"} detectado
                      {renderKeys.length === 1 ? "" : "s"}
                    </div>
                    <div className="mt-0.5 normal-case tracking-normal">
                      Revisá y corregí lo que el OCR haya leído mal antes de aplicar.
                    </div>
                  </div>
                  <ul className="divide-y">
                    {renderKeys.map((k) => {
                      const isExcluded = excluded.has(k);
                      return (
                        <li
                          key={k}
                          className={cn(
                            "px-3 py-2 transition-colors",
                            isExcluded && "opacity-50",
                          )}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <label
                              htmlFor={`ocr-field-${k}`}
                              className="text-[11px] uppercase tracking-wide text-muted-foreground"
                            >
                              {FIELD_LABELS[k]}
                            </label>
                            <button
                              type="button"
                              onClick={() => toggleExclude(k)}
                              className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground underline-offset-2 hover:underline"
                            >
                              {isExcluded ? "Incluir" : "Omitir"}
                            </button>
                          </div>
                          <FieldEditor
                            fieldKey={k}
                            value={fields[k]}
                            disabled={isExcluded}
                            onChange={(v) => updateField(k, v)}
                            sanitize={sanitizeInputValue}
                          />
                          {FIELD_HINTS[k] && !isExcluded && (
                            <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                              {FIELD_HINTS[k]}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )
            ) : null}

          </div>

          {/* Footer fijo: no scrollea con el cuerpo. shrink-0 evita que se
              colapse cuando el cuerpo es muy alto. border-t + pt-3 separa
              visualmente del contenido scrolleado de arriba. */}
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
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
                : nonEmptyKeys.length === 0
                  ? "Guardar foto y completar a mano"
                  : "Aplicar datos al formulario"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FieldEditor({
  fieldKey,
  value,
  disabled,
  onChange,
  sanitize,
}: {
  fieldKey: keyof ExtractedFields;
  value: ExtractedFields[keyof ExtractedFields];
  disabled?: boolean;
  onChange: (next: ExtractedFields[keyof ExtractedFields] | undefined) => void;
  sanitize: (key: keyof ExtractedFields, raw: string) => string;
}) {
  if (fieldKey === "fuel") {
    return (
      <Select
        value={(value as string | undefined) ?? ""}
        onValueChange={(v) =>
          onChange((v as NonNullable<ExtractedFields["fuel"]>) || undefined)
        }
        disabled={disabled}
      >
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Seleccionar" />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(FUEL_LABELS) as [
            NonNullable<ExtractedFields["fuel"]>,
            string,
          ][]).map(([k, label]) => (
            <SelectItem key={k} value={k}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (fieldKey === "transmission") {
    return (
      <Select
        value={(value as string | undefined) ?? ""}
        onValueChange={(v) =>
          onChange(
            (v as NonNullable<ExtractedFields["transmission"]>) || undefined,
          )
        }
        disabled={disabled}
      >
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Seleccionar" />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(TX_LABELS) as [
            NonNullable<ExtractedFields["transmission"]>,
            string,
          ][]).map(([k, label]) => (
            <SelectItem key={k} value={k}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (fieldKey === "propertyCardStatus") {
    return (
      <Select
        value={(value as string | undefined) ?? ""}
        onValueChange={(v) =>
          onChange(
            (v as NonNullable<ExtractedFields["propertyCardStatus"]>) ||
              undefined,
          )
        }
        disabled={disabled}
      >
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Seleccionar" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Original">ORIGINAL</SelectItem>
          <SelectItem value="Duplicado">DUPLICADO</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  const stringValue = value == null ? "" : String(value);
  const isNumeric = NUMERIC_FIELDS.has(fieldKey);
  const isAlphanumCode = UPPER_ALPHANUM_FIELDS.has(fieldKey);
  const isUpperText = UPPER_TEXT_FIELDS.has(fieldKey);
  const isUpper = isAlphanumCode || isUpperText;
  return (
    <Input
      id={`ocr-field-${fieldKey}`}
      value={stringValue}
      disabled={disabled}
      inputMode={isNumeric ? "numeric" : undefined}
      autoCapitalize={isUpper ? "characters" : undefined}
      autoCorrect="off"
      spellCheck={false}
      className={cn(
        "h-9 text-sm",
        isAlphanumCode && "font-mono tracking-wide uppercase",
        isUpperText && "uppercase",
      )}
      onChange={(e) => {
        const cleaned = sanitize(fieldKey, e.target.value);
        onChange((cleaned || undefined) as ExtractedFields[keyof ExtractedFields]);
      }}
    />
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
