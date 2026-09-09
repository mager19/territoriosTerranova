# Agent Roster and Working Model

This directory defines the agents for the Territory Management project, the work
assigned to each, and the rules they all operate under.

These briefs are **tool-agnostic and model-agnostic**. Each one is self-contained:
an agent with no prior conversation history can execute it from the brief plus the
repository. Nothing here depends on a specific vendor, IDE, or runtime.

## Why this structure exists

A first attempt at this project failed and is preserved on `archive/first-attempt`.
Its postmortem drives every rule below:

| What went wrong | Rule it produced |
| --- | --- |
| 2,889 lines written, **zero commits**, working tree lost | Every work unit ends in a commit |
| `test:api` was `node -e "console.log(...)"` — exited 0, asserted nothing | A test script that cannot fail is forbidden |
| `AGENTS.md` cited `specs/`, `docs/architecture.md`, `docs/tasks.md` — none existed | Never cite a file you did not create |
| Built a 130-line provider-approval gate; built zero domain model | Vertical slices before layers |
| Hardcoded AMVA `layer: 15` without checking it | No claim without a command and its output |

The failure was **not** a shortage of agents. It was ceremony instead of delivery.
Keep the roster small and make every definition of done machine-checkable.

## The seven agents

| # | Id | Mission | Reasoning load |
| --- | --- | --- | --- |
| A0 | `gate` | Read-only mechanical audit of a work-unit branch | Standard |
| A1 | `bootstrap` | Toolchain, monorepo, CI-able scripts | Standard |
| A2 | `data` | PostGIS schema, migrations, AMVA barrio seed | High |
| A3 | `domain` | Territory revisions, assignment, progress, audit, admin API | High |
| A4 | `sharing` | Share tokens, public API, DTO minimization | High — security critical |
| A5 | `admin-web` | MapLibre territory editor and admin UI | Standard |
| A6 | `public-web` | No-login read-only territory view | Standard |
| A7 | `verifier` | Adversarial verification, integration and E2E tests | High |

"Reasoning load" is a hint for model-tier selection in your runner. High-load
agents make invariant decisions that are expensive to get wrong.

## Branch workflow — nothing reaches `main` unreviewed

Every work unit gets its own branch. Agents commit there and **never** merge,
rebase, push, or switch to `main`. Those commands are denied in `opencode.json`,
so this is a runtime wall, not an instruction a model can forget.

```
main                    accepted work only
 └── wu/a1-bootstrap    one work unit, one branch
     wu/a2-data
     wu/a3-domain-s1    sliced briefs get one branch per slice
```

The cycle for every work unit:

1. Human creates the branch: `git switch -c wu/<agent>-<slice>`
2. Implementer agent works and commits **only on that branch**
3. **A0 gate** audits the branch mechanically and emits ACCEPT or REJECT
4. Human reviews A0's verdict, plus the judgment calls A0 flagged
5. External review (a different model family) reads the diff
6. **Human merges to `main`** — this step belongs to no agent

Only after a merge does the next dependent agent branch from `main`. That is what
keeps `main` a trustworthy baseline for A3 to build on after A2, and so on.

### Why no agent orchestrates the others

Every agent here is `mode: primary`, which in OpenCode means it is human-selectable
and **cannot be spawned by another agent**. This is deliberate.

An agent that both delegates work and judges the result becomes the judge of its
own delegation. Combined with the failure mode these models actually have —
reporting success instead of reporting blocked — an auto-orchestrator gives you a
model reporting success about another model's reported success, and you see only
the top layer. Failures also stop being cheap: A2 → A3 → A5 would all run on a
bad foundation before anyone looked.

The archived first attempt **had** automated orchestration: SDD phases, verify
reports, review budgets. It produced a report reading `verdict: fail,
blockers: 14, requirements: 1/7`, and the response was to normalize the test
scripts until they passed. Automation did not save that attempt; it participated.

A0 automates the mechanical half of the gate so human attention goes to judgment.
It cannot edit, cannot launch, cannot merge.

## Dependency graph

```
A1 bootstrap
 └─> A2 data
      └─> A3 domain
           ├─> A4 sharing ──> A6 public-web
           └─> A5 admin-web

A7 verifier runs continuously against whatever exists.
```

Safe to run in parallel: **A4 and A5** (once A3 lands). Everything else is
sequential — they share invariants and would conflict.

## Milestones — vertical slices, not layers

Ship a working slice end to end before starting the next. This is the single most
important correction to the previous attempt.

