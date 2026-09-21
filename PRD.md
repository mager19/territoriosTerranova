# Territory Management MVP

The MVP enables administrators to manage urban territories and lets a volunteer open a safe, no-login map view to see what's shared and record partial coverage honestly. (2026-09-08: territories are shared to a group of volunteers, not assigned to one named person — see "Superseded 2026-09-08" note below.)

## Product intent

Administrators need auditable control over territory boundaries, sharing, and progress. Volunteers need a scoped view of a shared territory without exposing identities, notes, or administrative data.

## Users

| User | Need |
| --- | --- |
| Administrator | Define territory geometry, share it with the volunteer group, record progress, and inspect immutable history. |
| Volunteer | Open a revocable, read-only link to a shared territory and understand approved coverage status; self-select which shared territory to work, with no minimum or completion requirement. |
| Maintainer | Approve provider evidence, privacy decisions, and operational controls before production use. |

## Scope

- Versioned, administrator-managed territory polygons and lifecycle state.
- Sharing a territory to the volunteer group via a scoped, revocable, optionally expiring public link — with append-only history.
- Timestamped progress notes with optional pause point, route, and remaining-area geometry, recordable by anyone with the link, at any time.
- A real-city map-provider validation gate before production provider selection.

### Superseded 2026-09-08 (was: individual assignment)

The MVP originally specified assigning a territory to one named field worker
(assign/return/complete/reopen with a mandatory reason). Live testing surfaced
that the real organizational model is 1-2 administrators and 10-15 volunteers:
an admin decides which territory to open for volunteering and shares one link to
the whole group; whoever picks it up does what they can, with no minimum and no
requirement to finish. There is deliberately no single "responsible party" for
the system to track. See db/migrations/0004_remove_individual_assignment.sql and
AGENTS.md "Architecture guardrails" for the current model.

## Non-goals

- Cadastral or legal boundary certification.
- Household or member records.
- Turn-by-turn routing or offline synchronization.
- Automatic territory generation.
- Provider procurement or production map integration before validation approval.

## Capabilities and delivery state

| Capability | MVP intent | Current state |
| --- | --- | --- |
| Territory administration | Immutable polygon revisions, lifecycle, sharing, and audit history. | Planned; no production workflow is implemented. |
| Field coverage progress | Immutable partial-coverage records without inferred completion. | Planned. |
| Public sharing | Minimal, revocable anonymous read-only map access. | Planned. |
| Provider validation | Evidence-based approval across real local references. | Prototype gate and scorecard exist; live evaluation and approval are pending. |
| Prototype editor | Local/prototype-only application-owned WGS84 draft-boundary interaction. | Implemented prototype behavior; not a validated backend workflow. |

## Risks

| Risk | Mitigation |
| --- | --- |
| Local data or provider mapping is misleading | Require a documented precision and suitability gate before selection. |
| Public links disclose sensitive activity | Minimize response data and make links opaque, revocable, expiring, and non-indexable. |
| Geometry edits lose context | Preserve revisions and append-only audit history. |
| Municipal data reuse is restricted | Verify service metadata, terms, access, freshness, and written approvals before use. |

## Success criteria

- Administrators can audit territory, sharing, and partial-progress revisions.
- Volunteers can distinguish approved covered, paused, and remaining information without publishing sensitive details.
- A provider is selected only after documented precision, access, cost, and reuse validation.
- Public access is scoped, revocable, non-indexable, and cannot authorize administrative actions.

## Open decisions

- City boundary source and its permitted use.
- Minimum retention period and deletion process for visit/progress data.
- Whether public sharing may ever show volunteer identity; current default is no exposure.
- Overlap exception authority and review path.
- Provider budget and written provider/AMVA approvals.
