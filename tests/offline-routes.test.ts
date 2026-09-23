import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  INSPECTION_SHELL_URL,
  inspectionIdFromPath,
  inspectionUrl,
} from "@/lib/offline-routes";
import { listOfflineAssets } from "@/lib/server/offline-manifest";

describe("inspectionIdFromPath", () => {
  test("saca el id del wizard", () => {
    expect(inspectionIdFromPath("/inspection/abc123")).toBe("abc123");
    expect(inspectionIdFromPath("/inspection/abc123/")).toBe("abc123");
    expect(inspectionIdFromPath(inspectionUrl("a b"))).toBe("a b");
  });
  test("rutas que no son del wizard o el cascarón → null", () => {
    expect(inspectionIdFromPath("/peritajes")).toBeNull();
    expect(inspectionIdFromPath("/inspection")).toBeNull();
    expect(inspectionIdFromPath("/inspection/a/b")).toBeNull();
    expect(inspectionIdFromPath(INSPECTION_SHELL_URL)).toBeNull();
    expect(inspectionIdFromPath(null)).toBeNull();
    expect(inspectionIdFromPath("/inspection/%E0%A4%A")).toBeNull();
  });
});

describe("listOfflineAssets", () => {
  test("lista .next/static, sin source maps", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "perito-manifest-"));
    const f = (rel: string) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), "x");
    };
    f(".next/static/chunks/app/page-abc.js");
    f(".next/static/chunks/app/page-abc.js.map");
    f(".next/static/css/app.css");
    f(".next/static/chunks/app/(panel)/inspection/[id]/page-x.js");
    f(".next/static/BUILDID/_buildManifest.js");
    f("public/tessdata/spa.traineddata.gz");
    f("public/logo.jpg");
    expect(await listOfflineAssets(root)).toEqual([
      "/_next/static/BUILDID/_buildManifest.js",
      "/_next/static/chunks/app/(panel)/inspection/%5Bid%5D/page-x.js",
      "/_next/static/chunks/app/page-abc.js",
      "/_next/static/css/app.css",
    ]);
  });
  test("sin build no revienta", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "perito-manifest-"));
    expect(await listOfflineAssets(root)).toEqual([]);
  });
});

describe("ocrAssetUrls", () => {
  test("con el core del celular precachea solo ese; sin pista, las tres variantes", async () => {
    const { ocrAssetUrls, TESSERACT_BASE } = await import("@/lib/ocr-assets");
    const one = ocrAssetUrls("tesseract-core-simd-lstm.wasm.js");
    expect(one).toEqual([
      `${TESSERACT_BASE}/worker.min.js`,
      `${TESSERACT_BASE}/tesseract-core-simd-lstm.wasm.js`,
      "/tessdata/spa.traineddata.gz",
    ]);
    expect(ocrAssetUrls(null)).toHaveLength(5);
    // Un nombre que no está en la lista blanca no se cuela.
    expect(ocrAssetUrls("../../etc/passwd")).toHaveLength(5);
  });
});
