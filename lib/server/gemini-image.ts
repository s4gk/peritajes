import "server-only";

import { query } from "./db";

/**
 * Render fotorealista del vehículo para la portada del PDF.
 *
 * Llama a Gemini 2.5 Flash Image (Nano Banana) con el make/model/year y
 * cachea el resultado en Postgres para no pagar dos veces por la misma
 * combinación. La llave es (make, model, year) normalizado — el color del
 * vehículo periciado NO entra en el prompt: pedimos siempre acabado plata
 * neutro para maximizar cache hits. La portada es estética; el color real
 * del carro queda registrado en la tabla "Datos del vehículo".
 *
 * Costo: ~$0.04/imagen contra Gemini el primer ciclo. En peritajes repetidos
 * (Mazda 3 2018, Renault Sandero 2020, etc.) cae a $0.
 *
 * Best-effort: si Gemini falla, no hay GEMINI_API_KEY, o la imagen viene
 * vacía, retorna null y el PDF se renderiza sin la portada visual. Nunca
 * tira excepción al caller.
 */

const MODEL = "gemini-2.5-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type VehicleRenderInput = {
  make?: string;
  model?: string;
  year?: string;
  bodyType?: string;
};

type CachedRender = {
  image_b64: string;
  mime: string;
};

function normalize(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildCacheKey(v: VehicleRenderInput): string | null {
  const make = normalize(v.make);
  const model = normalize(v.model);
  const year = normalize(v.year);
  if (!make || !model || !year) return null;
  return `${make}|${model}|${year}`;
}

function buildPrompt(v: VehicleRenderInput): string {
  const make = (v.make ?? "").trim();
  const model = (v.model ?? "").trim();
  const year = (v.year ?? "").trim();
  const bodyType = (v.bodyType ?? "").trim();
  const bodySuffix = bodyType ? ` (${bodyType})` : "";
  return [
    `Photorealistic studio render of a ${year} ${make} ${model}${bodySuffix}.`,
    "Three-quarter front view, neutral metallic silver finish.",
    "Plain white seamless studio background, soft even lighting.",
    "Subtle floor contact shadow only. No people, no text, no logos, no watermark, no license plate text.",
    "Professional automotive product photography, ultra detailed, crisp.",
  ].join(" ");
}

async function readCache(cacheKey: string): Promise<CachedRender | null> {
  try {
    const r = await query<CachedRender>(
      `SELECT image_b64, mime FROM vehicle_renders WHERE cache_key = $1`,
      [cacheKey],
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function writeCache(
  cacheKey: string,
  v: VehicleRenderInput,
  prompt: string,
  image: CachedRender,
): Promise<void> {
  try {
    await query(
      `INSERT INTO vehicle_renders
         (cache_key, make, model, year, body_type, prompt, ai_model, image_b64, mime, cached_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (cache_key) DO NOTHING`,
      [
        cacheKey,
        (v.make ?? "").trim(),
        (v.model ?? "").trim(),
        (v.year ?? "").trim(),
        (v.bodyType ?? "").trim() || null,
        prompt,
        MODEL,
        image.image_b64,
        image.mime,
      ],
    );
  } catch {
    // Cache miss next time — caller already has the image.
  }
}

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
};

function extractImage(resp: GeminiResponse): CachedRender | null {
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const data = p.inlineData?.data ?? p.inline_data?.data;
    const mime = p.inlineData?.mimeType ?? p.inline_data?.mime_type;
    if (data && mime?.startsWith("image/")) {
      return { image_b64: data, mime };
    }
  }
  return null;
}

async function generate(prompt: string): Promise<CachedRender | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[vehicle-render] GEMINI_API_KEY no configurado — skip");
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.4,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // 429 = billing/quota (Gemini image gen es paid-only). 400 = prompt
      // rechazado. 5xx = transitorio. En todos los casos degradamos a PDF
      // sin portada, pero loggeamos el motivo para debugging.
      const body = await res.text().catch(() => "");
      console.warn(
        `[vehicle-render] Gemini ${res.status}: ${body.slice(0, 300)}`,
      );
      return null;
    }
    const json = (await res.json()) as GeminiResponse;
    const image = extractImage(json);
    if (!image) {
      console.warn(
        `[vehicle-render] Gemini 200 sin imagen — response: ${JSON.stringify(json).slice(0, 300)}`,
      );
    }
    return image;
  } catch (err) {
    console.warn(
      `[vehicle-render] error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Devuelve un data URL listo para embeber en <img>, o null si no se pudo
 * generar (sin key, falla, datos insuficientes). Nunca lanza.
 */
export async function getOrGenerateVehicleRender(
  v: VehicleRenderInput,
): Promise<string | null> {
  const cacheKey = buildCacheKey(v);
  if (!cacheKey) return null;

  const cached = await readCache(cacheKey);
  if (cached) {
    return `data:${cached.mime};base64,${cached.image_b64}`;
  }

  const prompt = buildPrompt(v);
  const generated = await generate(prompt);
  if (!generated) return null;

  await writeCache(cacheKey, v, prompt, generated);
  return `data:${generated.mime};base64,${generated.image_b64}`;
}
