"use client";

import { flushLocalWrites } from "@/lib/inspections-store";

type RouterLike = { push: (href: string) => void; replace: (href: string) => void };

/** Evento que se dispara justo antes de una navegación dura sin red. Quien
 *  tenga cambios en memoria sin persistir (el wizard con su debounce) debe
 *  guardarlos de forma síncrona al escucharlo. */
export const BEFORE_HARD_NAV_EVENT = "perito:before-hard-nav";

/**
 * Navega dentro del panel funcionando también sin red.
 *
 * Con red usa el router de Next (SPA). Sin red, el router intentaría bajar el
 * payload RSC de la página destino, fallaría y recién ahí haría una navegación
 * dura. Acá vamos directo a la navegación dura — la atiende el service worker
 * con el HTML cacheado — pero ANTES esperamos a que terminen las escrituras
 * pendientes a IndexedDB: si no, el peritaje recién creado podría no estar
 * guardado cuando el wizard lo busque en la página nueva.
 */
export async function navigateOfflineSafe(
  router: RouterLike,
  href: string,
  opts: { replace?: boolean } = {},
): Promise<void> {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!offline) {
    if (opts.replace) router.replace(href);
    else router.push(href);
    return;
  }
  window.dispatchEvent(new Event(BEFORE_HARD_NAV_EVENT));
  await flushLocalWrites();
  if (opts.replace) window.location.replace(href);
  else window.location.assign(href);
}
