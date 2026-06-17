"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";

import { TOUR_START_EVENT } from "./product-tour";

/** Botón "?" del topbar que relanza el tour de uso en cualquier momento. */
export function HelpButton() {
  return (
    <button
      type="button"
      data-tour="help"
      aria-label="Ver guía de uso"
      title="Guía de uso"
      onClick={() => window.dispatchEvent(new CustomEvent(TOUR_START_EVENT))}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <HelpCircle className="h-5 w-5" />
    </button>
  );
}
