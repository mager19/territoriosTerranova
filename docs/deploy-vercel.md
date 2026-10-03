# Deploying to Vercel

Two Vercel projects deploy from this one repository. There is no separate API
host: the Fastify API runs as a Vercel Function inside the admin project.

| Project | Root Directory | Domain | Serves |
| --- | --- | --- | --- |
| `admin-territorios` | `apps/admin` | https://admin-territorios-flame.vercel.app | The admin SPA, and the whole API under `/api/*` |
| `publico-territorios` | `apps/public` | https://publico-territorios.vercel.app | The volunteer share view (static) |

The database is Neon Postgres 16 with PostGIS.

## How the API runs on Vercel

- `apps/admin/api/index.js` is the function. It only re-exports `handler`
  from `@territorios/api/vercel` (`apps/api/src/vercel.ts`).
- `apps/admin/vercel.json` rewrites every `/api/*` request to that function.
  The rewrite also carries the original path as `?__path=`. The SPA fallback
  (`index.html`) never matches `/api`.
- Each function instance builds one Fastify app on its first request and
  reuses it. The handler strips the `/api` prefix and passes the Node request
  to Fastify. Routes, cookies, and bodies behave as they do behind the local
  Vite proxy.
- The admin app calls `/api` on its own origin. The session cookie stays
  first-party, so `SameSite=Strict` keeps working.
- The public app calls the same API cross-origin. Only
  `GET /public/territories/:token` allows that, and only from
  `PUBLIC_APP_ORIGIN`, never with credentials.
- Region: `cle1` (Cleveland, AWS `us-east-2`), the same AWS region as the
  Neon database in Ohio. On Hobby, functions run in one region. Any region in
  the list can be chosen, and it is set in `vercel.json`.
- `maxDuration` is 30 seconds. API requests take milliseconds. The limit only
  caps a stuck request. Hobby allows up to 300 seconds.

### Why a function in `api/`, not Vercel Services

