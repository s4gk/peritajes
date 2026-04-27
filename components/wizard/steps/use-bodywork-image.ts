"use client";

import * as React from "react";

export type BodyworkStatus = "idle" | "checking" | "generating" | "ready" | "error";

export type BodyworkImageState = {
  status: BodyworkStatus;
  url: string | null;
  slug: string | null;
  error: string | null;
};

type Input = { make: string; model: string; year: string; bodyType?: string };

const initial: BodyworkImageState = {
  status: "idle",
  url: null,
  slug: null,
  error: null,
};

/**
 * When make+model+year are all present, check the server cache and (if needed)
 * trigger generation in the background. Idempotent per (make,model,year) — won't
 * re-fire while a request for the same key is in flight or already resolved.
 */
export function useBodyworkImage(input: Input, debounceMs = 600): BodyworkImageState {
  const [state, setState] = React.useState<BodyworkImageState>(initial);
  const lastKeyRef = React.useRef<string | null>(null);
  const inFlightRef = React.useRef<AbortController | null>(null);

  const make = input.make.trim();
  const model = input.model.trim();
  const year = input.year.trim();
  const bodyType = input.bodyType?.trim() || "";

  const ready = make.length > 0 && model.length > 0 && /^\d{4}$/.test(year);
  const key = ready ? `${make}|${model}|${year}|${bodyType}`.toLowerCase() : "";

  React.useEffect(() => {
    if (!ready) return;
    if (lastKeyRef.current === key) return;

    const t = window.setTimeout(() => {
      // Cancel any prior request
      inFlightRef.current?.abort();
      const ctrl = new AbortController();
      inFlightRef.current = ctrl;
      lastKeyRef.current = key;

      const params = new URLSearchParams({ make, model, year });
      if (bodyType) params.set("bodyType", bodyType);

      setState({ status: "checking", url: null, slug: null, error: null });

      fetch(`/api/generate-bodywork?${params.toString()}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then(async (cacheBody: { status: string; url?: string; slug?: string }) => {
          if (ctrl.signal.aborted) return;
          if (cacheBody.status === "ready" && cacheBody.url) {
            setState({
              status: "ready",
              url: cacheBody.url,
              slug: cacheBody.slug ?? null,
              error: null,
            });
            return;
          }
          // Cache miss → kick off generation
          setState((s) => ({ ...s, status: "generating", slug: cacheBody.slug ?? s.slug }));
          const genRes = await fetch("/api/generate-bodywork", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ make, model, year, bodyType: bodyType || undefined }),
            signal: ctrl.signal,
          });
          const genBody = (await genRes.json()) as {
            status: string;
            url?: string;
            slug?: string;
            error?: string;
          };
          if (ctrl.signal.aborted) return;
          if (genBody.status === "ready" && genBody.url) {
            setState({
              status: "ready",
              url: genBody.url,
              slug: genBody.slug ?? null,
              error: null,
            });
          } else {
            setState({
              status: "error",
              url: null,
              slug: genBody.slug ?? null,
              error: genBody.error || `Falló la generación (${genRes.status})`,
            });
          }
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          setState({
            status: "error",
            url: null,
            slug: null,
            error: (err as Error).message,
          });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(t);
    };
  }, [ready, key, make, model, year, bodyType, debounceMs]);

  React.useEffect(() => {
    return () => {
      inFlightRef.current?.abort();
    };
  }, []);

  return state;
}
