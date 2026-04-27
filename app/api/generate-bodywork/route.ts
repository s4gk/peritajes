import { NextResponse } from "next/server";

import {
  ImagenError,
  bodyworkSlug,
  generateBodyworkImage,
  getCachedBodyworkImage,
  type BodyworkImageInput,
} from "@/lib/imagen";

export const runtime = "nodejs";
// Image generation can take 20-40s upstream; allow headroom.
export const maxDuration = 90;

function readInput(raw: unknown): BodyworkImageInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const make = typeof obj.make === "string" ? obj.make : "";
  const model = typeof obj.model === "string" ? obj.model : "";
  const year = typeof obj.year === "string" ? obj.year : "";
  const bodyType =
    typeof obj.bodyType === "string" ? obj.bodyType : undefined;
  if (!make.trim() || !model.trim() || !year.trim()) return null;
  return { make, model, year, bodyType };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const input = readInput(body);
  if (!input) {
    return NextResponse.json(
      { error: "make, model and year are required" },
      { status: 400 },
    );
  }

  try {
    const result = await generateBodyworkImage(input);
    return NextResponse.json({
      status: "ready",
      url: result.url,
      slug: result.slug,
      cached: !result.fresh,
    });
  } catch (err) {
    const status = err instanceof ImagenError ? err.status : 500;
    const message = err instanceof Error ? err.message : "generation failed";
    return NextResponse.json(
      { status: "error", error: message },
      { status },
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input: BodyworkImageInput = {
    make: url.searchParams.get("make") || "",
    model: url.searchParams.get("model") || "",
    year: url.searchParams.get("year") || "",
    bodyType: url.searchParams.get("bodyType") || undefined,
  };
  if (!input.make || !input.model || !input.year) {
    return NextResponse.json(
      { error: "make, model and year are required" },
      { status: 400 },
    );
  }
  try {
    const cached = await getCachedBodyworkImage(input);
    if (cached) {
      return NextResponse.json({
        status: "ready",
        url: cached.url,
        slug: cached.slug,
        cached: true,
      });
    }
    return NextResponse.json({
      status: "missing",
      slug: bodyworkSlug(input),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "lookup failed";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
