# Territory Management MVP

The MVP enables administrators to manage urban territories and gives assigned field workers a safe, no-login map view while recording partial coverage honestly.

## Product intent

Administrators need auditable control over territory boundaries, assignments, and progress. Field workers need a scoped view of an assigned territory without exposing identities, notes, or administrative data.

## Users

| User | Need |
| --- | --- |
| Administrator | Define territory geometry, manage assignments, record progress, and inspect immutable history. |
| Assigned field worker | Open a revocable, read-only link to one territory and understand approved coverage status. |
| Maintainer | Approve provider evidence, privacy decisions, and operational controls before production use. |

## Scope

- Versioned, administrator-managed territory polygons and lifecycle state.
- Assignment, return, completion, and reasoned reopening with append-only history.
- Timestamped progress notes with optional pause point, route, and remaining-area geometry.
- Scoped, revocable, optionally expiring public links for an active assignment.
- A real-city map-provider validation gate before production provider selection.

## Non-goals

- Cadastral or legal boundary certification.
- Household or member records.
- Turn-by-turn routing or offline synchronization.
- Automatic territory generation.
- Provider procurement or production map integration before validation approval.

## Capabilities and delivery state

| Capability | MVP intent | Current state |
| --- | --- | --- |
| Territory administration | Immutable polygon revisions, lifecycle, assignment, and audit history. | Planned; no production workflow is implemented. |
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

- Administrators can audit territory, assignment, and partial-progress revisions.
- Field workers can distinguish approved covered, paused, and remaining information without publishing sensitive details.
- A provider is selected only after documented precision, access, cost, and reuse validation.
- Public access is scoped, revocable, non-indexable, and cannot authorize administrative actions.

## Open decisions

- City boundary source and its permitted use.
- Minimum retention period and deletion process for visit/progress data.
- Whether public sharing may ever show assignee identity; current default is no exposure.
- Overlap exception authority and review path.
- Reopen authority, mandatory reason, and audit review process.
- Provider budget and written provider/AMVA approvals.
