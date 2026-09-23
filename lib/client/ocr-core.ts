"use client";

/**
 * Qué variante del core de Tesseract va a usar este celular — la misma
 * detección que hace tesseract.js (wasm-feature-detect), para que el service
 * worker precachee solo ese archivo (~4 MB) y no las tres variantes.
 */
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED_SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);

export function detectOcrCoreFile(): string | null {
  try {
    if (typeof WebAssembly === "undefined") return null;
    if (WebAssembly.validate(RELAXED_SIMD)) return "tesseract-core-relaxedsimd-lstm.wasm.js";
    if (WebAssembly.validate(SIMD)) return "tesseract-core-simd-lstm.wasm.js";
    return "tesseract-core-lstm.wasm.js";
  } catch {
    return null;
  }
}
