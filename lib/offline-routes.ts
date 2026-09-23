/**
 * Rutas y constantes compartidas entre la app, el service worker y los tests
 * para el modo sin internet. (public/sw.js no puede importar módulos: repite
 * estos valores a mano — si cambias uno, cámbialo allá también.)
 */

/** Id "de mentira" con el que se cachea el cascarón del wizard. El HTML de
 *  `/inspection/<cualquier id>` es el mismo (el wizard lee el id de la URL en
 *  el cliente), así que el SW sirve este cascarón para cualquier peritaje
 *  cuando no hay red. */
export const INSPECTION_SHELL_ID = "offline-shell";
export const INSPECTION_SHELL_URL = `/inspection/${INSPECTION_SHELL_ID}`;

/** Endpoint que lista los assets estáticos a precachear en el SW. */
export const OFFLINE_MANIFEST_URL = "/api/offline/manifest";

/** Saca el id del peritaje de un pathname `/inspection/<id>`. Devuelve null
 *  si la ruta no es del wizard o si es el propio cascarón. */
export function inspectionIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const m = /^\/inspection\/([^/?#]+)\/?$/.exec(pathname);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  if (!id || id === INSPECTION_SHELL_ID) return null;
  return id;
}

export function inspectionUrl(id: string): string {
  return `/inspection/${encodeURIComponent(id)}`;
}
