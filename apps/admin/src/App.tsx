import { useState, type JSX } from 'react';

import { TerritoryEditor } from './features/territory-editor/TerritoryEditor.js';
import { TerritoryList } from './features/territory-list/TerritoryList.js';
import type { TerritoryWithRevisions } from './api/client.js';

/**
 * Slice 1 of the A5 brief: draw a territory over Bello, save it, see the
 * revision history. Assignment/return/complete/reopen and progress display
 * are slice 2 — deliberately not built here yet (docs/agents/A5-admin-web.md:
 * "Work in two slices... commit and verify each before starting the next").
 */
export function App(): JSX.Element {
  const [selected, setSelected] = useState<TerritoryWithRevisions | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <main>
      <h1>Territory Management — Admin</h1>
      <TerritoryList
        selectedTerritoryId={selected?.id ?? null}
        onSelect={setSelected}
        refreshToken={refreshToken}
      />
      <TerritoryEditor
        selectedTerritory={selected}
        onSaved={(territory) => {
          setSelected(territory);
          setRefreshToken((token) => token + 1);
        }}
      />
    </main>
  );
}
