"use client";

import * as React from "react";

import { idbListMutations } from "./idb";
import { subscribeSync } from "./sync-queue";

/** True si el peritaje `id` tiene cambios en la cola esperando subir. Se
 *  recalcula cada vez que cambia el estado de la cola. */
export function useHasPendingSync(id: string): boolean {
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    const check = () => {
      idbListMutations()
        .then((list) => {
          if (!cancelled) setPending(list.some((m) => m.inspectionId === id));
        })
        .catch(() => {});
    };
    const unsub = subscribeSync(check);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [id]);
  return pending;
}
