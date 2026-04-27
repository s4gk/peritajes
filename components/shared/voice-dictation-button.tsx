"use client";

import * as React from "react";
import { Mic, MicOff } from "lucide-react";

import { cn } from "@/lib/utils";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

type Props = {
  /** Called with each final chunk of transcribed text while listening. */
  onTranscript: (text: string) => void;
  /** Optional language override, defaults to es-CO. */
  lang?: string;
  /** Visual size; "sm" for inside inputs, "md" for standalone. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Tiny mic button that uses the browser Web Speech API to dictate into text fields.
 * Silently renders nothing if the API is not supported (e.g. Firefox desktop).
 */
export function VoiceDictationButton({
  onTranscript,
  lang = "es-CO",
  size = "sm",
  className,
}: Props) {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);

  React.useEffect(() => {
    setSupported(!!getRecognitionCtor());
  }, []);

  React.useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) onTranscript(r[0].transcript);
      }
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function stop() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  if (!supported) return null;

  const dim = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      aria-label={listening ? "Detener dictado" : "Dictar por voz"}
      title={listening ? "Detener dictado" : "Dictar por voz"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border transition-colors",
        dim,
        listening
          ? "border-danger/60 bg-danger/15 text-danger animate-pulse"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      {listening ? <MicOff className={iconSize} /> : <Mic className={iconSize} />}
    </button>
  );
}
