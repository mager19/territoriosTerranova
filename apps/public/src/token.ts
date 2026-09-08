/**
 * The share token lives in the URL fragment (`#<token>`), never the path
 * or query string. A fragment is never sent to a server in an HTTP
 * request and is stripped from the Referer header by browsers before an
 * outbound request — so it structurally cannot appear in a server access
 * log or leak to the map-tile provider (A6 brief hard constraint: "the
 * share token never appears in a referrer ... or a logged URL beyond the
 * initial load").
 */
export function extractToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
