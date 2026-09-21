import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from './App.js';

describe('App', () => {
  it('renders the admin heading inside a main landmark', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<main>');
    expect(html).toContain('Gestión de Territorios — Administración');
  });

  it('renders the territory list and editor sections', () => {
    const html = renderToStaticMarkup(<App />);

    // Not the bare word "Territorios": that also appears in the page heading
    // ("Gestión de Territorios — Administración"), so this assertion used to
    // pass even with the list deleted.
    expect(html).toContain('Dibujar un territorio nuevo');
    expect(html).toContain('Cargando territorios…');
  });

  it('offers a way to switch to the overview', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('Resumen');
  });
});
