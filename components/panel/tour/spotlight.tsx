"use client";

import * as React from "react";

/**
 * Capa de oscurecimiento del tour con un "hueco" transparente sobre el elemento
 * resaltado. Truco clásico: un div del tamaño del target con un box-shadow
 * gigante que pinta todo el resto de la pantalla. Cuando `rect` es null (pasos
 * centrados) caemos a un overlay uniforme.
 *
 * pointer-events-none deja pasar los clics; el cierre por clic afuera lo maneja
 * el orquestador con su propia capa, así que aquí solo dibujamos.
 */

const PADDING = 6;

export function Spotlight({ rect }: { rect: DOMRect | null }) {
  if (!rect) {
    return (
      <div
        className="fixed inset-0 z-[150] bg-black/60"
        aria-hidden
      />
    );
  }

  const top = Math.max(0, rect.top - PADDING);
  const left = Math.max(0, rect.left - PADDING);
  const width = rect.width + PADDING * 2;
  const height = rect.height + PADDING * 2;

  return (
    <div
      className="pointer-events-none fixed z-[150] rounded-lg transition-all duration-200"
      style={{
        top,
        left,
        width,
        height,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
      }}
      aria-hidden
    />
  );
}
