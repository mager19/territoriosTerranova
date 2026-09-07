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

### Token lifecycle

- Opaque, high-entropy tokens from a CSPRNG. Not sequential, not derived from any
  identifier, not guessable.
- Store a **hash**. The plaintext token is shown once at creation and never again.
- Scoped to exactly one active assignment.
- Revocable immediately, with optional expiry.
- Revocation and expiry take effect on the next request — no cache window.

### Public endpoint

Exactly one read-only endpoint returning one territory's approved map information.

The response is built by an **explicit allowlist**. Never serialize a domain
object and remove fields — that pattern leaks the moment someone adds a column.

Excluded by default, without exception: assignee identity, notes, timestamps,
routes, pause points, history, other territories, AMVA attributes, internal ids.

### Transport and headers

`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`,
`Referrer-Policy: no-referrer`, HTTPS only, rate limiting per token and per IP.
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

## Hard constraints

- **Allowlist, never denylist.** A denylist fails silently and permanently the
  first time the domain grows.
- **404 for everything unauthorized.** Revoked, expired, wrong scope, nonexistent —
  all identical responses.
- Never expose AMVA layers, their attributes, or MapServer URLs publicly.
- Do not modify `apps/api/src/domain/**` or admin routes. Request changes from the
  orchestrator.
- If a requirement seems to force a leak, **stop and report it**. Do not ship a
  compromise on this boundary.

## Handoff

List every key your public response can return, and the test that pins that list.
The orchestrator will review this specific list before M3 is accepted.
