"use client";

import { ENGINE_COMPRESSION_SECTION } from "@/lib/constants";

import { SectionStep } from "./section-step";

export function CompressionStep() {
  return (
    <SectionStep
      section={ENGINE_COMPRESSION_SECTION}
      title="Compresión del motor"
      description="Registra la compresión por cilindro. Agrega un cilindro por cada uno del motor y marca su estado."
    />
  );
}
