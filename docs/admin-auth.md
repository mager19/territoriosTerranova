# Admin authentication

Every `/admin/*` API route requires a server-side session for one of the
administrator accounts configured in environment variables. There are no
user records in the database and no sign-up: the API knows at most two
accounts, `ADMIN_1_*` and (optionally) `ADMIN_2_*`.

Public share links are a separate boundary. A share token is a scoped public
bearer secret and is never accepted as an administrator credential.

## How it works

1. The admin app shows a sign-in card when `GET /api/admin/me` answers 401.
2. The card posts `{ email, password }` to `POST /api/admin/auth/login`.
3. The API compares the email (case-insensitively) and the password against
   every configured account in constant time: both sides are hashed with
   SHA-256 and compared with `crypto.timingSafeEqual`. An unknown email does
   the same work as a known email with a wrong password.
4. A wrong password, an unknown email, and malformed input all get the same
   `401 { "error": "invalid_credentials" }`. Sign-in is limited to
   **5 attempts per client IP every 15 minutes**. Further attempts get 429.
5. On success the API creates a row in `admin_sessions`
   (`db/migrations/0009_admin_sessions.sql`) and sets the session cookie.
   The cookie holds a random 32-byte token. The database stores only the
   token's SHA-256 hash.
6. Every guarded `/admin/*` request resolves the cookie to a session that is
   neither revoked nor expired, and whose email is still one of the
   configured accounts. Otherwise it answers
   `401 { "error": "unauthorized" }`.
   Any 401 sends the admin app back to the sign-in card.
7. `POST /api/admin/logout` revokes the session row and clears the cookie.

### Session cookie

| Attribute | Value |
| --- | --- |
| Name | `admin_session` |
| `HttpOnly` | always |
| `Secure` | always in production; omitted only for a plain-http local `ADMIN_APP_ORIGIN` |
| `SameSite` | `Strict` |
| `Path` | `/` |
| Lifetime | 7 days (`Max-Age=604800`); the server enforces `expires_at` too |

### CSRF

`SameSite=Strict` is the main defense. In addition, the API refuses a
`POST`/`PUT`/`PATCH`/`DELETE` to `/admin/*`, sign-in included, when the
request has an `Origin` header that is not `ADMIN_APP_ORIGIN`. It answers
`403 { "error": "forbidden_origin" }`.

### Who did what

The API takes the actor of every admin write from the session email: the
territory revision author, the operational-event actor, the progress
`recordedBy`, the share-token creator and revoker, and every audit event.
Actor fields sent by the client (`author`, `actor`, `recordedBy`,
`createdBy`) are ignored.

### Routes

| Route | Session required | Purpose |
| --- | --- | --- |
| `POST /admin/auth/login` | no | Sign in. Returns `{ email }` and sets the cookie |
| `GET /admin/me` | yes | Returns `{ email }` for the current session |
| `POST /admin/logout` | yes | Revokes the session and clears the cookie |
| every other `/admin/*` route | yes | Territory administration |

## Same-origin `/api` proxy

The admin app calls the API under the relative prefix `/api`, so the browser
sees one origin and the cookie stays first-party:

- **Local development:** Vite's dev server proxies `/api/*` to
  `http://127.0.0.1:3000/*` and strips the `/api` prefix
  (`apps/admin/vite.config.ts`).
- **Production:** Vercel rewrites `/api/*` to the Render API
  (`apps/admin/vercel.json`). Replace the placeholder host
  `YOUR-RENDER-SERVICE.onrender.com` with the real Render service host before
  the first deploy. The same file also rewrites every other path to
  `index.html` so the app's client-side routes load on refresh.

The public app is unchanged. It still calls the API directly through
`VITE_API_BASE_URL`.

## Environment variables

All of these are read by `apps/api` (`apps/api/src/config.ts`).

| Variable | Required in production | Default (development) | Purpose |
| --- | --- | --- | --- |
| `ADMIN_1_EMAIL` | yes | unset | First administrator's sign-in email |
| `ADMIN_1_PASSWORD` | yes | unset | First administrator's password, at least 12 characters |
| `ADMIN_2_EMAIL` | no | unset | Second administrator's sign-in email |
| `ADMIN_2_PASSWORD` | with `ADMIN_2_EMAIL` | unset | Second administrator's password, at least 12 characters |
| `ADMIN_APP_ORIGIN` | yes, `https://` | `http://localhost:5173` | Origin the admin app is served from |
| `TRUST_PROXY` | recommended | `false` | Proxy hops in front of the API, so the rate limit sees real client IPs |

The API refuses to start when:

- `NODE_ENV=production` and `ADMIN_1_EMAIL`, `ADMIN_1_PASSWORD`, or
  `ADMIN_APP_ORIGIN` is missing;
- an email is set without its password, or a password without its email;
- a password is shorter than 12 characters;
- both accounts use the same email (compared case-insensitively);
- `ADMIN_APP_ORIGIN` is not a bare origin, or is not `https://` in production.

Passwords are used exactly as written. Surrounding spaces count.

When no account is configured (local development only), nobody can sign in.

## Local setup

1. Put the accounts in the repo-root `.env.local`. It is git-ignored, and
   `pnpm dev` loads it after `.env`:

   ```sh
   ADMIN_1_EMAIL=you@example.com
   ADMIN_1_PASSWORD=choose-a-long-local-password
   ```

2. Restart `pnpm dev`. Environment files are read only at startup.
3. Open the admin app at `http://localhost:5173` and sign in.

`ADMIN_APP_ORIGIN` can stay unset locally. The Origin check accepts both
`http://localhost:5173` and `http://127.0.0.1:5173` in development.

## Production setup (Render + Vercel)

On the Render API service, set:

- `NODE_ENV=production`
- `ADMIN_1_EMAIL`, `ADMIN_1_PASSWORD`, and optionally `ADMIN_2_EMAIL` and
  `ADMIN_2_PASSWORD`
- `ADMIN_APP_ORIGIN=https://<admin-domain>`, the Vercel domain of the admin
  app
- `TRUST_PROXY` set to the number of proxies in front of the API, so the
  sign-in rate limit keys on each client's own IP. Requests pass through the
  Vercel rewrite and Render's own proxy. Verify the hop count against
  `request.ip` in the logs before you rely on it. If it is unset, every
  admin shares the proxy's IP and therefore one rate-limit bucket.

On Vercel, deploy `apps/admin` with the real Render host in
`apps/admin/vercel.json`.

## Changing a password

1. Change `ADMIN_n_PASSWORD` (in `.env.local` locally, in the Render
   dashboard in production).
2. Restart the API. Render restarts the service automatically when an
   environment variable changes.

Sessions that already exist stay valid until they expire (7 days) or the
administrator signs out. Changing a password does **not** revoke them. To end
every session at once, revoke them in the database:

```sql
UPDATE admin_sessions SET revoked_at = now()
WHERE email = 'person@example.com' AND revoked_at IS NULL;
```

Removing an account is different: delete its variables and restart the API.
The API refuses any session whose email is no longer configured, so the
removed account's sessions stop working at once.
