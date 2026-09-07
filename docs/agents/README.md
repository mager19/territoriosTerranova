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
| A1 | `bootstrap` | Toolchain, monorepo, CI-able scripts | Standard |
| A2 | `data` | PostGIS schema, migrations, AMVA barrio seed | High |
| A3 | `domain` | Territory revisions, assignment, progress, audit, admin API | High |
| A4 | `sharing` | Share tokens, public API, DTO minimization | High — security critical |
| A5 | `admin-web` | MapLibre territory editor and admin UI | Standard |
| A6 | `public-web` | No-login read-only territory view | Standard |
| A7 | `verifier` | Adversarial verification, integration and E2E tests | High |

"Reasoning load" is a hint for model-tier selection in your runner. High-load
agents make invariant decisions that are expensive to get wrong.

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

## Required reading for every agent

- `PRD.md` — product intent, scope, non-goals
- `AGENTS.md` — architecture guardrails and privacy rules
- `docs/map-references.md` — verified AMVA endpoints, layer ids, payload sizes