| Milestone | Outcome a human can see | Agents |
| --- | --- | --- |
| **M1** | An administrator draws a polygon on a Bello map and it persists as an immutable revision | A1, A2, A3, A5 |
| **M2** | That territory is assigned, progress is recorded, and history is auditable | A3, A5 |
| **M3** | A revocable public link shows one territory with no sensitive data | A4, A6, A7 |

Do not start M2 until M1 runs. Do not start M3 until M2 runs.

## File ownership — collision boundaries

Agents running in different tools cannot see each other's edits. Each path has
exactly one owner. Touching another agent's paths is a protocol violation: report
the needed change to the orchestrator instead.

| Path | Owner |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `docker-compose.yml`, `.github/` | A1 |
| `db/migrations/**`, `db/seed/**`, `packages/geo/**` | A2 |
| `apps/api/src/domain/**`, `apps/api/src/routes/admin/**`, `apps/api/src/db/**` | A3 |
| `apps/api/src/sharing/**`, `apps/api/src/routes/public/**` | A4 |
| `apps/admin/**` | A5 |
| `apps/public/**` | A6 |
| `tests/e2e/**`, `tests/integration/cross-boundary/**` | A7 |
| `docs/**`, `PRD.md`, `AGENTS.md` | Orchestrator |

Unit tests live beside the code they test and belong to that code's owner.

## Handoff contract

Every agent ends its run by returning this block. An agent that cannot fill a
field says so explicitly — it never guesses.

```markdown
## Agent: <id>   Work unit: <name>   Status: complete | partial | blocked

### Files changed
<path — one line each, with added/modified/deleted>

### Commands run
<command> -> exit <code>
<relevant output excerpt, verbatim>

### Definition of done
- [x] <criterion> — evidence: <command output, file:line, or test name>
- [ ] <criterion> — NOT MET because <reason>

### Not done
<anything in scope that was left out, and why>

### Open questions for the orchestrator
<blocking decisions only, or "none">

### Commit
<sha> <subject>
```

## Universal rules

These bind every agent. They are not style preferences.

1. **Commit every work unit.** Conventional commits. No AI attribution or
   `Co-Authored-By` trailers.
2. **A test script that cannot fail is forbidden.** If a surface has no tests, it
   has no test script. Never make a suite pass by weakening it.
3. **No claim without evidence.** "Verified", "works", and "passing" require a
   command and its output in the handoff.
4. **Never cite a file you did not create.** Check before referencing.
5. **Application-owned geometry is RFC 7946 WGS84 GeoJSON** and is the system of
   record. Map providers and AMVA layers only render or reference.
6. **Never record household or member data.**
7. **Stay inside your paths.** See the ownership table.
8. **Report blockers, do not route around them.** A blocked slice reported honestly
   is worth more than a green run that asserts nothing.

## Stack decisions

Taken by the orchestrator so agents do not each re-litigate them. Override at the
project level if you disagree — but override once, in this file, not per agent.

| Concern | Decision | Rationale |
| --- | --- | --- |
| Package manager | pnpm workspaces | Lockfile from the archived attempt is reusable |
| Language | TypeScript, `strict: true` | Domain invariants belong in the type system |
| API framework | Fastify | The archived attempt configured Vite for the API — wrong tool for a server |
| Database | PostgreSQL 16 + PostGIS 3.4 | `docker-compose.yml` already proven |
| Migrations | Plain SQL, forward-only | PostGIS geometry types fight ORMs; raw SQL is honest |
| DB access | `pg` with hand-written SQL | Containment and overlap need real PostGIS functions |
| Admin UI | Vite + React + MapLibre GL JS | Editor state is genuinely complex |
| Public UI | Vite + MapLibre, no framework | Smaller bundle, smaller attack surface |
| Unit/integration tests | Vitest | Already in the lockfile |
| PostGIS integration tests | Testcontainers | Real PostGIS, not a mock |
| E2E | Playwright | Already in the lockfile |

## Still open — orchestrator must resolve

These block production, not development. Do not let an agent invent an answer.

- Production tile service (OSM public tiles are rate-limited and not for production traffic)
- Progress-data retention period and deletion process
- Whether a public view may ever show assignee identity — current default is no
- Overlap exception authority and review path
- Reopen authority and audit-review process
- Written AMVA/Bello reuse and freshness approval

## Deferred product scope — future work

Confirmed gaps against the original product vision, found while comparing the
merged A1–A5 build against it on 2026-09-08. Not blocking A6/A7; parked here
for later planning.

