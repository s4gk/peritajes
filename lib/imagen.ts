import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const BODYWORK_DIR = path.join(PUBLIC_DIR, "generated", "bodywork");

// Default to Gemini 2.5 Flash Image (Nano Banana) — free-tier friendly, same
// engine family Whisk uses for image gen. Override with IMAGEN_MODEL to upgrade:
//   nano-banana-pro-preview      — closer to Whisk Pro quality (free preview)
//   gemini-3-pro-image-preview   — highest quality preview
//   imagen-4.0-fast-generate-001 — paid, cheaper Imagen
//   imagen-4.0-generate-001      — paid, full Imagen 4
const DEFAULT_MODEL = "gemini-2.5-flash-image";

export type BodyworkImageInput = {
  make: string;
  model: string;
  year: string;
  bodyType?: string;
};

export type BodyworkImageResult = {
  /** Browser-relative path: /generated/bodywork/{slug}.png */
  url: string;
  /** Slug used as cache key */
  slug: string;
  /** Whether the image was just generated (false = cache hit) */
  fresh: boolean;
};

export class ImagenError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
    this.name = "ImagenError";
  }
}

export function bodyworkSlug(input: BodyworkImageInput): string {
  const parts = [input.make, input.model, input.year]
    .map((s) => (s || "").trim().toLowerCase())
    .filter(Boolean);
  if (parts.length < 3) {
    throw new ImagenError("make, model and year are required", 400);
  }
  return parts
    .join("-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPrompt(input: BodyworkImageInput): string {
  const vehicle = `${input.make} ${input.model} ${input.year}`.trim();
  const bodyHint = input.bodyType ? ` (${input.bodyType})` : "";
  return [
    `Photorealistic technical render of a ${vehicle}${bodyHint}, front three-quarter diagonal view.`,
    "Focus ONLY on the external body — no chassis, no engine, no interior, no cutaways, no transparency.",
    "Accurate proportions, realistic geometry, no distortion.",
    "Realistic materials: painted metal, glass reflections, soft studio lighting, high detail.",
    "Dark clean studio background (deep navy or black), centered composition.",
    "Clean unlabeled body — NO callouts, NO leader lines, NO arrows, NO text annotations, NO numbers, NO logos, NO license plate, NO watermark.",
    "The vehicle alone, ready to receive overlay annotations later.",
    "Square 1:1 aspect ratio.",
  ].join(" ");
}

export async function getCachedBodyworkImage(
  input: BodyworkImageInput,
): Promise<BodyworkImageResult | null> {
  const slug = bodyworkSlug(input);
  const filePath = path.join(BODYWORK_DIR, `${slug}.png`);
  try {
    await access(filePath, fsConstants.F_OK);
    return { url: `/generated/bodywork/${slug}.png`, slug, fresh: false };
  } catch {
    return null;
  }
}

function isImagenModel(model: string): boolean {
  return model.toLowerCase().startsWith("imagen");
}

async function callImagenPredict(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:predict?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1",
        personGeneration: "dont_allow",
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ImagenError(
      `Imagen ${res.status}: ${text.slice(0, 300)}`,
      res.status === 401 || res.status === 403 ? 401 : 502,
    );
  }
  const json = (await res.json()) as {
    predictions?: { bytesBase64Encoded?: string }[];
  };
  const b64 = json.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new ImagenError("Imagen returned no image bytes", 502);
  return b64;
}

async function callGeminiGenerateImage(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ImagenError(
      `Gemini image ${res.status}: ${text.slice(0, 300)}`,
      res.status === 401 || res.status === 403 ? 401 : 502,
    );
  }
  const json = (await res.json()) as {
    candidates?: {
      content?: {
        parts?: { inlineData?: { data?: string; mimeType?: string } }[];
      };
    }[];
  };
  const part = json.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData?.data,
  );
  const b64 = part?.inlineData?.data;
  if (!b64) throw new ImagenError("Gemini returned no image bytes", 502);
  return b64;
}

export async function generateBodyworkImage(
  input: BodyworkImageInput,
): Promise<BodyworkImageResult> {
  const cached = await getCachedBodyworkImage(input);
  if (cached) return cached;

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new ImagenError(
      "GOOGLE_API_KEY is not configured. Add it to .env.local.",
      501,
    );
  }

  const slug = bodyworkSlug(input);
  const model = process.env.IMAGEN_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(input);

  const b64 = isImagenModel(model)
    ? await callImagenPredict(prompt, model, apiKey)
    : await callGeminiGenerateImage(prompt, model, apiKey);

  await mkdir(BODYWORK_DIR, { recursive: true });
  const filePath = path.join(BODYWORK_DIR, `${slug}.png`);
  await writeFile(filePath, Buffer.from(b64, "base64"));

  return { url: `/generated/bodywork/${slug}.png`, slug, fresh: true };
}
