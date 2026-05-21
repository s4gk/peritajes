"use client";

import { LEAKS_SECTION } from "@/lib/constants";

import { SectionStep } from "./section-step";

export function LeaksStep() {
  return (
    <SectionStep
      section={LEAKS_SECTION}
      title="Líquidos del motor"
      description="Revisión focalizada de fugas y estado de fluidos: aceite motor y caja, hidráulico de dirección, refrigerante, líquido de frenos, A/C y diferenciales (si aplica)."
    />
  );
}
