import { useEffect, useState, type JSX } from 'react';

import { TerritoryDetail } from './features/territory-detail/TerritoryDetail.js';
import { TerritoryEditor } from './features/territory-editor/TerritoryEditor.js';
import { TerritoryList } from './features/territory-list/TerritoryList.js';
import { TerritoryOverview } from './features/territory-overview/TerritoryOverview.js';
import type { MultiPolygon, Polygon } from '@territorios/geo';
import { getTerritory, type TerritoryWithRevisions } from './api/client.js';
import { matchPath, pathForView, type RouteMatch, type View } from './routes.js';

/**
 * A5 brief, both slices: draw a territory over Bello and see its revision
 * history (slice 1); share it with the volunteer group, recorded progress
 * and cycle history (slice 2; the audit trail is API-only since 2026-10-03). The app is URL-routed with the
 * browser History API — five real routes (see routes.ts) replace the old
 * three-state view switcher, so the sidebar links are real `<a>` anchors,
 * card clicks deep-link straight to a territory, and back/forward stay
 * intact with no router dependency.
 *
 * `selected` remains the source of truth for the currently-loaded
 * `TerritoryWithRevisions`. Arriving at `/territorios/:id` (or its
 * `/editar` sibling) fetches that territory when `selected` does not
 * already match the id in the URL; `/nuevo` clears it so the editor opens
 * in "draw new" mode.
 */

/** Current `location.pathname`, or `/` outside a browser (SSR/tests). */
function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

/** Which sidebar item is active for a given view (detalle/editar both live under "Territorios"). */
function activeNavItem(view: View): 'resumen' | 'territorios' | 'nuevo' {
  if (view === 'resumen') return 'resumen';
  if (view === 'nuevo') return 'nuevo';
  return 'territorios';
}

export function App(): JSX.Element {
  const [selected, setSelected] = useState<TerritoryWithRevisions | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [remainingAreaGeometry, setRemainingAreaGeometry] = useState<Polygon | MultiPolygon | null>(null);
  const [route, setRoute] = useState<RouteMatch>(() => matchPath(currentPathname()));

  /**
   * Change the view and keep the URL in sync via `pushState` (never a full
   * reload). Sidebar anchors call this from their `onClick` after
   * `preventDefault`; the save flow calls it to jump to the saved
   * territory's detail.
   */
  function navigate(view: View, territoryId?: number | null): void {
    const path = pathForView(view, territoryId ?? undefined);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', path);
    }
    setRoute(matchPath(path));
  }

  /**
   * Canonicalize the address bar on first load: `/`, unknown paths, and a
   * non-numeric id all rewrite to their canonical path via `replaceState`
   * (never push, so history is not polluted). The route state itself is
   * already correct — `matchPath` resolves them to the same view — so only
   * the URL string changes here.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pathname = window.location.pathname;
    const matched = matchPath(pathname);
    const canonical = pathForView(matched.view, matched.territoryId ?? undefined);
    if (pathname !== canonical) {
      window.history.replaceState(null, '', canonical);
    }
  }, []);

  // Browser back/forward: re-derive the route from the new pathname.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function handlePopState(): void {
      setRoute(matchPath(window.location.pathname));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  /**
   * React to the route: `/nuevo` clears the selection (editor in "draw new"
   * mode); a territory-scoped route (`detalle`/`editar`) fetches the
   * territory when `selected` does not already match the id in the URL.
   * A failed fetch (bad id, network) gracefully falls back to the list.
   */
  useEffect(() => {
    if (route.view === 'nuevo') {
      setSelected(null);
      setRemainingAreaGeometry(null);
      return;
    }

    const territoryId = route.territoryId;
    if (territoryId === null) {
      return;
    }

    if (selected !== null && selected.id === territoryId) {
      return;
    }

    let cancelled = false;
    getTerritory(territoryId)
      .then((territory) => {
        if (cancelled) return;
        setSelected(territory);
        setRemainingAreaGeometry(null);
      })
      .catch(() => {
        if (cancelled) return;
        setSelected(null);
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', '/territorios');
        }
        setRoute({ view: 'territorios', territoryId: null });
      });
    return () => {
      cancelled = true;
    };
  }, [route, selected]);

  /** After a successful save, land on the saved territory's detail view. */
  function handleSaved(territory: TerritoryWithRevisions): void {
    setSelected(territory);
    setRefreshToken((token) => token + 1);
    navigate('detalle', territory.id);
  }

  const active = activeNavItem(route.view);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1 className="sidebar-brand">Gestión de Territorios — Administración</h1>
        <nav aria-label="Vistas" className="sidebar-nav">
          <a
            href="/territorios"
            onClick={(event) => {
              event.preventDefault();
              navigate('territorios');
            }}
            aria-current={active === 'territorios' ? 'true' : undefined}
          >
            Territorios
          </a>
          <a
            href="/resumen"
            onClick={(event) => {
              event.preventDefault();
              navigate('resumen');
            }}
            aria-current={active === 'resumen' ? 'true' : undefined}
          >
            Resumen
          </a>
          <a
            href="/nuevo"
            onClick={(event) => {
              event.preventDefault();
              navigate('nuevo');
            }}
            aria-current={active === 'nuevo' ? 'true' : undefined}
          >
            Nuevo Territorio
          </a>
        </nav>
      </aside>
      <main className="content">
        {route.view === 'territorios' && <TerritoryList refreshToken={refreshToken} />}
        {route.view === 'resumen' && <TerritoryOverview />}
        {route.view === 'nuevo' && (
          <TerritoryEditor
            selectedTerritory={null}
            remainingAreaGeometry={remainingAreaGeometry}
            onSaved={handleSaved}
          />
        )}
        {(route.view === 'detalle' || route.view === 'editar') && selected === null && (
          <p role="status">Cargando territorio…</p>
        )}
        {route.view === 'detalle' && selected !== null && (
          <TerritoryDetail
            territoryId={selected.id}
            boundary={selected.revisions.at(-1)?.geometry ?? null}
            refreshToken={refreshToken}
            onRemainingAreaChange={setRemainingAreaGeometry}
            onEdit={() => navigate('editar', selected.id)}
          />
        )}
        {route.view === 'editar' && selected !== null && (
          <TerritoryEditor
            selectedTerritory={selected}
            remainingAreaGeometry={remainingAreaGeometry}
            onSaved={handleSaved}
          />
        )}
      </main>
    </div>
  );
}
