// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharePanel } from './SharePanel.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  createShareToken: vi.fn(),
  revokeShareToken: vi.fn()
}));

vi.mock('../../api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client.js')>();
  return { ...original, ...api };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  api.createShareToken.mockResolvedValue({ id: 7, token: 'tok-abc', createdAt: '2026-10-03T15:00:00.000Z' });
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

async function renderAndShare(): Promise<void> {
  await act(async () => {
    root?.render(<SharePanel territoryId={1} />);
  });
  const shareButton = [...(host?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent === 'Compartir este territorio'
  );
  await act(async () => {
    shareButton?.click();
  });
}

describe('SharePanel', () => {
  it('says the link only lets volunteers see the territory — recording progress is admin-only', async () => {
    await renderAndShare();

    const intro = host?.querySelector('section > p')?.textContent ?? '';
    expect(intro).toContain('ver el territorio');
    expect(intro).not.toContain('registrar progreso');
  });

  it('lays out the issued link as a full-width field above its own group of action buttons', async () => {
    await renderAndShare();

    const item = host?.querySelector('li.share-link');
    expect(item?.querySelector('input.share-link-url')).not.toBeNull();
    const actions = item?.querySelector('.share-link-actions');
    expect([...(actions?.children ?? [])].map((child) => child.textContent)).toEqual([
      'Copiar link',
      'Abrir link',
      'Revocar'
    ]);
    // "Abrir link" is a real link styled as a button, opening the public view in a new tab.
    const open = actions?.querySelector('a.button-link');
    expect(open?.getAttribute('href')).toMatch(/#tok-abc$/);
    expect(open?.getAttribute('target')).toBe('_blank');
  });
});
