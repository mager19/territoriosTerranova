# Territory Management

Monorepo for the Territory Management MVP: administrators manage urban
territory boundaries and assignments; field workers get a scoped, no-login,
revocable map view. Product intent lives in [PRD.md](PRD.md); architecture
guardrails live in [AGENTS.md](AGENTS.md); the agent roster and file-ownership
map live in [docs/agents/README.md](docs/agents/README.md).

Current state: bootstrapped skeleton (milestone M1 toolchain). No domain
logic, schema, or map editor exists yet — treat every capability as
unimplemented until you can point at code and a test that runs.

## Prerequisites

- Node.js >= 22.12 (developed on 22.20)
- pnpm 10 (`corepack enable` reads `packageManager` from package.json)
- Docker with Compose v2

## Setup

```sh
pnpm install
docker compose up -d
docker compose exec -T postgis psql -U territorios -d territorios -c 'SELECT postgis_version();'
```

The last command must print a `postgis_version` row (3.4). Everything else
below assumes the database container is running.

## Environment

Optional: `cp .env.example .env`. The defaults baked into the API match
`docker-compose.yml`, so a plain local setup needs no `.env` at all. To sign in
to the admin app, set an admin account in `.env.local` (git-ignored; the API
loads it after `.env`). See [docs/admin-auth.md](docs/admin-auth.md).
Variables actually read by code (all in `apps/api`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://territorios:territorios@127.0.0.1:5432/territorios` | PostgreSQL/PostGIS connection string |
| `PORT` | `3000` | API listen port |
| `HOST` | `127.0.0.1` | API bind host |
| `ADMIN_1_EMAIL` / `ADMIN_1_PASSWORD` | unset (nobody can sign in) | First admin account. Required in production. Password at least 12 characters |
| `ADMIN_2_EMAIL` / `ADMIN_2_PASSWORD` | unset | Optional second admin account |
| `ADMIN_APP_ORIGIN` | `http://localhost:5173` | Admin app origin, used for the CSRF Origin check and the `Secure` cookie flag. Required (`https`) in production |
| `TRUST_PROXY` | `false` | Proxy hops in front of the API, so the sign-in rate limit sees real client IPs |

The admin app calls the API through a same-origin `/api` prefix (a Vite proxy
locally, a Vercel rewrite in production). Open it at `http://localhost:5173`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | API on `http://127.0.0.1:3000`, admin on `:5173` (proxies `/api` to the API), public on `:5174` |
| `pnpm typecheck` | `tsc -b` over every workspace via project references |
| `pnpm lint` | ESLint (flat config) over the repo |
| `pnpm test` | Vitest in every workspace (real assertions; no placeholder scripts) |
| `pnpm build` | Builds all workspaces: `tsc` for api/geo, Vite for admin/public |
| `pnpm db:up` / `pnpm db:down` | Start/stop the PostGIS container |
| `pnpm db:psql` | psql shell into the `territorios` database |

Health check (requires the database container):

```sh
curl -s http://127.0.0.1:3000/health
# {"status":"ok","database":{"up":true,"postgisVersion":"3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"}}
```

`/health` executes `SELECT postgis_version()` on every request. If the
database is down it answers `503` with `{"status":"unavailable","database":{"up":false}}` —
it is never a hardcoded ok.

## Layout

| Path | What it is |
| --- | --- |
| `apps/api` | Fastify + TypeScript service (Node ESM, `pg`, hand-written SQL) |
| `apps/admin` | Vite + React + TypeScript + MapLibre admin console skeleton |
| `apps/public` | Vite + TypeScript + MapLibre public view skeleton (no framework) |
| `packages/geo` | Shared RFC 7946 WGS84 GeoJSON types and validation helpers |
| `db/migrations`, `db/seed` | Plain-SQL forward-only migrations and seed (empty; owned by the data agent) |
| `tests/e2e`, `tests/integration/cross-boundary` | Cross-boundary suites (empty; owned by the verifier agent) |

Playwright is configured at the root (`playwright.config.ts`) but no E2E
script is registered yet: per `AGENTS.md`, a surface with no tests has no
test script.

## CI

`.github/workflows/ci.yml` runs the same commands as above on every push and
pull request: frozen install, PostGIS via compose, `typecheck`, `lint`,
`test`, a `pnpm dev` smoke that curls all three apps, `build` with artifact
checks, and a live `/health` probe against the built server.
