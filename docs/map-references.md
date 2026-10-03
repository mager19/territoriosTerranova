# Map References — Verified Evidence

All findings below were verified by direct request on 2026-09-06. Anything not
listed here is unverified and must not be described as confirmed.

## AMVA / SIM — POT Bello MapServer

Base URL: `https://sim.metropol.gov.co/arcgis/rest/services/Planes_Ordenamiento_Territorial/POT_Bello/MapServer`

| Property | Verified value |
| --- | --- |
| Reachability | HTTP 200, public, no authentication |
| Service description | Plan de Ordenamiento Territorial del Municipio de Bello |
| Copyright | © 2017 Área Metropolitana del Valle de Aburrá |
| Capabilities | `Map,Query,Data` |
| Supported query formats | `JSON, geoJSON` |
| `maxRecordCount` | 1000 |
| Native spatial reference | Custom `Municipio_de_Medellín` Azimuthal Equidistant on GCS_Bogota / International_1924 — **not** WGS84 |
| Layer count | 85 (ids 0–84) |

### Layers relevant to territory management

| Id | Name | Geometry | Useful attributes |
| --- | --- | --- | --- |
| 8 | `Limit_Municipal_POT_2009` | Polygon | Municipal boundary — candidate answer to the open "Bello boundary source" decision |
| 9 | `Barrios` | Polygon | `Nombre`, `CodigoPOT`, `codigoDANE`, `CodigoCatastro`, `CodCOMUNA`, `Extension`, `Poblacion`, `EstratoPredom` |
| 11 | `Perimetro Urbano POT2009` | Polygon | Urban perimeter |
| 15 | `Manzanas` | Polygon | `OBJECTID`, `AREA`, `PERIMETER` only — no names |

### WGS84 GeoJSON retrieval works directly

Adding `f=geojson&outSR=4326` returns RFC 7946 GeoJSON in WGS84. No proxy,
no client-side reprojection, and no coordinate-transformation code are needed.

```
GET {base}/9/query
  ?where=1%3D1
  &outFields=Nombre,CodCOMUNA,codigoDANE
  &returnGeometry=true
  &outSR=4326
  &maxAllowableOffset=0.00002
  &f=geojson
```

Verified sample vertex: `[-75.57307274994052, 6.358147322663799]` (Bello, correct).

### Payload size — simplification is mandatory

| Request | Features | Size |
| --- | --- | --- |
| All barrios, full geometry | 139 | 2,067,842 bytes (~2.0 MB) |
| All barrios, `maxAllowableOffset=0.00002` (~2.2 m) | 139 | 162,915 bytes (~159 KB) |

Same feature count, 12.7x smaller. Always send `maxAllowableOffset` for web delivery.

## Data quality — verified anomalies in the 139-barrio seed

Two real, diagnosed anomalies exist in the live AMVA layer-9 export as of the
2026-09-08 cache. Both are handled explicitly in `packages/geo/src/db/seed.ts`
(never silently) and covered by integration tests:

| Barrio | Anomaly | Handling |
| --- | --- | --- |
| Index 81 (no `Nombre`) | Every non-geometry attribute is blank (`" "`). Geometry is valid. Unique among the 139 — no other barrio is missing every attribute. | Loaded under the placeholder name `Sector sin nombre (AMVA no registra atributos para este polígono)`, deliberately unlike any real AMVA name. A barrio missing *only* its name while keeping other attributes still fails loudly — the placeholder is scoped to this exact, verified shape of gap. |
| `Urb. Búcaros III` | Its MultiPolygon carries two parts: a real 10-vertex boundary, plus an unrelated zero-area artifact (4 near-duplicate points ~1 m apart — a digitizing slip). `ST_IsValidReason` confirms "Too few points in geometry component" on the artifact only. | The seed drops zero-area MultiPolygon components before insertion (`sanitizedMultiPolygonExpr` in `seed.ts`), keeping the real boundary untouched. This is bulk third-party import sanitization, not "repairing administrator-drawn geometry" — A3's domain code must still reject invalid territory geometry outright. |

