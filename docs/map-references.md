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

## Basemap — carried over from the archived attempt

The archived prototype's MapLibre configuration was verified as working and is
worth reusing:

- Center: `[-75.5636, 6.3373]` (Bello), zoom 13
- Raster source: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, tileSize 256, maxzoom 19
- Attribution: `© OpenStreetMap contributors`

OSM's public tile server is rate-limited and not approved for production traffic.
It is fine for development; a production tile decision is still open.

## Standing rules

- Application-owned territory geometry stays RFC 7946 WGS84 GeoJSON and is the system of record.
- AMVA layers are an administrator-only drafting reference. Never expose them, their
  attributes, or these MapServer URLs in public share views.
- Attribute reuse requires attribution to Área Metropolitana del Valle de Aburrá.
  Written reuse and freshness approval is still required before production use.
