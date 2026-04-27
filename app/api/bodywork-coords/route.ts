import { NextResponse } from "next/server";

import {
  normalizeCoords,
  readBodyworkCoords,
  writeBodyworkCoords,
} from "@/lib/bodywork-coords";

export const runtime = "nodejs";

function validSlug(s: string | null): s is string {
  return !!s && /^[a-z0-9-]+$/.test(s) && s.length <= 120;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (!validSlug(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }
  const coords = await readBodyworkCoords(slug);
  if (!coords) return NextResponse.json({ status: "missing" }, { status: 404 });
  return NextResponse.json({ status: "ready", coords });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const slug = (body as { slug?: unknown }).slug;
  if (typeof slug !== "string" || !validSlug(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }
  const coords = normalizeCoords(body, slug);
  if (!coords) {
    return NextResponse.json({ error: "invalid coords" }, { status: 400 });
  }
  await writeBodyworkCoords(coords);
  return NextResponse.json({ status: "saved", coords });
}
