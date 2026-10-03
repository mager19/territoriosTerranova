# Territory Management Contributor Guide

This repository is a clean restart. Treat every capability as unimplemented unless
you can point at code and a test that runs.

## Repository state

`main` is an orphan branch with no implementation. A first attempt was abandoned
and is preserved verbatim on `archive/first-attempt` (37 files, prototype only:
no API, no database schema, no domain model, no auth). Read it for reference if
useful, but do not restore it — its provider-approval gate was placed on the
critical path of development and blocked all downstream work.

## Documents

- `PRD.md` — product intent, scope, risks, and open decisions.
- `docs/map-references.md` — verified AMVA/IDEM endpoint evidence and basemap config.

Keep planning documents in English. Do not reference a document that does not
exist; if you cite a file here, create it in the same change.

## Architecture guardrails

- Application-owned geometry is RFC 7946 WGS84 GeoJSON and is the system of record.
  Map providers render, search, or supply optional reference overlays; they never
  own domain geometry.
- Preserve immutable territory revisions, progress entries, and audit events.
  Derive current state rather than mutating history.
- Validate geometry server-side. Reject invalid, zero-area, out-of-city, or
  unauthorized overlapping geometry rather than repairing it silently.
- Territories are shared to the volunteer group, not assigned to one named person
  (2026-09-08 product decision, db/migrations/0004_remove_individual_assignment.sql
  — superseding the original "one active assignment per territory" invariant this
  bullet used to state). A share token and progress entries attach directly to the
  territory; there is no per-person claim, no minimum, and no completion
  requirement to enforce.
- Keep administrative and public boundaries separate. A share token is a scoped
  public bearer secret, never an administrator principal.

## Map provider policy

The provider-approval gate is a **production** requirement, not a development
blocker. Development proceeds on MapLibre GL JS with OpenStreetMap raster tiles
(see `docs/map-references.md`). A production tile-service decision — traffic,
availability, terms, cost — remains open and must be recorded before launch.

AMVA `sim.metropol.gov.co` layers are an administrator-only drafting reference,
verified reachable and usable as WGS84 GeoJSON. Never expose those layers, their
attributes, or their MapServer URLs in a public share view. Written AMVA/Bello
reuse and freshness approval is still required before production use.

## Privacy rules

- Public data must be minimized: expose only one territory's approved map
  information. Exclude identity, notes, timestamps, history, other territories,
  and municipal attributes by default. Deliberate exceptions, each exposed by
  explicit product decision because volunteers need them to resume work:
  - the current cycle's latest recorded progress route line (a LineString),
    2026-09-08;
  - the current cycle's covered area merged server-side into ONE
    Polygon/MultiPolygon (ST_Union), 2026-09-26;
  - the current cycle's latest session note, 2026-10-03 product decision,
    exposed so volunteers know where to resume (it replaced the pause point,
    which is no longer public). Only the single latest entry's note: if it
    has none, nothing is shown — never an older note. Admins are warned in
    the recording UI not to write personal data in it.
  Older notes, per-session geometries, session count, timestamps, recordedBy,
  pause points, cycle number, baseline, and progress percentage stay excluded,
  so no history can be reconstructed.
  See docs/agents/A4-sharing.md and A6-public-web.md for the exact allowlist.
- Protect public endpoints with opaque high-entropy tokens, hash storage,
  revocation, optional expiry, HTTPS, rate limits, `no-store`, `noindex`, a
  restrictive referrer policy, and short justified access-log retention.
- Never record household or member data.

## Verification expectations

**A test script that prints a message and exits 0 is forbidden.** The abandoned
attempt did exactly that for its API and E2E suites, producing a green run that
asserted nothing. If a surface has no tests, it has no test script.

- Unit tests for validation, token hashing, DTO minimization, and lifecycle transitions.
- PostGIS integration tests for containment, overlap, concurrent geometry writes,
  immutable history, and share-link revocation/expiry.
- End-to-end tests for admin history and public-scope boundaries, including the
  absence of sensitive fields.
- Do not infer remaining coverage from a territory polygon. An omitted
  remaining-area geometry means unknown.

## Working agreement

- Commit working increments. The previous attempt produced 2,889 lines without a
  single commit and lost its entire working tree.
- Build vertical slices: one capability end to end, with real tests, before
  starting the next.