The [Vercel Services](https://vercel.com/docs/services) docs list Services
as Beta. A Node.js function in `api/` is the stable, documented way to add a
backend to a framework project:

- [Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js)
  covers `(request, response)` handlers in `/api`.
- [Function duration](https://vercel.com/docs/functions/configuring-functions/duration)
  and [regions](https://vercel.com/docs/functions/configuring-functions/region)
  cover the settings in `vercel.json`.
- [`attachDatabasePool`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
  releases idle pg connections before Fluid compute suspends an instance.
- [Request headers](https://vercel.com/docs/headers/request-headers): Vercel
  overwrites `X-Forwarded-For` with the client IP.

## Project settings

### `admin-territorios`

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `apps/admin` |
| Include files outside the Root Directory | Enabled (the default) |
| Install Command | default (`pnpm install`) |
| Build Command | `pnpm --filter @territorios/api build && vite build` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

The Build Command must build the API. `tsc -b` in `apps/api` also builds
`packages/geo`, and the function imports the compiled
`apps/api/dist/vercel.js`.

> **Changed:** the earlier Build Command was
> `pnpm --filter @territorios/geo build && vite build`. That command does not
> build the API, so the function would fail with
> `Cannot find module .../apps/api/dist/vercel.js`.

### `publico-territorios`

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `apps/public` |
| Build Command | `pnpm --filter @territorios/geo build && vite build` |
| Output Directory | `dist` |

The public app has no `vercel.json`. The share token lives in the URL
fragment (`/#<token>`), so the app has no client-side routes to rewrite.

## Environment variables

Set these for the **Production** environment. Preview deployments get
different URLs. They also need their own `ADMIN_APP_ORIGIN` and a database
that is not production, or no API variables at all.

### `admin-territorios` (the API)

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Turns on the production checks. The API refuses to start without the required variables. |
| `DATABASE_URL` | Neon **pooled** connection string | The host contains `-pooler`. Use `sslmode=verify-full`. See [Database connection](#database-connection). |
| `ADMIN_1_EMAIL` | first administrator's email | Required |
| `ADMIN_1_PASSWORD` | at least 12 characters | Required. Used exactly as written. |
| `ADMIN_2_EMAIL` | second administrator's email | Optional |
| `ADMIN_2_PASSWORD` | at least 12 characters | Required when `ADMIN_2_EMAIL` is set |
| `ADMIN_APP_ORIGIN` | `https://admin-territorios-flame.vercel.app` | CSRF Origin check. No trailing path. |
| `PUBLIC_APP_ORIGIN` | `https://publico-territorios.vercel.app` | The only origin allowed to call the public endpoint cross-origin. Required. Comma-separate extra origins. |
| `TRUST_PROXY` | `1` | Rate limits key on the client IP that Vercel puts in `X-Forwarded-For` |
| `NODEJS_HELPERS` | `0` | Recommended. Turns off Vercel's `req.body`/`req.query` helpers. Fastify parses requests itself. |
| `PG_POOL_MAX` | unset (3) | Optional. Connections per function instance. |
| `PG_IDLE_TIMEOUT_MS` | unset (5000) | Optional. Idle time before a connection closes. |
| `VITE_PUBLIC_APP_BASE_URL` | `https://publico-territorios.vercel.app` | Required. The base of the share links the admin app creates (`<base>/#<token>`). No trailing slash. Read at build time. If it is unset, links point at `http://127.0.0.1:5174`. |
| `VITE_MAPTILER_KEY` | MapTiler key | Optional. Admin basemap, read at build time. |

Notes on `TRUST_PROXY`:

- Vercel overwrites `X-Forwarded-For` with the visitor's IP, so clients
  cannot spoof it.
- With `TRUST_PROXY=1` the API takes the address nearest the proxy, which is
  that IP.
- If it is unset, every visitor shares one rate-limit bucket, keyed on the
  proxy address. Five failed sign-ins anywhere would then lock out everyone.
- Do not set `TRUST_PROXY` on a server that clients reach directly.

### `publico-territorios`

| Variable | Value | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://admin-territorios-flame.vercel.app/api` | Read at build time. The client calls `${VITE_API_BASE_URL}/public/territories/<token>`. A trailing slash is fine. |
| `VITE_MAPTILER_KEY` | MapTiler key | Optional. Without it, the app uses the OSM raster basemap. |

## Database connection

- **Use Neon's pooled connection string** for `DATABASE_URL` on Vercel.
  Its host contains `-pooler`, for example
  `ep-xxx-pooler.us-east-2.aws.neon.tech`. Many function instances open
  connections at once, and the pooler (PgBouncer) multiplexes them. The API
  issues only plain statements and transactions on one checked-out client,
  so the pooler's transaction mode works.
- **Keep the pool small.** Each instance holds at most 3 connections
  (`PG_POOL_MAX`) and closes idle ones after 5 seconds
  (`PG_IDLE_TIMEOUT_MS`). `attachDatabasePool` releases idle connections
  before Vercel suspends the instance. Local development keeps its default
  of 5 connections.
- **TLS:** put `sslmode=verify-full` in the URL. Neon's copied strings say
  `sslmode=require`. The current `pg` already treats `require` as
  `verify-full`, but it prints a deprecation warning, and `pg` v9 will change
  the meaning. `verify-full` keeps today's behavior: the certificate is
  checked against Node's public CA store. The current `pg` does not read
  `channel_binding=require` from the URL, so you can drop that parameter.

Example (placeholders, not real credentials):

```text
postgresql://USER:PASSWORD@ep-example-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=verify-full
```

## Migrations

Migrations are plain SQL in `db/migrations`, applied in order by
`pnpm db:migrate`. Vercel never runs them. Run them yourself before you
deploy code that needs them.

1. Copy Neon's **direct** connection string, without `-pooler`. Migrations
   run each file in one transaction on a dedicated connection, and the
   direct endpoint is the safe choice for DDL.
2. Run it from your machine:

   ```sh
   DATABASE_URL='postgresql://USER:PASSWORD@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=verify-full' pnpm db:migrate
   ```

3. Expect `applying 0010_rate_limits.sql`. Already-applied files are
   skipped. The runner refuses to continue if an applied file changed.

**Apply `0010_rate_limits.sql` before you deploy this version.** The API
keeps its rate-limit counters in the `rate_limit_counters` table. Without
the table, sign-in and the public share endpoint answer 500.

`0010_rate_limits.sql` SHA-256:
`dece728c28ee93f32df66a536433d17b3201ea0f4961a4a2fc5803bfcabbbf7a`.

## Rate limits across instances

The rate limits are unchanged:

- sign-in: 5 attempts per IP every 15 minutes;
- sign-out: 30 per minute;
- public share endpoint: 30 per minute per IP.

They are kept in PostgreSQL (`apps/api/src/rate-limit/pg-store.ts`), so every
function instance counts against the same limit:

- Each key is a fixed-window counter, incremented with one atomic
  `INSERT ... ON CONFLICT DO UPDATE`.
- Keys are stored only as SHA-256 hashes, because they contain client IPs
  and share tokens.
- Each instance deletes expired rows at most every 10 minutes.

`main.ts` uses the same store, so a local `pnpm dev` also needs migration
0010. Run `pnpm db:migrate` against the local database.

## Ignored Build Step

Vercel runs the command in the project's Root Directory. Exit code 1 means
"build", exit code 0 means "skip". Set it under
**Settings → Git → Ignored Build Step** (Custom).

`admin-territorios`, which also deploys the API:

```sh
git diff --quiet HEAD^ HEAD -- . ../api ../../packages/geo ../../db/migrations ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../tsconfig.base.json
```

`publico-territorios`:

```sh
git diff --quiet HEAD^ HEAD -- . ../../packages/geo ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../tsconfig.base.json
```

A change under `db/migrations` redeploys the admin project. The migration
still has to be applied by hand first.

## First deployment checklist

1. Apply the migrations to Neon with the direct URL, as in
   [Migrations](#migrations).
2. In `admin-territorios`:
   - set the Build Command as in [Project settings](#project-settings);
   - set every variable from the admin table;
   - set the Ignored Build Step;
   - redeploy.
3. In `publico-territorios`:
   - set `VITE_API_BASE_URL`;
   - set the Ignored Build Step;
   - redeploy. The variable is read at build time.
4. Check the deployment:
   - `https://admin-territorios-flame.vercel.app/api/health` answers
     `{"status":"ok","database":{"up":true,...}}`.
   - Sign in at https://admin-territorios-flame.vercel.app.
   - Create a share link and open it on https://publico-territorios.vercel.app.
   - In the function logs, incoming requests show the visitor's IP as
     `remoteAddress`, not one fixed proxy address.
