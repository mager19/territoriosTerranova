# A1 — Bootstrap

**Mission**: Make the repository runnable. Every other agent depends on this.

**Reasoning load**: Standard
**Depends on**: nothing
**Blocks**: all agents
**Milestone**: M1

## Read first

`docs/agents/README.md`, `AGENTS.md`, `PRD.md`

## Owns

`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`,
`docker-compose.yml`, `.env.example`, `.github/workflows/**`, `README.md`

## Context

`main` is an orphan branch containing only documentation. There is no code,
no toolchain, no database. The previous attempt's toolchain is on
`archive/first-attempt` and may be consulted, but its `apps/api` used a Vite
config for a server process — do not copy that mistake.

## Scope

Create the monorepo skeleton with these workspaces:

```
apps/api        Fastify + TypeScript service
apps/admin      Vite + React + TypeScript + MapLibre
apps/public     Vite + TypeScript + MapLibre, no framework
packages/geo    Shared GeoJSON types and validation helpers
db/             Migrations and seed scripts
tests/          Cross-boundary integration and E2E
```

Wire up:

- TypeScript `strict: true` with project references from `tsconfig.base.json`
- `docker-compose.yml` for PostgreSQL 16 + PostGIS 3.4 with a named volume
- `.env.example` documenting every variable actually read by code
- Vitest configured per workspace; Playwright at the root
- A CI workflow that runs typecheck, lint, and tests on push

Each app must have a minimal but **real** entry point: the API answers
`GET /health` with a live database check, and both web apps render a page.

## Definition of done

Machine-checkable. Every box needs a command and its output in the handoff.

- [ ] `pnpm install` completes with no error
- [ ] `docker compose up -d` starts PostGIS; `docker compose exec -T postgis psql -U territorios -d territorios -c 'SELECT postgis_version();'` returns a version
- [ ] `pnpm typecheck` exits 0 and covers every workspace
- [ ] `pnpm test` exits 0 and runs at least one **real** assertion per workspace
- [ ] `pnpm dev` starts the API and both web apps
- [ ] `curl -s localhost:<api-port>/health` returns 200 with database connectivity confirmed
- [ ] `pnpm build` produces artifacts for all three apps
- [ ] CI workflow file exists and its steps are the same commands as above
- [ ] `README.md` documents setup in commands a new contributor can paste

## Hard constraints

- **No placeholder test scripts.** The previous attempt shipped
  `"test:api": "node -e \"console.log('unavailable')\""`, which exits 0 and
  asserts nothing. If a workspace has no tests yet, write one real assertion
  against its health check. Never register a script that cannot fail.
- The `/health` check must actually query the database. A hardcoded `{ok:true}`
  is a lie the whole team will build on.
- Do not scaffold domain entities, routes, or map code. That is A2/A3/A5 work.
  Your job is the ground they stand on.
- Pin exact major versions. Report any package you could not resolve.

## Handoff

Use the contract in `docs/agents/README.md`. Include the full `pnpm test` output
so the orchestrator can confirm assertions actually ran.
