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

A single page, opened by share-token URL, showing one assigned territory over the
Bello basemap:

- The territory boundary
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
- [ ] Revoked, expired, and invalid tokens all render the **same** neutral message
- [ ] No analytics, no third-party scripts, no external font or asset loading
      beyond the map tiles
- [ ] The share token never appears in a referrer, an outbound request, or a
      logged URL beyond the initial load
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
- Do not render assignee identity, notes, timestamps, history, other
  territories, or AMVA attributes — even if the API mistakenly returns them.
  **Report an unexpected field to the orchestrator immediately**: that is an A4
  defect and it is severe.
- Deliberate exceptions (see AGENTS.md "Privacy rules"), the only fields read
  beyond territoryName/boundary/remainingArea/remainingAreaStatus:
  - the progress **route** line (2026-09-08): a distinct, bold progress line,
    never confused with the territory boundary or the remaining-area fill;
  - the **pausePoint** (2026-09-26): a clearly labeled "Aquí quedamos" marker;
  - the merged current-cycle **coveredArea** (2026-09-26): a distinct muted
    green "done" fill drawn under the remaining area and the route.
  A legend (Hecho / Pendiente / Recorrido / Aquí quedamos) lists only the
  layers present.
- No client-side storage of the token beyond the session.
- Coordinate order is `[longitude, latitude]`.

## Handoff

Include the grep output over the production bundle proving no admin endpoint,
internal id, or AMVA URL is present.