### Barrios with active congregation territories

Recorded per orchestrator/user decision (2026-09-08) — not used to scope the
seed (all 139 barrios load, as a general drafting-reference layer), but kept
here so it is not lost before A3/A5 need it:

- `B. Guasimalito`
- `B. Navarra`
- `B. Altos de Niquía`, `B. Ciudad Niquía`, `B. Niquía Bifamiliar` (all three
  AMVA sub-barrios covering the "Niquía" area are relevant)

## Data freshness caveat

The layers are POT 2009 vintage under a 2017 copyright. Treat geometry as a
**drafting reference**, never as a current legal or cadastral boundary. This does
not change the standing rule that application-owned territory geometry is the
system of record.

## Other AMVA / IDEM links

| Link | Status | Assessment |
| --- | --- | --- |
| `portalidem.metropol.gov.co` Experience Builder (`id=288b286b...`) | HTTP 200 | Viewer application, not an API. Do not embed or scrape. |
| `portalidem.metropol.gov.co` 3D web app viewer (`id=836f418e...`) | HTTP 200 | Viewer application. Not a runtime dependency. |
| `arcgis.com` map viewer pointing at `http://amarcgis:8888/...` | **Unreachable (HTTP 000)** | Targets an AMVA-internal hostname. Dead outside their network — the public `sim.metropol.gov.co` host above is the usable equivalent. |

## Correction to the archived first attempt

The abandoned attempt (branch `archive/first-attempt`) hardcoded an AMVA adapter
against `layer: 15` with an `OBJECTID`-only field allowlist. `Manzanas` carries no
names or codes, so that allowlist yields unlabelled polygons. `Barrios` (layer 9)
is the layer with usable identifying attributes.

## Basemap

Decision (2026-10-03): **OSM raster is the default everywhere.** MapTiler
Streets v2 (vector, `https://api.maptiler.com/maps/streets-v2/style.json?key=<KEY>`)
is an **admin-only** opt-in, because it shows the building footprints / 3D
buildings that OSM lacks in Bello's Navarra area. The public volunteer view
always uses OSM and never reads a MapTiler key (guarded by
`apps/public/src/basemap-policy.test.ts`).

Selection lives in `basemap.ts` in each app (`apps/admin/src/features/territory-editor/`
and `apps/public/src/`, kept identical): `selectBasemap(key, preferred)` is a
pure, unit-tested function that returns MapTiler only when MapTiler is
explicitly preferred **and** a key is present, and OSM otherwise.

| Admin map | `VITE_MAPTILER_KEY` unset or empty | `VITE_MAPTILER_KEY` set |
| --- | --- | --- |
| Territory editor (`TerritoryEditor`) | OSM, no switch | OSM by default; "Calles" / "Construcciones" switch |
| Session recorder (`ProgressRecorder`) | OSM, no switch | OSM by default; "Calles" / "Construcciones" switch |
| Overview thumbnails, `TerritoryPreview` | OSM | OSM (no switch) |
| Public volunteer view | OSM | OSM |

The switch (`basemap-ui.tsx`, `BasemapSwitcher` + `useBasemapSwitch`) is a
compact segmented control of native `aria-pressed` buttons over the map's
top-left corner ("Calles" = OSM, "Construcciones" = MapTiler), disabled until
the map has loaded. The admin's last choice is remembered per browser in
`localStorage` (`territorios.admin.basemap`, `basemap-preference.ts`); missing
or failing storage falls back to OSM. Switching calls
`map.setStyle(style, { diff: false })` on the existing map — a full style
reload, so `style.load` always fires. A full reload drops every app
source/layer, so on `style.load` the component re-installs exactly the layers
its `load` handler installs, and a `styleRevision` counter makes its render
effects repaint the current state (draft and its parts, saved territory,
neighbour outlines, reference barrio, remaining area, sessions). Drafts,
selections and the camera are kept: fit-to-geometry and draft resets are
separate effects not keyed on `styleRevision`. A second switch while a style
is still loading unregisters the first `style.load` listener, so layers are
installed once.

