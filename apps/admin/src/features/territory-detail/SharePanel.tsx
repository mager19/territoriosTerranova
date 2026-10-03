import { useEffect, useRef, useState, type JSX } from 'react';

import { PUBLIC_APP_BASE_URL } from '../../api/client.js';

export interface SharePanelProps {
  /** The territory's fixed public slug (db/migrations/0011). */
  readonly slug: string;
}

/**
 * "Share this territory": the territory's ONE fixed, readable public URL,
 * `<public app>/t/<slug>` (2026-10-03 product decision, AGENTS.md "Privacy
 * rules"). Nothing to issue or revoke — the link is the same every time and
 * stays valid, which is the trade-off the user accepted: anyone who knows or
 * guesses the slug can see the territory's public (read-only, personal-data
 * free) view.
 */
export function SharePanel({ slug }: SharePanelProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = `${PUBLIC_APP_BASE_URL}/t/${slug}`;

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    []
  );

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser; the link is still
      // fully visible and selectable in the text field either way.
    }
  }

  return (
    <section aria-labelledby="share-heading">
      <h3 id="share-heading">Compartir</h3>
      <p>Envía este link al grupo de voluntarios. Cualquiera que lo tenga puede ver el territorio en el mapa.</p>

      <ul className="share-links">
        <li className="share-link">
          <input className="share-link-url" readOnly value={link} aria-label="Link para compartir" />
          {/* Stacked full-width on phones, one row on wider screens (styles.css). */}
          <div className="share-link-actions">
            <button type="button" className="primary" onClick={() => void handleCopy()}>
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
            <a className="button-link" href={link} target="_blank" rel="noopener noreferrer">
              Abrir link
            </a>
          </div>
        </li>
      </ul>
    </section>
  );
}
