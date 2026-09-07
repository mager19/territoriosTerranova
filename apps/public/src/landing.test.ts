import { describe, expect, it } from 'vitest';

import { mountLanding } from './landing';

describe('mountLanding', () => {
  it('renders the public heading into the container', () => {
    const root = document.createElement('div');

    mountLanding(root);

    expect(root.querySelector('h1')?.textContent).toBe('Territory Management');
  });

  it('renders the skeleton notice', () => {
    const root = document.createElement('div');

    mountLanding(root);

    expect(root.querySelector('p')?.textContent).toContain(
      'Shared territory views land with the public-web change.'
    );
  });

  it('replaces previous container content instead of appending to it', () => {
    const root = document.createElement('div');
    root.appendChild(document.createElement('span'));

    mountLanding(root);

    expect(root.querySelector('span')).toBeNull();
    expect(root.children).toHaveLength(2);
  });
});
