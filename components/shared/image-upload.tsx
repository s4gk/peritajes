"use client";

import * as React from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { InspectedImage } from "@/lib/types";
import { makeId } from "@/lib/utils";

const MAX_WIDTH = 1600;
const MAX_BYTES = 500 * 1024; // ~500 KB per image post-downscale

async function readAndDownscale(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("invalid image"));
    image.src = dataUrl;
  });

  const scale = Math.min(1, MAX_WIDTH / img.width);
  const targetW = Math.round(img.width * scale);
  const targetH = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let quality = 0.85;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > MAX_BYTES * 1.37 && quality > 0.4) {
    quality -= 0.1;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

export type ImageUploadHandle = {
  openPicker: () => void;
};

type Props = {
  images: InspectedImage[];
  onChange: (images: InspectedImage[]) => void;
  required?: boolean;
  label?: string;
  compact?: boolean;
};

export const ImageUpload = React.forwardRef<ImageUploadHandle, Props>(
  function ImageUpload(
    { images, onChange, required, label = "Evidencia fotográfica", compact },
    handleRef,
  ) {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [preview, setPreview] = React.useState<InspectedImage | null>(null);
    const [uploading, setUploading] = React.useState(false);

    React.useImperativeHandle(handleRef, () => ({
      openPicker: () => inputRef.current?.click(),
    }));

    async function handleFiles(files: FileList | null) {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        const added: InspectedImage[] = [];
        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) continue;
          const dataUrl = await readAndDownscale(file);
          added.push({ id: makeId(), dataUrl });
        }
        onChange([...images, ...added]);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }

    function removeImage(id: string) {
      onChange(images.filter((i) => i.id !== id));
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "text-xs font-medium text-muted-foreground",
              compact && "text-[11px]",
            )}
          >
            {label}
            {required && <span className="ml-1 text-danger">*</span>}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="h-10 px-3 sm:h-8 sm:px-3"
          >
            <ImagePlus className="mr-1 h-4 w-4" />
            {uploading ? "Procesando..." : "Agregar foto"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {images.map((img) => (
              <div
                key={img.id}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
              >
                <button
                  type="button"
                  onClick={() => setPreview(img)}
                  className="h-full w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt="Evidencia"
                    className="h-full w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute right-1 top-1 rounded-md bg-background/95 p-1.5 text-danger shadow sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
                  aria-label="Eliminar"
                >
                  <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {required && images.length === 0 && (
          <p className="text-xs text-danger">Este estado requiere al menos una foto.</p>
        )}

        <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="max-w-3xl">
            <DialogTitle className="sr-only">Vista previa</DialogTitle>
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.dataUrl}
                alt="Vista previa"
                className="max-h-[80vh] w-full object-contain"
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  },
);
