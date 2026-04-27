import Link from "next/link";

import {
  allBodyworkPanelIds,
  imageExistsForSlug,
  readBodyworkCoords,
} from "@/lib/bodywork-coords";
import { BODYWORK_SECTION } from "@/lib/constants";

import { CalibrateClient, type PanelMeta } from "./calibrate-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function flatPanels(): PanelMeta[] {
  const out: PanelMeta[] = [];
  for (const g of BODYWORK_SECTION.groups) {
    for (const i of g.items) {
      out.push({ id: i.id, label: i.label, group: g.label });
    }
  }
  return out;
}

export default async function CalibrateBodyworkPage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = params.slug;
  const hasImage = await imageExistsForSlug(slug);
  const existing = hasImage ? await readBodyworkCoords(slug) : null;
  const panels = flatPanels();
  const allIds = allBodyworkPanelIds();

  if (!hasImage) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <h1 className="text-xl font-semibold">Imagen no encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No existe una imagen generada para <code className="font-mono">{slug}</code>.
          Vuelve al peritaje y completa marca, modelo y año para generarla.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Volver
        </Link>
      </div>
    );
  }

  return (
    <CalibrateClient
      slug={slug}
      imageUrl={`/generated/bodywork/${slug}.png`}
      panels={panels}
      allPanelIds={allIds}
      initial={existing}
    />
  );
}
