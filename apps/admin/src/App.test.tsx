import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from './App.js';
import { TerritoryEditor } from './features/territory-editor/TerritoryEditor.js';
import { TerritoryDetail } from './features/territory-detail/TerritoryDetail.js';
import { matchPath, pathForView } from './routes.js';

describe('App', () => {
  it('renders the admin heading and the main landmark', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<main class="content"');
    expect(html).toContain('Gestión de Territorios — Administración');
  });

  it('renders the territory list as a card grid', () => {
    const html = renderToStaticMarkup(<App />);

    // The grid marker plus the loading status. The old "Dibujar un
    // territorio nuevo" button is gone — that editor now lives on /nuevo.
    expect(html).toContain('territory-grid');
    expect(html).toContain('Cargando territorios…');
  });

  it('keeps territory geometry controls as a bounded map toolbar', () => {
    const html = renderToStaticMarkup(<TerritoryEditor selectedTerritory={null} onSaved={() => undefined} />);

    expect(html).toContain('aria-label="Herramientas de geometría"');
    expect(html).toContain('Reemplazar borrador');
    expect(html).toContain('Editar vértices');
    expect(html).toContain('Descartar borrador');
  });

  it('offers a way to switch to the overview', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('Resumen');
  });

  it('places the coverage and operational-status summary before the recorder on a territory detail page', () => {
    const html = renderToStaticMarkup(
      <TerritoryDetail territoryId={1} boundary={null} refreshToken={0} onRemainingAreaChange={() => undefined} onEdit={() => undefined} />
    );
    expect(html.indexOf('Cobertura y estado operativo')).toBeLessThan(html.indexOf('Registrar área pendiente o evidencia'));
  });

  it('renders a sidebar nav with all three view links', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('aria-label="Vistas"');
    expect(html).toMatch(/<a[^>]*href="\/resumen"[^>]*>Resumen<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/territorios"[^>]*>Territorios<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/nuevo"[^>]*>Nuevo Territorio<\/a>/);
  });

  it('marks "Territorios" as the current view by default', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toMatch(/<a[^>]*aria-current="true"[^>]*>Territorios<\/a>/);
  });
});

describe('routes', () => {
  it('maps /resumen to the resumen view', () => {
    expect(matchPath('/resumen')).toEqual({ view: 'resumen', territoryId: null });
  });

  it('maps /territorios to the territorios view', () => {
    expect(matchPath('/territorios')).toEqual({ view: 'territorios', territoryId: null });
  });

  it('maps /nuevo to the nuevo view', () => {
    expect(matchPath('/nuevo')).toEqual({ view: 'nuevo', territoryId: null });
  });

  it('maps /territorios/123 to the detalle view with that id', () => {
    expect(matchPath('/territorios/123')).toEqual({ view: 'detalle', territoryId: 123 });
  });

  it('maps /territorios/123/editar to the editar view with that id', () => {
    expect(matchPath('/territorios/123/editar')).toEqual({ view: 'editar', territoryId: 123 });
  });

  it('maps the root path to the territorios view', () => {
    expect(matchPath('/')).toEqual({ view: 'territorios', territoryId: null });
  });

  it('maps an unknown path to the territorios view', () => {
    expect(matchPath('/ruta-desconocida')).toEqual({ view: 'territorios', territoryId: null });
  });

  it('maps a non-numeric territory id to the territorios view', () => {
    expect(matchPath('/territorios/abc')).toEqual({ view: 'territorios', territoryId: null });
  });

  it('maps each view back to its canonical path', () => {
    expect(pathForView('resumen')).toBe('/resumen');
    expect(pathForView('territorios')).toBe('/territorios');
    expect(pathForView('nuevo')).toBe('/nuevo');
    expect(pathForView('detalle', 123)).toBe('/territorios/123');
    expect(pathForView('editar', 123)).toBe('/territorios/123/editar');
  });
});