- **Territory composition from real manzanas.** Today a territory is a
  freehand polygon drawn inside a barrio boundary, not a set of actual
  cadastral manzana (city block) polygons. AMVA's POT_Bello `Manzanas` layer
  (id 15) carries only `OBJECTID`, `AREA`, `PERIMETER` — no name or code —
  which is why it was never seeded. **Updated 2026-09-09: a usable source
  now exists.** A different, previously unknown AMVA service —
  `portalidem.metropol.gov.co/server/rest/services/Bello_Catastro/MapServer`
  — has a `Manzanas` layer (id 3) with real `MANZANA` codes linked to a
  `BARRIO` code, plus `Barrios` (id 2), `Construcciones` (5/6) and `Predios`
  (7/8). Verified live: Guasimalito resolves to 24 manzana polygons in WGS84.
  One caveat found and unresolved — `MANZANA` is **not unique** within a
  barrio (code `0011` appears on 8 separate polygons there), so whether those
  are fragments of one block or a data defect needs investigating before any
  composition logic is built on it. See also the barrio-to-territory gap
  below, which is the prerequisite either way.
- **No barrio-to-territory relationship in the data model.** Raised
  2026-09-09 when an administrator drew Guasimalito and reported it looked
  far too small: a territory is one manzana by design, so a barrio needs
  several — but nothing in the schema expresses "these territories together
  cover this barrio". Territory names are free text. The 2026-09-09 barrio
  reference overlay (`GET /admin/reference/barrios`) is a drawing aid only;
  it does not make "how much of Guasimalito is covered?" answerable. Likely
  a `barrio` reference on `territories`; small change, and it also unlocks
  the statistics item below.
- **Scheduled/planned work date on a territory.** There is no planned-date
  field at all — nothing expresses "this territory is worked on [date]".
  (Originally noted against `assignments.assigned_at`, a table dropped by
  `0004`; the gap itself is unchanged.)
- **Statistics per territory over time.** No aggregation endpoint or view
  exists. The raw timestamped data is there (`progress_entries`,
  `audit_events`), so this is additive, not a schema change.
- **Color-coded staleness by time since last worked.** Raised 2026-09-08
  during A6 live testing: territory boundary fill uses a placeholder purple
  tint (`apps/public/src/map.ts`) meant to eventually carry meaning — e.g.
  green/yellow/red by how long a territory has gone unworked. Needs a
  "last worked" query (derivable from `progress_entries` timestamps, no
  schema change) and an agreed color scale/thresholds. Note the admin
  territory LIST shows no state at all either — to decide what to send the
  group next week, an administrator must open each territory one by one.
- **Snapping ("magnetic") when drawing a route or territory geometry.**
  Raised 2026-09-08: a manually-recorded demo route visibly didn't hug the
  real block edge. **Partially resolved 2026-09-08** — point-by-point vertex
  editing now exists (drag to move, click an edge to insert, double-click to
  remove) in both the territory editor and ProgressRecorder. Snap-to-boundary
  does not: geometry is still placed by eye. Overpass was checked
  2026-09-08 as a snap target and the OSM street network over central Bello
  is dense enough (983 highway segments, 564 named, over ~2km²) — unlike its
  buildings, which are far too sparse (91) to be useful for anything.

### Open questions for the team — ask before building

- **Should a volunteer be able to record progress from the share link?**
  Raised 2026-09-09; deliberately parked for the team to decide, not a
  technical blocker. Today progress is admin-only: the volunteer who walked
  the territory tells the administrator, who redraws the route from a verbal
  description. That makes the administrator a bottleneck for 10–15 people and
  means the progress data is probably not being captured at all in practice —
  which leaves the whole coverage feature, including the public view's
  covered-stretch line, effectively decorative.
  The infrastructure is mostly there: the token is already scoped to a
  territory, the public view already renders the map, and route drawing
  already exists in `draft.ts`.
  **The decision to make:** the share token is currently a read-only bearer
  secret, and this would make it write-capable. The link circulates freely in
  a group chat and could leak beyond it. Mitigating: `progress_entries` is
  append-only and audited, so the worst case is a wrong line that is visible
  and destroys nothing. Not a decision to take unilaterally.

## Required reading for every agent

- `PRD.md` — product intent, scope, non-goals
- `AGENTS.md` — architecture guardrails and privacy rules
- `docs/map-references.md` — verified AMVA endpoints, layer ids, payload sizes
