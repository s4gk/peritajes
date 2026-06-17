import "server-only";

import type { CardSide } from "@/lib/licenciaTransitoParser";

/**
 * Extracción de la tarjeta de propiedad / licencia de tránsito colombiana con
 * un modelo de visión (GPT-4o por defecto). Alternativa al OCR Tesseract:
 * mucho más robusto a fotos torcidas, mal iluminadas o a la tarjeta plástica
 * RUNT (layout distinto al de papel), porque el modelo "entiende" el documento
 * en vez de depender de leer las etiquetas y alinear columnas.
 *
 * Activo cuando `OPENAI_API_KEY` está en el entorno. La ruta
 * /api/ocr/ownership-card lo usa como proveedor primario y cae a Tesseract si
 * no está configurado. Usamos fetch crudo (sin SDK) para no sumar dependencia,
 * igual que los clientes de WhatsApp.
 *
 * Trade-off: la imagen SALE del dispositivo hacia OpenAI y cada escaneo cuesta
 * (centavos). El cliente decidió que es aceptable para este caso de uso.
 *
 * Variables de entorno:
 *   OPENAI_API_KEY      (obligatoria para activar)
 *   OPENAI_OCR_MODEL    (opcional, default "gpt-4o")
 */

const OPENAI_API = "https://api.openai.com/v1/chat/completions";

function apiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function model(): string {
  return process.env.OPENAI_OCR_MODEL?.trim() || "gpt-4o";
}

export function isVisionOcrConfigured(): boolean {
  return !!apiKey();
}

/** Campos que devuelve el extractor — mismo shape que `ExtractedFields` del
 *  scanner, para que la UI los consuma sin transformación. */
export type VisionOcrFields = {
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

export type VisionOcrResult = {
  fields: VisionOcrFields;
  side: CardSide;
};

const SYSTEM_PROMPT = `Eres un extractor de datos de la LICENCIA DE TRÁNSITO / TARJETA DE PROPIEDAD vehicular colombiana (Ministerio de Transporte / RUNT). Recibes la foto de UNA cara de la tarjeta (puede ser papel o plástico).

Reglas estrictas:
- Devuelve SOLO los campos que puedas leer con certeza. Si un campo no aparece o no lo puedes leer con seguridad, déjalo como cadena vacía "". NUNCA inventes ni completes con suposiciones.
- Transcribe los códigos alfanuméricos (placa, VIN/serial, chasis, motor) EXACTAMENTE como están impresos, en MAYÚSCULAS y SIN espacios.
- "placa": formato carro AAA000 (3 letras + 3 dígitos) o moto AAA00A.
- "vin": 17 caracteres. Si la tarjeta lo trae censurado (asteriscos ****) déjalo "".
- "year": SOLO el año-modelo del vehículo, 4 dígitos. No confundir con fechas de expedición.
- "cylinderCapacity": cilindraje en cc, solo dígitos (sin separadores de miles).
- "fuel": mapea a uno de: gasoline, diesel, hybrid, electric, gas (GNV/GLP/gas natural → gas). Si no aparece, "".
- "transmission": mapea a manual, automatic, cvt o dct. Si no aparece, "".
- "serviceType", "vehicleClass", "bodyType", "make", "model", "color", "owner", "nationality": en MAYÚSCULAS, tal como están impresos.
- "ownerDocument": cédula o NIT del propietario, SOLO dígitos (sin "C.C." ni puntos).
- "propertyCardStatus": "Original" o "Duplicado" si la tarjeta lo indica, si no "".
- "side": "front" si ves el encabezado oficial (MINISTERIO DE TRANSPORTE / REPÚBLICA DE COLOMBIA / LICENCIA DE TRÁNSITO) con los datos del vehículo; "back" si es el reverso (OBSERVACIONES, LIMITACIONES, TRASPASOS, sin datos estructurados); "unknown" si no estás seguro.`;

const JSON_SCHEMA = {
  name: "tarjeta_propiedad",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      plate: { type: "string" },
      licenseNumber: { type: "string" },
      vin: { type: "string" },
      chassisNumber: { type: "string" },
      engineNumber: { type: "string" },
      make: { type: "string" },
      model: { type: "string" },
      year: { type: "string" },
      color: { type: "string" },
      bodyType: { type: "string" },
      fuel: { type: "string", enum: ["gasoline", "diesel", "hybrid", "electric", "gas", ""] },
      transmission: { type: "string", enum: ["manual", "automatic", "cvt", "dct", ""] },
      vehicleClass: { type: "string" },
      nationality: { type: "string" },
      serviceType: { type: "string" },
      cylinderCapacity: { type: "string" },
      owner: { type: "string" },
      ownerDocument: { type: "string" },
      propertyCardStatus: { type: "string", enum: ["Original", "Duplicado", ""] },
      side: { type: "string", enum: ["front", "back", "unknown"] },
    },
    required: [
      "plate", "licenseNumber", "vin", "chassisNumber", "engineNumber",
      "make", "model", "year", "color", "bodyType", "fuel", "transmission",
      "vehicleClass", "nationality", "serviceType", "cylinderCapacity",
      "owner", "ownerDocument", "propertyCardStatus", "side",
    ],
  },
} as const;

// Campos que son códigos alfanuméricos: mayúsculas + sin espacios.
const CODE_FIELDS = new Set(["plate", "vin", "chassisNumber", "engineNumber"]);
// Campos puramente numéricos: solo dígitos.
const DIGIT_FIELDS = new Set(["licenseNumber", "year", "cylinderCapacity", "ownerDocument"]);

/** Limpia y descarta vacíos de la respuesta del modelo, dejando solo los
 *  campos con valor real y normalizados como el formulario los espera. */
function normalizeFields(raw: Record<string, unknown>): VisionOcrFields {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "side") continue;
    if (typeof value !== "string") continue;
    let v = value.trim();
    if (!v) continue;
    if (CODE_FIELDS.has(key)) v = v.toUpperCase().replace(/\s+/g, "");
    else if (DIGIT_FIELDS.has(key)) v = v.replace(/[^0-9]/g, "");
    if (!v) continue;
    out[key] = v;
  }
  return out as VisionOcrFields;
}

/**
 * Extrae los campos de la tarjeta a partir de un data URL de imagen
 * (`data:image/jpeg;base64,...`). Lanza si la API falla o devuelve algo
 * inesperado — el caller decide el fallback.
 */
export async function extractOwnershipCardVision(
  imageDataUrl: string,
): Promise<VisionOcrResult> {
  const key = apiKey();
  if (!key) throw new Error("OPENAI_API_KEY no configurada.");

  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      temperature: 0,
      max_tokens: 800,
      response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extrae los datos de esta tarjeta de propiedad. Devuelve cadena vacía en lo que no puedas leer con certeza.",
            },
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "high" },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* noop */
    }
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI devolvió una respuesta vacía.");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("OpenAI devolvió un JSON inválido.");
  }

  const side: CardSide =
    parsed.side === "front" || parsed.side === "back" ? parsed.side : "unknown";

  return { fields: normalizeFields(parsed), side };
}
