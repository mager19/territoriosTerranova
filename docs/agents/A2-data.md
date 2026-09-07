# A2 — Data & GIS

**Mission**: Own the database. Schema, migrations, spatial constraints, and the
AMVA barrio reference seed.

**Reasoning load**: High
**Depends on**: A1
**Blocks**: A3
**Milestone**: M1

## Read first

`docs/agents/README.md`, `AGENTS.md`, `docs/map-references.md` (contains the
verified AMVA endpoint, layer ids, field names, and payload measurements)

## Owns

`db/migrations/**`, `db/seed/**`, `packages/geo/**`

## Scope

### 1. Schema

Model the invariants from `AGENTS.md`. History is append-only; current state is
derived, never mutated.

- `territories` — identity and lifecycle state only
- `territory_revisions` — **immutable**. One row per geometry version, with
  `geometry geometry(Polygon, 4326)`, revision number, author, created_at. Never updated.
- `assignments` — references a specific `territory_revision_id`, not a territory
- `progress_entries` — append-only. Optional pause point, route, remaining-area geometry
- `audit_events` — append-only record of every state transition with actor and reason
- `share_tokens` — A4 owns the logic; you own the table. Store a **hash**, never
  the token. Columns for revocation and optional expiry.
- `reference_barrios` — the AMVA seed. Clearly separate from application-owned data.

### 2. Spatial constraints, enforced in the database

Application code is not the last line of defense.

- SRID 4326 enforced on every geometry column
- Reject non-simple, zero-area, and invalid polygons (`ST_IsValid`, `ST_Area`)
- Containment check against the Bello municipal boundary
- Overlap detection between active territories via `ST_Intersects` /
  `ST_Overlaps`, with an explicit authorized-exception path
- A partial unique index guaranteeing **at most one active assignment per
  territory** — this must hold under concurrent transactions

### 3. AMVA reference seed

Fetch layer 8 (`Limit_Municipal_POT_2009`) and layer 9 (`Barrios`, 139 features)
from the endpoint documented in `docs/map-references.md`.

- Always request `f=geojson&outSR=4326`. The service's native projection is a
  custom Azimuthal Equidistant on datum Bogotá — raw output is unusable.
- Always send `maxAllowableOffset`. Measured: full geometry is 2.0 MB, simplified
  at `0.00002` (~2.2 m) is 159 KB for the same 139 features.
- The seed script must be **idempotent** and must work from a cached local file so
  the build never depends on a government service being up. Commit the cached
  GeoJSON.
- Record the source URL, retrieval date, and AMVA attribution in the table.

## Definition of done

- [ ] `pnpm db:migrate` runs from an empty database to current with no error
- [ ] Migrations are forward-only; no migration edits a previously applied file
- [ ] `pnpm db:seed` loads 139 barrios plus the municipal boundary, and is
      idempotent (running it twice yields the same row counts)
- [ ] Integration test: inserting an invalid or zero-area polygon is **rejected by
      the database**, not by application code
- [ ] Integration test: a polygon outside the Bello boundary is rejected
- [ ] Integration test: two concurrent transactions assigning the same territory
      produce exactly one active assignment
- [ ] Integration test: updating a `territory_revisions` row fails
- [ ] All integration tests run against real PostGIS via Testcontainers
- [ ] `packages/geo` exports typed RFC 7946 helpers with unit tests

## Hard constraints

- The seeded AMVA data is a **drafting reference**, never a legal or cadastral
  boundary. It is POT 2009 vintage under a 2017 copyright.
- Never expose AMVA attributes or MapServer URLs to any public-facing path.
- Do not use an ORM for geometry. Hand-written SQL, as decided in the roster.
- `Manzanas` (layer 15) has only `OBJECTID`, `AREA`, `PERIMETER` — no names. The
  archived attempt hardcoded it by mistake. Use layer 9 for anything identifiable.

## Handoff

Include the row counts after seeding and the output of the concurrency test.
