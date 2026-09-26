# A3 — Domain & Admin API

**Mission**: The core of the product. Territory lifecycle, immutable revisions,
sharing, progress, audit trail, and the administrator API over them. (Originally
"assignments" — superseded 2026-09-08, see Slice 2 below.)

**Reasoning load**: High — this agent decides the invariants everything else trusts
**Depends on**: A2
**Blocks**: A4, A5
**Milestones**: M1 (slice 1), M2 (slices 2–3)

## Read first

`docs/agents/README.md`, `AGENTS.md`, `PRD.md`

## Owns

`apps/api/src/domain/**`, `apps/api/src/routes/admin/**`, `apps/api/src/db/**`

## Work in three sequential slices

Commit and verify each slice before starting the next. Do not build all three and
test at the end — that is how the previous attempt produced 2,889 unverified lines.

### Slice 1 — Territory and revisions (M1)

Create a territory with WGS84 GeoJSON geometry. Every geometry change writes a
**new revision**; nothing is ever updated in place. Lifecycle states are explicit
and every transition writes an audit event.

Endpoints: create territory, list, read (with revision history), submit new revision.

### Slice 2 — Assignment (M2) — superseded 2026-09-08

**This slice as originally briefed no longer exists.** Territories are shared to
the volunteer group, not assigned to one named person — there is no single
responsible party, no minimum, and no completion requirement
(db/migrations/0004_remove_individual_assignment.sql). The `assignments` table,
its domain module, and its admin routes were deleted; "share this territory"
(A4's share-token creation) is now the whole admin action. Kept here, struck
through in spirit rather than deleted outright, so a future reader can see what
was originally decided and why it changed — see AGENTS.md "Architecture
guardrails" for the current invariant.

~~Assign a territory to a field worker, return it, complete it, and reopen it with
a mandatory reason. An assignment references a specific revision id, so history
stays coherent when geometry later changes. Exactly one active assignment per
territory, enforced transactionally against the constraint A2 built.~~

### Slice 3 — Progress and audit (M2)

Append timestamped progress entries with optional pause point, route, and
remaining-area geometry. Expose the full audit history for a territory.

**Superseded in part 2026-09-26 (coverage sessions,
`db/migrations/0007_progress_covered_area.sql`):** every new entry is a
session that REQUIRES the area covered in it; the client no longer sends a
remaining area. The server derives it as (latest remaining area of the current
cycle) minus (covered area), under the territory row lock. When the cycle has
no remaining area yet, the request must carry the explicit
`baseline: 'whole_territory'` confirmation (otherwise `baseline_required`);
reopened cycles need a new baseline. Covered area, pause point, and route must
lie within the current revision. Full coverage stores an explicit empty
polygon (0% left), never NULL. The admin operational state exposes
`progressPercent` (geodesic areas; null = unknown). `covered_area` is admin
only and never part of the public view.

## Definition of done

- [ ] Server-side geometry validation rejects invalid, zero-area, out-of-city, and
      unauthorized overlapping polygons — with a distinct error per cause, never a
      generic 400
- [ ] Attempting to mutate an existing revision fails; a test proves it
- [ ] Every lifecycle transition writes an audit event with actor, timestamp, and
      reason where required
- [ ] ~~Reopening without a reason is rejected~~ — N/A, superseded 2026-09-08
- [ ] ~~Concurrency test: parallel assignment requests for one territory yield
      exactly one active assignment; the loser gets a clear conflict response~~ —
      N/A, superseded 2026-09-08 (no more per-person assignment slot to race for)
- [ ] Coverage is never inferred from a territory polygon. An absent remaining-area
      geometry means **unknown**, and the API says so explicitly
- [ ] Every endpoint has unit tests for its validation branches
- [ ] `pnpm test` passes with real assertions; `pnpm typecheck` exits 0

## Hard constraints

- **Never repair geometry silently.** Reject it and say why. Silent repair
  produces territories nobody drew.
- **Derive current state from history.** No denormalized status column that can
  drift from the event log.
- Application-owned geometry is RFC 7946 WGS84 GeoJSON. AMVA data is a drafting
  reference only and never becomes territory geometry by default.
- Admin endpoints are administrator-authenticated. You own that boundary; A4 owns
  the public one. A share token is **never** an administrator principal — do not
  build any code path where one could become one.
- No household or member records. Ever.
- Do not touch `apps/api/src/sharing/**` or `apps/api/src/routes/public/**`. If you
  need something there, report it to the orchestrator.

## Handoff

Report each slice separately with its own commit. Include the concurrency test
output verbatim — it is the invariant most likely to be quietly wrong.