Configuration: both Vite apps set `envDir` to the repository root, so one
root `.env.local` (git-ignored) serves admin and public. Only `VITE_`-prefixed
variables reach client code; `VITE_API_BASE_URL` (public app only — the admin
app always calls the API same-origin under `/api`, docs/admin-auth.md) and
`VITE_PUBLIC_APP_BASE_URL` are read from the same root files. The key is shipped to browsers by design
(MapTiler keys are public client keys). Set it **only on the admin Vercel
project** (docs/deploy-vercel.md), and restrict it in the MapTiler dashboard to
`admin-territorios-flame.vercel.app`, `localhost` and `127.0.0.1`. Only the style and its tiles/glyphs/sprites
are fetched from MapTiler — no MapTiler geocoding or search is used.

### OSM raster fallback — carried over from the archived attempt

- Center: `[-75.5636, 6.3373]` (Bello), zoom 13
- Raster source: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, tileSize 256, maxzoom 19
- Attribution: `© OpenStreetMap contributors`

OSM's public tile server is rate-limited and not approved for production
traffic. It remains the development fallback and the rollback path.

### Attribution

- MapTiler active: "© MapTiler © OpenStreetMap contributors", linked to
  `https://www.maptiler.com/copyright/` and `https://www.openstreetmap.org/copyright`,
  plus the MapTiler logo (`https://api.maptiler.com/resources/logo.svg`, linking
  to `https://www.maptiler.com`) as the free plan requires. Admin: a MapLibre
  control in the map's bottom-left corner, and the explicit attribution string is
  set on the style's tiled sources so MapLibre's attribution control shows it.
  The admin attribution line under the map switches with the basemap, and the
  logo control is removed again when switching back to OSM. (The public page
  still has a MapTiler variant of its attribution line in `render.ts`, but
  never selects it.)
- OSM: unchanged, plain "© OpenStreetMap contributors".

### Pedestrian-path reinforcement

In Navarra and Niquía many walkable streets are OSM footways and steps, which
Streets v2 draws as faint grey dashed hairlines — easy to miss when planning a
door-to-door route. After the style is fetched, MapLibre's `transformStyle`
hook recolors line layers in the `transportation` source-layer whose filter
names a pedestrian value (`path`, `pedestrian`, `path_pedestrian`, `footway`,
`steps`), names no road/rail class, and does not negate it. Casing/outline
layers and label (`symbol`) layers are left alone. Against the live style
(2026-09-26) this selects exactly `Path`, `Path minor`, and `Footway tunnel`.
They become `#6b4f36` (mid-dark brown), width ramping 1 px at z15 to 3 px at
z19; the original dash pattern and opacity are kept. A style with no matching
layer (including the OSM fallback) passes through unchanged.

### MapTiler free plan — limits and open items

- Free plan (as recorded by the product owner, 2026-09-26; not independently
  verified here): 5,000 map sessions per month; the service pauses (maps stop
  loading) when exceeded. No runtime fallback to OSM
  on a paused or rejected key is implemented yet; rollback is by config.
- Free plan terms are for non-commercial use. **Written confirmation from
  MapTiler that this use qualifies is still pending and required before launch.**
- **Key restriction must be verified before launch** on the admin domain, in a
  real browser, with the restricted key (MapTiler checks the `Origin` header
  that CORS fetches send). The public view no longer uses MapTiler at all, so
  its referrer policy does not affect the key.

### Rollback

- Config only: unset or empty `VITE_MAPTILER_KEY` on the admin project and
  rebuild → OSM only, no switch.
- Code: git tag `pre-maptiler` (main at `6f69dde`) is the last state before
  MapTiler.

## Standing rules

- Application-owned territory geometry stays RFC 7946 WGS84 GeoJSON and is the system of record.
- AMVA layers are an administrator-only drafting reference. Never expose them, their
  attributes, or these MapServer URLs in public share views.
- Attribute reuse requires attribution to Área Metropolitana del Valle de Aburrá.
  Written reuse and freshness approval is still required before production use.
