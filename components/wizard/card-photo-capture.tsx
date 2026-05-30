"use client";

import * as React from "react";
import { Camera, Images, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { compressImage } from "@/lib/client/image-compress";

type Props = {
  onCapture: (dataUrl: string) => void;
  buttonLabel: string;
  side: "front" | "back";
};

const TIPS = [
  "Superficie plana, con buena luz natural o artificial",
  "Las 4 esquinas visibles — sin recortar bordes",
  "Sin reflejos, sombras ni dedos tapando el texto",
  "Enfoca bien antes de disparar",
];

// Guía visual SVG de cómo sostener la tarjeta
function CardGuideIllustration({ side }: { side: "front" | "back" }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/25 bg-muted/40 px-4 py-5">
      {/* Representación de la tarjeta en proporción ID-1 (85.6 × 54 mm ≈ 1.585:1) */}
      <div className="relative flex w-full max-w-[240px] items-center justify-center">
        {/* Esquinas guía */}
        <div className="absolute left-0 top-0 h-4 w-4 rounded-tl-md border-l-2 border-t-2 border-primary/60" />
        <div className="absolute right-0 top-0 h-4 w-4 rounded-tr-md border-r-2 border-t-2 border-primary/60" />
        <div className="absolute bottom-0 left-0 h-4 w-4 rounded-bl-md border-b-2 border-l-2 border-primary/60" />
        <div className="absolute bottom-0 right-0 h-4 w-4 rounded-br-md border-b-2 border-r-2 border-primary/60" />

        {/* Tarjeta */}
        <div className="flex aspect-[1.585] w-full items-center justify-center rounded-md border border-border bg-white shadow-sm">
          {side === "front" ? (
            <div className="w-full px-3 py-2 space-y-1.5">
              <div className="flex gap-2 items-start">
                <div className="h-8 w-6 shrink-0 rounded bg-muted" />
                <div className="flex-1 space-y-1 pt-0.5">
                  <div className="h-1.5 w-3/4 rounded bg-muted" />
                  <div className="h-1.5 w-1/2 rounded bg-muted" />
                  <div className="h-1.5 w-2/3 rounded bg-muted" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <div className="h-1.5 rounded bg-muted" />
                <div className="h-1.5 rounded bg-muted" />
                <div className="h-1.5 w-3/4 rounded bg-muted" />
                <div className="h-1.5 w-2/3 rounded bg-muted" />
              </div>
            </div>
          ) : (
            <div className="w-full px-3 py-2 space-y-1.5">
              <div className="h-6 w-full rounded bg-muted/70" />
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded bg-muted" />
                <div className="h-1.5 w-5/6 rounded bg-muted" />
                <div className="h-1.5 w-4/5 rounded bg-muted" />
                <div className="h-1.5 w-3/4 rounded bg-muted" />
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Mantén la tarjeta <span className="font-semibold text-foreground">horizontal</span>{" "}
        y ocupa el mayor espacio posible
      </p>
    </div>
  );
}

export function CardPhotoCapture({ onCapture, buttonLabel, side }: Props) {
  const [open, setOpen] = React.useState(false);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const galleryRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setOpen(false);
    try {
      const result = await compressImage(file);
      onCapture(result.dataUrl);
    } catch {
      // el usuario canceló o hubo error de lectura — no hacemos nada
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        <Camera className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm gap-4">
          <DialogHeader>
            <DialogTitle>
              {side === "front" ? "Fotografiar frente" : "Fotografiar reverso"}
            </DialogTitle>
          </DialogHeader>

          <CardGuideIllustration side={side} />

          <ul className="space-y-2">
            {TIPS.map((tip) => (
              <li key={tip} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={() => cameraRef.current?.click()}>
              <Camera className="mr-2 h-4 w-4" />
              Tomar foto
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => galleryRef.current?.click()}
            >
              <Images className="mr-2 h-4 w-4" />
              Galería
            </Button>
          </div>

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={onChange}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={onChange}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
