// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PUBLIC_APP_BASE_URL } from '../../api/client.js';
import { SharePanel } from './SharePanel.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

async function render(slug = 'nv-01'): Promise<void> {
  await act(async () => {
    root?.render(<SharePanel slug={slug} />);
  });
}

function actionLabels(): (string | null)[] {
  return [...(host?.querySelector('.share-link-actions')?.children ?? [])].map((child) => child.textContent);
}

describe('SharePanel', () => {
  it('tells the admin to send the link to the volunteer group, who can only see the territory', async () => {
    await render();

    expect(host?.querySelector('section > p')?.textContent).toBe(
      'Envía este link al grupo de voluntarios. Cualquiera que lo tenga puede ver el territorio en el mapa.'
    );
  });

  it('shows the fixed public URL for the territory slug in a full-width read-only field', async () => {
    await render('barrio-niquia-3');

    const field = host?.querySelector<HTMLInputElement>('li.share-link input.share-link-url');
    expect(field?.value).toBe(`${PUBLIC_APP_BASE_URL}/t/barrio-niquia-3`);
    expect(field?.readOnly).toBe(true);
  });

  it('offers "Copiar link" (primary) and "Abrir link" — and nothing to issue or revoke', async () => {
    await render();

    expect(actionLabels()).toEqual(['Copiar link', 'Abrir link']);
    expect(host?.querySelector('.share-link-actions button.primary')?.textContent).toBe('Copiar link');
    const text = host?.textContent ?? '';
    expect(text).not.toContain('Compartir este territorio');
    expect(text).not.toContain('Revocar');
  });

  it('opens the public view in a new tab without leaking the admin page as referrer', async () => {
    await render();

    const open = host?.querySelector('.share-link-actions a.button-link');
    expect(open?.getAttribute('href')).toBe(`${PUBLIC_APP_BASE_URL}/t/nv-01`);
    expect(open?.getAttribute('target')).toBe('_blank');
    expect(open?.getAttribute('rel')).toContain('noreferrer');
  });

  it('copies the fixed URL and confirms it', async () => {
    await render();

    const copy = host?.querySelector<HTMLButtonElement>('.share-link-actions button.primary');
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith(`${PUBLIC_APP_BASE_URL}/t/nv-01`);
    expect(copy?.textContent).toBe('Copiado');
  });
});
