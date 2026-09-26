/**
 * URL routing for the admin app, kept dependency-free via the browser
 * History API. The route table lives here as pure functions so path/route
 * mapping is unit-testable without a browser — the App tests render the
 * tree server-side (`renderToStaticMarkup`), where `window` does not exist.
 *
 * Route model (2026-09-20 navigation restructure):
 *
 *   /resumen                -> resumen    (overview / statistics)
 *   /territorios            -> territorios (list only, no editor)
 *   /nuevo                  -> nuevo       (draw a brand-new territory)
 *   /territorios/:id        -> detalle     (share + progress + audit)
 *   /territorios/:id/editar -> editar      (editor with that territory)
 *
 * The root `/` and any unknown path — including a non-numeric `:id` under
 * `/territorios` — resolve to the territorios list (the default view),
 * never throwing.
 */

export type View = 'resumen' | 'territorios' | 'nuevo' | 'detalle' | 'editar';

/** A resolved route: which view to show, plus the territory id when one is scoped. */
export interface RouteMatch {
  readonly view: View;
  readonly territoryId: number | null;
}

/**
 * Derive a route from a `location.pathname`. Trailing slashes are ignored;
 * a numeric `:id` under `/territorios` selects the detalle/editar views,
 * anything else there (or anywhere else) falls back to the territories list.
 */
export function matchPath(pathname: string): RouteMatch {
  const path = normalize(pathname);

  switch (path) {
    case '/resumen':
      return { view: 'resumen', territoryId: null };
    case '/nuevo':
      return { view: 'nuevo', territoryId: null };
    case '/territorios':
      return { view: 'territorios', territoryId: null };
  }

  const detail = /^\/territorios\/(\d+)$/.exec(path);
  if (detail !== null) {
    return { view: 'detalle', territoryId: Number(detail[1]) };
  }

  const edit = /^\/territorios\/(\d+)\/editar$/.exec(path);
  if (edit !== null) {
    return { view: 'editar', territoryId: Number(edit[1]) };
  }

  // Root, unknown paths, and non-numeric ids all land on the list.
  return { view: 'territorios', territoryId: null };
}

/**
 * The canonical path for a view. `territoryId` is required for `detalle`
 * and `editar`; omitted, it degrades to `/territorios` rather than emitting
 * a broken path.
 */
export function pathForView(view: View, territoryId?: number): string {
  switch (view) {
    case 'resumen':
      return '/resumen';
    case 'nuevo':
      return '/nuevo';
    case 'territorios':
      return '/territorios';
    case 'detalle':
      return territoryId === undefined ? '/territorios' : `/territorios/${territoryId}`;
    case 'editar':
      return territoryId === undefined ? '/territorios' : `/territorios/${territoryId}/editar`;
  }
}

/** Collapse trailing slashes so `/territorios/` and `/territorios/123/` match their canonical forms. */
function normalize(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
}
