import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from './App.js';

describe('App', () => {
  it('renders the admin heading inside a main landmark', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<main>');
    expect(html).toContain('Territory Management — Admin');
  });

  it('renders the territory list and editor sections', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('Territories');
    expect(html).toContain('Draw a new territory');
  });
});
