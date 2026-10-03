// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProgressEntry } from '../../api/client.js';
import { ProgressList, type ProgressListProps } from './ProgressList.js';
import { currentCycleSessions } from './sessions.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [[[-75.574, 6.357], [-75.572, 6.357], [-75.572, 6.359], [-75.574, 6.357]]] as [number, number][][]
};

function entry(overrides: Partial<ProgressEntry>): ProgressEntry {
  return {
    id: 1,
    territoryId: 1,
    cycleNumber: 2,
    recordedBy: 'admin',
    recordedAt: '2026-09-26T10:00:00.000Z',
    note: null,
    pausePoint: null,
    route: null,
    coveredArea: SQUARE,
    baseline: null,
    remainingArea: SQUARE,
    remainingAreaStatus: 'recorded',
    ...overrides
  };
}

const ENTRIES: readonly ProgressEntry[] = [
  entry({ id: 1, cycleNumber: 1, note: 'ciclo viejo' }),
  entry({ id: 2, baseline: 'whole_territory', note: 'arrancamos' }),
  entry({ id: 3, remainingArea: { type: 'Polygon', coordinates: [] }, route: { type: 'LineString', coordinates: [[-75.574, 6.357], [-75.573, 6.358]] } })
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
});

async function renderList(overrides: Partial<ProgressListProps> = {}): Promise<ProgressListProps> {
  const props: ProgressListProps = {
    entries: ENTRIES,
    sessions: currentCycleSessions(ENTRIES, 2),
    loading: false,
    error: null,
    highlightedSessionId: null,
    selectedSessionId: null,
    onHover: vi.fn(),
    onSelect: vi.fn(),
    ...overrides
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ProgressList {...props} />);
  });
  return props;
}

function sessionButtons(): HTMLButtonElement[] {
  return [...(host?.querySelectorAll<HTMLButtonElement>('button.session-toggle') ?? [])];
}

describe('ProgressList', () => {
  it('numbers the current cycle sessions with the same colors as the map and keeps older entries as plain history', async () => {
    await renderList();

    const buttons = sessionButtons();
    expect(buttons.map((button) => button.textContent)).toEqual(['Sesión 1', 'Sesión 2']);
    const swatches = buttons.map((button) => button.querySelector<HTMLElement>('.session-swatch')?.style.backgroundColor);
    expect(swatches).toHaveLength(2);
    expect(swatches[0]).not.toBe(swatches[1]);
    expect(host?.querySelector('.session-item--history')?.textContent).toContain('Ciclo 1');
    expect(host?.textContent).toContain('partió de todo el territorio');
    expect(host?.textContent).toContain('nada pendiente');
    expect(host?.textContent).toContain('con ruta');
  });

  it('previews a session on hover and pins/unpins it on click', async () => {
    const props = await renderList();
    const [first] = sessionButtons();
    if (!first) throw new Error('expected a session button');

    await act(async () => {
      first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(props.onHover).toHaveBeenCalledWith(2);

    await act(async () => first.click());
    expect(props.onSelect).toHaveBeenCalledWith(2);
  });

  it('releases a pinned session when it is clicked again', async () => {
    const props = await renderList({ selectedSessionId: 2, highlightedSessionId: 2 });
    const [first] = sessionButtons();
    if (!first) throw new Error('expected a session button');

    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.closest('li')?.className).toContain('session-item--highlighted');
    await act(async () => first.click());
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it('says so when there are no sessions yet', async () => {
    await renderList({ entries: [], sessions: [] });
    expect(host?.textContent).toContain('Todavía no hay sesiones registradas');
  });
});
