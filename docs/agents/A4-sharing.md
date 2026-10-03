# A4 — Sharing & Public API

**Mission**: Let an assigned field worker open one territory without logging in,
and make it impossible for that link to leak anything else.

**Reasoning load**: High — this is the security boundary of the product
**Depends on**: A3
**Blocks**: A6
**Milestone**: M3
**Runs in parallel with**: A5

## Read first

`docs/agents/README.md`, `AGENTS.md` (privacy rules), `PRD.md` (risks)

## Owns

`apps/api/src/sharing/**`, `apps/api/src/routes/public/**`

## Scope

### Fixed public URLs (2026-10-03 product decision)

Share links are readable and fixed: `<public app>/t/<slug>`, e.g.
`https://publico-territorios.vercel.app/t/nv-01`, served by
`GET /public/t/:slug` (`apps/api/src/routes/public/territories.ts`). This
replaces issuing opaque token links. The user accepted the trade-offs
explicitly: slugs are guessable, so anyone who infers the pattern can see
every territory's public view, and access cannot be revoked per link.
Accepted because the volunteer group is small, the public view carries no
personal data (the allowlist below), and it is read-only. AGENTS.md
"Privacy rules" records the decision.

- **Slug**: `territories.slug` (db/migrations/0011_territory_slugs.sql).
  Normalized from the name once (`apps/api/src/domain/slug.ts`, mirrored by
  the SQL function `territory_slug_base`): NFD, strip accents, lowercase, every
  run of non `[a-z0-9]` becomes `-`, trim `-`, at most 60 characters,
  `territorio` when empty. Collisions get `-2`, `-3`, … (oldest id keeps the
  bare slug) under an advisory lock; a unique constraint is the backstop.
- **Stable**: the slug is assigned at creation and never changes — a database
  trigger rejects any update — so links already sent keep working. Renaming a
  territory (no route does this today) leaves its slug alone.
- **Same response**: the slug route returns exactly the token route's
  allowlisted body, built by the same query and response builder, with the
  same headers, CORS rule (public origin only, GET), and per-IP rate limit
  bucket. Like the token route, it does not filter on territory status.
- **Unknown or malformed slug** (anything not `^[a-z0-9-]{1,80}$`): the same
  neutral 404 `{ "error": "not_found" }`, without a database query for a
  malformed one.
- The token route `GET /public/territories/:token` stays for links already
  sent (legacy). The admin app no longer issues tokens.

### Token lifecycle (legacy links)

- Opaque, high-entropy tokens from a CSPRNG. Not sequential, not derived from any
  identifier, not guessable.
- Store a **hash**. The plaintext token is shown once at creation and never again.
- Scoped to exactly one active assignment.
- Revocable immediately, with optional expiry.
- Revocation and expiry take effect on the next request — no cache window.

### Public endpoint

Two read-only endpoints — by slug and by legacy token — returning one
territory's approved map information through one shared response builder.

The response is built by an **explicit allowlist**. Never serialize a domain
object and remove fields — that pattern leaks the moment someone adds a column.

Excluded by default: assignee identity, notes (except the single latest
session note below), timestamps, history, other territories, AMVA attributes,
internal ids.

Exact public allowlist (pinned by `apps/api/src/integration/sharing.test.ts`):
`territoryName`, `boundary`, `remainingArea`, `remainingAreaStatus`, `route`,
`coveredArea`, `note`. The deliberate inclusions beyond the original four,
each by explicit product decision because volunteers need them to resume work:

- **route** (2026-09-08): the current cycle's latest *recorded* route (a
  LineString) — a later entry without a route does not hide it.
- **coveredArea** (2026-09-26): the `ST_Union` of every covered area in the
  current cycle, returned as ONE Polygon/MultiPolygon, or null. Per-session
  geometries, session count, timestamps, recordedBy, notes, cycle number,
  baseline, and progress percentage are never exposed, so the session history
  cannot be reconstructed from it.
- **note** (2026-10-03): the note of the single LATEST progress entry of the
  current cycle (`recorded_at DESC, id DESC`), so volunteers know where to
  resume. If that latest entry has no (or a blank) note, `note` is null — it
  never falls back to an older note, which could be stale. Older notes and
  previous cycles' notes are never exposed. Admins are warned in the recording
  UI not to write personal data in it.

Removed: **pausePoint** was public from 2026-09-26 until 2026-10-03, when it
was dropped from the allowlist (admins found it confusing; the latest session
note replaces it). Recorded pause points stay in the database but are never
returned publicly.

All three are resolved inside the same single query with the same joins for
every token outcome (timing side-channel protection), and none relaxes the
identity/older-notes/timestamps/history exclusions above.

### Transport and headers

`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`,
`Referrer-Policy: no-referrer`, HTTPS only, rate limiting per token or slug
and per IP (one per-IP bucket shared by both routes).
Access logs minimized and short-retention.

## Definition of done

- [ ] Token generation uses a CSPRNG; a test asserts entropy and format
- [ ] Database stores only a hash; a test asserts the plaintext is absent
- [ ] Revoked token returns 404 — **not** 403. A 403 confirms the token existed.
- [ ] Expired token returns 404
- [ ] A valid token cannot read any other territory, by any parameter manipulation
- [ ] A share token cannot invoke **any** administrative action; a test attempts
      each admin route with a share token and asserts rejection
- [ ] Response-shape test enumerates the full set of returned keys and fails if a
      new one appears — this must break when someone adds a field carelessly
- [ ] Every required header is present; a test asserts each one
- [ ] Rate limiting is enforced and tested
- [ ] Timing of valid vs invalid token lookups does not leak existence
- [ ] The slug route returns the same body as the token route, with the same
      headers and limits, and the same 404 for an unknown or malformed slug
      (`integration/sharing.test.ts`, "GET /public/t/:slug")
- [ ] Slug normalization, backfill, suffixing, concurrency, and immutability
      are tested (`domain/slug.test.ts`, `integration/territory-slugs.test.ts`)

## Hard constraints

- **Allowlist, never denylist.** A denylist fails silently and permanently the
  first time the domain grows.
- **404 for everything unauthorized.** Revoked, expired, wrong scope, nonexistent —
  all identical responses. An unknown or malformed slug gets the same 404.
- Never expose AMVA layers, their attributes, or MapServer URLs publicly.
- Do not modify `apps/api/src/domain/**` or admin routes. Request changes from the
  orchestrator.
- If a requirement seems to force a leak, **stop and report it**. Do not ship a
  compromise on this boundary.

## Handoff

List every key your public response can return, and the test that pins that list.
The orchestrator will review this specific list before M3 is accepted.
