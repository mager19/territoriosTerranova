import { normalizeIP } from '@fastify/rate-limit';

/**
 * A per-client rate-limit key that names its bucket, e.g.
 * `admin-login:203.0.113.7`. The IP goes through the plugin's own
 * normalizeIP (IPv6 addresses collapse to their /64), exactly like the
 * plugin's default key, so limits behave as before; the bucket prefix keeps
 * two limiters apart in a shared store (pg-store.ts).
 */
export function rateLimitKey(bucket: string, ip: string): string {
  return `${bucket}:${normalizeIP(ip)}`;
}
