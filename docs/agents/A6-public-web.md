# A6 — Public Web

**Mission**: The field worker's view. One territory, one link, no login, nothing
else visible.

**Reasoning load**: Standard — but every decision is a privacy decision
**Depends on**: A4
**Blocks**: nothing
**Milestone**: M3

## Read first

`docs/agents/README.md`, `AGENTS.md` (privacy rules), `docs/agents/A4-sharing.md`
(the exact response contract you consume)

## Owns

`apps/public/**`

## Scope

A single page, opened by a share URL, showing one territory over the Bello
basemap.

Share URLs (2026-10-03 product decision, AGENTS.md "Privacy rules"; contract in
`docs/agents/A4-sharing.md` "Fixed public URLs"):

- **Fixed, readable**: `/t/<slug>`, e.g. `/t/nv-01`. `src/share-link.ts` reads
  the slug from `location.pathname`, validates it against `^[a-z0-9-]{1,80}$`
  before any request, and fetches `${VITE_API_BASE_URL}/public/t/<slug>`. A
  malformed slug renders the neutral "Enlace no disponible" message without a
  request and is never reinterpreted as a token. Slugs are guessable by
  design — the accepted trade-off of this decision.
- **Legacy**: `/#<token>` links keep working (`src/token.ts`).
- `apps/public/vercel.json` rewrites `/t/(.*)` to `/index.html`; built assets
  keep normal static serving (`src/vercel-config.test.ts`).

The page shows:

- The territory boundary — every part of a multi-part territory (2026-10-03,
  `boundary` may be a MultiPolygon). The view fits all parts; the name label and
  the "Cómo llegar" destination sit on the largest part's label point
- Approved coverage status, using the vocabulary the API returns
- Where remaining-area geometry exists, render it. Where it does not, display
  **unknown** — never an inference
- OSM attribution
- Clear, non-alarming states for revoked, expired, and invalid links

No framework. Vanilla TypeScript + MapLibre, per the roster decision: smaller
bundle, smaller attack surface, less to audit.

## Definition of done

- [ ] Renders only fields present in the A4 public response — a test asserts the
      page reads no other key
- [ ] Revoked, expired, and invalid tokens, and unknown or malformed slugs, all
      render the **same** neutral message
- [ ] No analytics, no third-party scripts, no external font or asset loading
      beyond the basemap provider. With OSM raster (no `VITE_MAPTILER_KEY`) that
      is the tiles only; with MapTiler it is the style JSON, its tiles, glyphs and
      sprites, and the required MapTiler logo, all from `api.maptiler.com`
      (2026-10-03, see docs/map-references.md "Basemap"). App fonts are
      self-hosted.
- [ ] A legacy share token never appears in a referrer, an outbound request, or
      a logged URL beyond the initial load. (A slug is in the path by design;
      `no-referrer` still keeps it out of outbound requests.)
- [ ] `noindex` respected; no sitemap; no crawlable link to this app
- [ ] Nothing in the bundle or DOM reveals admin endpoints, internal ids, other
      territories, or AMVA sources — grep the built output and show it
- [ ] Absent remaining-area geometry renders as unknown; a test asserts it
- [ ] Usable on a phone, outdoors, one-handed. Legible contrast in sunlight
- [ ] Keyboard operable with a non-map textual fallback
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm build` exit 0

## Hard constraints

- **Assume the link will be forwarded.** Someone will paste it into a group chat.
  Design as if the viewer is a stranger, because eventually they are.
- **Never fetch from an admin endpoint.** Not even for convenience during
  development. The bundle must contain no admin URL.
- Do not render assignee identity, older notes, timestamps, history, other
  territories, or AMVA attributes — even if the API mistakenly returns them.
  **Report an unexpected field to the orchestrator immediately**: that is an A4
  defect and it is severe.
- Deliberate exceptions (see AGENTS.md "Privacy rules"), the only fields read
  beyond territoryName/boundary/remainingArea/remainingAreaStatus:
  - the progress **route** line (2026-09-08): a distinct, bold progress line,
    never confused with the territory boundary or the remaining-area fill;
  - the merged current-cycle **coveredArea** (2026-09-26): a distinct muted
    green "done" fill drawn under the remaining area and the route;
  - the latest session **note** (2026-10-03): a clearly visible text box
    labeled "Nota del último grupo" right above the map, rendered as plain
    text (`textContent`, never HTML); nothing is rendered when it is null.
  A legend (Hecho / Pendiente / Recorrido) lists only the layers present.
  The **pausePoint** "Aquí quedamos" marker was removed on 2026-10-03; a
  `pausePoint` field in a response is ignored like any unexpected field.
- No client-side storage of the token beyond the session.
- Coordinate order is `[longitude, latitude]`.

## Handoff

Include the grep output over the production bundle proving no admin endpoint,
internal id, or AMVA URL is present.
