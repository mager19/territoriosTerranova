/**
 * Which territory a share URL points at.
 *
 * Since the 2026-10-03 product decision (AGENTS.md "Privacy rules") links are
 * readable and fixed: `/t/<slug>`, e.g. `/t/nv-01`. Legacy links carry an
 * opaque token in the fragment (`/#<token>`, token.ts) and keep working.
 * A `/t/` path that is not a URL-safe slug is rejected outright, never
 * fetched and never reinterpreted as a token.
 */

import { extractToken } from './token.js';

export type ShareLink = { readonly kind: 'slug'; readonly slug: string } | { readonly kind: 'token'; readonly token: string };

/** The same shape the API accepts (sharing/repository.ts PUBLIC_SLUG_PATTERN). */
export const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;

const SLUG_PATH_PREFIX = '/t/';

export function parseShareLink(pathname: string, hash: string): ShareLink | null {
  if (pathname.startsWith(SLUG_PATH_PREFIX)) {
    const slug = pathname.slice(SLUG_PATH_PREFIX.length).replace(/\/$/, '');
    return SLUG_PATTERN.test(slug) ? { kind: 'slug', slug } : null;
  }
  const token = extractToken(hash);
  return token === null ? null : { kind: 'token', token };
}

/** The public API path for a share link — never an admin endpoint (A6 brief). */
export function publicTerritoryPath(link: ShareLink): string {
  return link.kind === 'slug'
    ? `/public/t/${link.slug}`
    : `/public/territories/${encodeURIComponent(link.token)}`;
}
