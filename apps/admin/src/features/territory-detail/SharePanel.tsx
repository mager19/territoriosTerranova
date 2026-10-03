import { useState, type JSX } from 'react';

import {
  ApiError,
  createShareToken,
  DEFAULT_ACTOR,
  describeApiError,
  revokeShareToken,
  PUBLIC_APP_BASE_URL,
  type ShareToken
} from '../../api/client.js';

export interface SharePanelProps {
  readonly territoryId: number;
}

interface IssuedToken extends ShareToken {
  readonly revoked: boolean;
}

/**
 * "Share this territory" replaces the old assign/return/complete/reopen
 * lifecycle (2026-09-08: territories are shared to a group of volunteers,
 * not assigned to one named person — there is no single responsible party
 * for this panel to track, and no name to ask for). Each click issues a
 * fresh link; the plaintext token is shown here exactly once (A4's own
 * security design — only a hash is ever stored, so there is no "list of
 * past links" to fetch back later). Issued-this-session tokens stay
 * visible with a Revoke action so an admin can clean up a link they no
 * longer want live, without needing a separate GET-list endpoint this
 * session doesn't have.
 */
export function SharePanel({ territoryId }: SharePanelProps): JSX.Element {
  const [tokens, setTokens] = useState<readonly IssuedToken[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  function linkFor(token: string): string {
    return `${PUBLIC_APP_BASE_URL}/#${token}`;
  }

  async function handleShare(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await createShareToken(territoryId, { createdBy: DEFAULT_ACTOR });
      setTokens((current) => [...current, { ...created, revoked: false }]);
    } catch (caught) {
      setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo crear el link.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(tokenId: number): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await revokeShareToken(tokenId, DEFAULT_ACTOR);
      setTokens((current) => current.map((t) => (t.id === tokenId ? { ...t, revoked: true } : t)));
    } catch (caught) {
      setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo revocar el link.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(id: number, token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      // Clipboard access can be denied by the browser; the link is still
      // fully visible and selectable in the text field either way.
    }
  }

  return (
    <section aria-labelledby="share-heading">
      <h3 id="share-heading">Compartir</h3>
      <p>Envía este link al grupo de voluntarios. Cualquiera que lo tenga puede ver el territorio y registrar progreso.</p>

      <button type="button" className="primary" onClick={() => void handleShare()} disabled={busy}>
        Compartir este territorio
      </button>

      {error && <p role="alert">{error}</p>}

      {tokens.length > 0 && (
        <ul>
          {tokens.map((issued) => (
            <li key={issued.id}>
              {issued.revoked ? (
                <span>Link revocado (creado el {new Date(issued.createdAt).toLocaleString()})</span>
              ) : (
                <>
                  <input readOnly value={linkFor(issued.token)} aria-label="Link para compartir" />
                  <a href={linkFor(issued.token)} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                  <button type="button" onClick={() => void handleCopy(issued.id, issued.token)} disabled={busy}>
                    {copiedId === issued.id ? 'Copiado' : 'Copiar link'}
                  </button>
                  <button type="button" onClick={() => void handleRevoke(issued.id)} disabled={busy}>
                    Revocar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
