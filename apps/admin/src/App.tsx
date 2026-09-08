import { useState, type JSX } from 'react';

import { TerritoryDetail } from './features/territory-detail/TerritoryDetail.js';
import { TerritoryEditor } from './features/territory-editor/TerritoryEditor.js';
import { TerritoryList } from './features/territory-list/TerritoryList.js';
import type { Polygon } from '@territorios/geo';
import type { TerritoryWithRevisions } from './api/client.js';

/**
 * A5 brief, both slices: draw a territory over Bello and see its revision
 * history (slice 1); assign/return/complete/reopen, recorded progress, and
 * the full audit trail (slice 2). TerritoryDetail is shown only once a
 * territory is selected — a brand-new, unsaved draft has no assignment
 * history yet.
 */
export function App(): JSX.Element {
  const [selected, setSelected] = useState<TerritoryWithRevisions | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [remainingAreaGeometry, setRemainingAreaGeometry] = useState<Polygon | null>(null);

  function handleSelect(territory: TerritoryWithRevisions | null): void {
    setSelected(territory);
    setRemainingAreaGeometry(null);
  }

  return (
    <main>
      <h1>Territory Management — Admin</h1>
      <TerritoryList selectedTerritoryId={selected?.id ?? null} onSelect={handleSelect} refreshToken={refreshToken} />
      <TerritoryEditor
        selectedTerritory={selected}
        remainingAreaGeometry={remainingAreaGeometry}
        onSaved={(territory) => {
          setSelected(territory);
          setRefreshToken((token) => token + 1);
        }}
      />
      {selected && (
        <TerritoryDetail
          territoryId={selected.id}
          refreshToken={refreshToken}
          onRemainingAreaChange={setRemainingAreaGeometry}
        />
      )}
    </main>
  );
}
