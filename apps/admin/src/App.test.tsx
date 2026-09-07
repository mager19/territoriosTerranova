import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from './App';

describe('App', () => {
  it('renders the admin heading', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<h1>Territory Management — Admin</h1>');
  });

  it('renders the skeleton notice inside a main landmark', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<main>');
    expect(html).toContain('The territory editor lands with the admin-web change.');
  });
});
