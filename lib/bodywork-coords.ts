import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { BODYWORK_SECTION } from "./constants";

const BODYWORK_DIR = path.join(process.cwd(), "public", "generated", "bodywork");

/** Normalized coordinate (0..1, origin top-left) for a panel callout anchor. */
export type PanelCoord = { x: number; y: number };

export type BodyworkCoords = {
  slug: string;
  calibratedAt: string;
  image?: { width: number; height: number };
  /** Panel id → coord, or null if the panel is not visible in this view (skip callout). */
  panels: Record<string, PanelCoord | null>;
};

export function allBodyworkPanelIds(): string[] {
  return BODYWORK_SECTION.groups.flatMap((g) => g.items.map((i) => i.id));
}

function isValidCoord(x: unknown): x is PanelCoord {
  if (!x || typeof x !== "object") return false;
  const c = x as { x: unknown; y: unknown };
  return (
    typeof c.x === "number" &&
    typeof c.y === "number" &&
    c.x >= 0 &&
    c.x <= 1 &&
    c.y >= 0 &&
    c.y <= 1
  );
}

export function normalizeCoords(input: unknown, slug: string): BodyworkCoords | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Partial<BodyworkCoords> & { panels?: unknown };
  const panels: Record<string, PanelCoord | null> = {};
  if (obj.panels && typeof obj.panels === "object") {
    for (const [id, value] of Object.entries(obj.panels as Record<string, unknown>)) {
      if (value === null) {
        panels[id] = null;
        continue;
      }
      if (isValidCoord(value)) {
        panels[id] = { x: value.x, y: value.y };
      }
    }
  }
  const image =
    obj.image &&
    typeof obj.image === "object" &&
    typeof (obj.image as { width: unknown }).width === "number" &&
    typeof (obj.image as { height: unknown }).height === "number"
      ? {
          width: (obj.image as { width: number }).width,
          height: (obj.image as { height: number }).height,
        }
      : undefined;
  return {
    slug,
    calibratedAt: new Date().toISOString(),
    image,
    panels,
  };
}

function coordsPath(slug: string): string {
  return path.join(BODYWORK_DIR, `${slug}.coords.json`);
}

export async function readBodyworkCoords(slug: string): Promise<BodyworkCoords | null> {
  const p = coordsPath(slug);
  try {
    await access(p, fsConstants.F_OK);
    const text = await readFile(p, "utf-8");
    const parsed = JSON.parse(text) as BodyworkCoords;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeBodyworkCoords(coords: BodyworkCoords): Promise<void> {
  await mkdir(BODYWORK_DIR, { recursive: true });
  await writeFile(coordsPath(coords.slug), JSON.stringify(coords, null, 2), "utf-8");
}

export async function imageExistsForSlug(slug: string): Promise<boolean> {
  const p = path.join(BODYWORK_DIR, `${slug}.png`);
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
