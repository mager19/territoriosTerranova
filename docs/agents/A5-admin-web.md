# A5 — Admin Web

**Mission**: The administrator's map editor. Draw territories over a real Bello
basemap, share them with the volunteer group, and read history. (Originally
"manage assignments" — superseded 2026-09-08, see Slice 2 below.)

**Reasoning load**: Standard
**Depends on**: A3
**Blocks**: nothing
**Milestones**: M1 (editor), M2 (sharing and history)
**Runs in parallel with**: A4

## Read first

`docs/agents/README.md`, `AGENTS.md`, `docs/map-references.md` (basemap config)

## Owns

`apps/admin/**`

## Basemap — already verified, reuse it

```
center:      [-75.5636, 6.3373]   // Bello
zoom:        13
raster tiles: https://tile.openstreetmap.org/{z}/{x}/{y}.png
tileSize:    256
maxzoom:     19
attribution: © OpenStreetMap contributors
```

OSM's public tile server is rate-limited and **not approved for production
traffic**. Fine for development. Attribution is mandatory and must be visible.

## Scope

### Slice 1 — Editor (M1)

Draw a polygon vertex by vertex over the basemap, with undo and close. The draft
renders live as a GeoJSON fill and line layer. Saving posts WGS84 GeoJSON to the
A3 API and shows the resulting revision.

Optionally load AMVA barrio boundaries as a **drafting reference underlay** —
visually distinct from the drawn territory, and clearly labelled as reference.

### Slice 2 — Sharing and history (M2) — superseded 2026-09-08

**As originally briefed, this slice was "assign, return, complete, and reopen".**
Territories are shared to the volunteer group, not assigned to one named person —
there is no lifecycle to manage. What was actually built: a "Share this territory"
action (SharePanel) that issues/revokes a link. Show the revision timeline and
audit history. Show recorded progress, including remaining-area geometry when it
exists — this part is unchanged.

~~Assign, return, complete, and reopen with a reason.~~

## Definition of done

- [ ] Drawing produces valid RFC 7946 WGS84 GeoJSON; a unit test asserts ring
      closure and coordinate order `[lon, lat]`
- [ ] Undo and close-polygon are covered by unit tests on pure state functions
- [ ] Server validation errors are surfaced with their specific cause — never a
      generic "something went wrong"
- [ ] Revision history is visible and revisions are presented as immutable
- [ ] Reopen requires a reason in the UI, matching the server rule
- [ ] Where remaining-area geometry is absent, the UI says **unknown** — it never
      renders an assumed remaining area
- [ ] AMVA reference layers, when shown, are visually and textually distinguishable
      from application-owned geometry
- [ ] OSM attribution is visible on the map
- [ ] Keyboard operable; visible focus states; the map has a non-map fallback for
      the territory list
- [ ] `pnpm typecheck` and `pnpm test` exit 0

## Hard constraints

- **Coordinate order is `[longitude, latitude]`.** Reversing it puts Bello in the
  Indian Ocean and the bug survives review because both numbers look plausible.
- Use MapLibre's `map.unproject()` for screen-to-geographic conversion. The
  archived attempt used linear interpolation over a hardcoded extent — that is
  wrong for any real projected basemap.
- Keep drawing state in **pure, testable functions** separate from MapLibre. The
  map is a rendering surface, not the model.
- Never send raw pixel coordinates to the API. Convert to WGS84 client-side and
  let the server validate.
- Do not build any public-facing view. That is A6.

## Handoff

Include a screenshot or a recorded interaction of a polygon being drawn and saved.
