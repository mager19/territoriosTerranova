# Admin territory overview — design

Date: 2026-09-09
Status: approved, not yet implemented

## Problem

An administrator can create a territory, share it, and record progress on
it — but only one territory at a time. There is no view of the whole
picture. To answer "how is the work going across our area?" today, an
administrator opens each territory in turn and reads its history.

## Purpose (decided)

This is an **oversight** view, not an operational one. It answers "how is
coverage going over time", not "which territory should I send to the group
this week". That distinction was made explicitly and it drives every other
choice below: the view is read-and-account-for, organised around time, and
it does not need to lead into an action.

## Decisions

| Question | Decision |
|---|---|
| Primary metric | **Frequency within a period** (a month) — "how consistently was this worked" |
| Volunteer names | **Not shown.** The view speaks about territories, never people |
| Territory number | **Congregation's own numbering**, not the database id |
| Time presentation | Table with a **per-row 12-month strip** (approach B of three) |

### Why frequency, and why a strip

Frequency was chosen over recency and over gap-continuity. But a frequency
count for a single month is a loose number: it cannot show consistency,
which is the actual question. The strip turns it into a series — a
territory worked every month reads differently at a glance from one worked
three times in January and never again.

A full territories×months heat map was rejected: it carries the same
information at a much higher layout cost, and with today's sparse data an
empty matrix reads as broken, where an empty strip reads correctly as
"never".

### Why volunteer names are excluded

Individual assignment was deliberately removed from this system (migration
0004) because the work belongs to the group and no one is the responsible
party for a territory. A dashboard that ranks who did what would quietly
reintroduce exactly that, in a group of ten to fifteen people. The names
remain recorded and remain visible in each territory's own audit history;
they are simply not aggregated here.

## What cannot be built, and why

**There is no honest "% covered".** Progress is stored as a LineString
along the perimeter, not as a fraction of the territory. Deriving "70%
done" from it would be inference, which AGENTS.md forbids ("coverage is
never inferred"). The view reports what is true: how many times, and when.

## Data model

### Migration 0005 — territory number

```
ALTER TABLE territories ADD COLUMN number text UNIQUE;
```

- **Nullable.** Existing territories have no number and one cannot be
  invented for them; they display "—" until an administrator assigns one.
  Postgres permits multiple NULLs under a UNIQUE constraint, so
  un-numbered territories coexist.
- **text, not integer.** Accommodates codes like `N-04` if the
  congregation ever uses them. The cost is lexicographic ordering, where
  "10" sorts before "9"; the query orders by `length(number), number`,
  which gives natural order for plain numbers and correct order for
  fixed-width codes.
- **Verified safe:** the only BEFORE UPDATE trigger on `territories`
  (`territories_overlap_on_reactivation`, 0003) fires solely when status
  changes to 'active', so writing a number does not re-run the overlap
  check.

### Assigning it

- `number` becomes an optional field on `POST /admin/territories`.
- `PATCH /admin/territories/:id/number` sets or changes it on an existing
  territory. Duplicate number → 409.

**No audit event is written for numbering.** Renaming a territory is not
audited either — there is no rename endpoint at all — so auditing
numbering alone would be incoherent. If territory-metadata changes should
be audited, that decision covers name and number together and is out of
scope here. Recorded as an open question below.

## Aggregation endpoint

`GET /admin/territories/overview?months=12&includeArchived=false`

A **new** endpoint rather than an extension of `GET /admin/territories`.
That list exists to populate a selector and needs only names; making it
carry twelve months of aggregates would slow the common path for a view
that rarely needs them.

Per territory, the response carries: `id`, `number`, `name`, `status`,
`areaHectares`, `lastWorkedAt` (nullable), and
`monthly: [{ month: 'YYYY-MM', times: n }]`.

- `months` is the window size, ending with the **current, partial** month.
  Twelve means the current month plus the eleven before it.
- `includeArchived` defaults to false.
- `areaHectares` is computed from the territory's **latest revision**
  geometry (the same "current geometry" rule used everywhere else).

**There is deliberately no `timesInPeriod` field.** The client derives the
selected month's count from `monthly[]`, which makes the period selector
instant and keeps one number from having two definitions. The
attention-state filter is derived the same way.

`lastWorkedAt` is **all-time**, not windowed. That is what makes "nunca
trabajado" distinguishable from "sin registros en este período" — a
territory last worked two years ago is not the same as one never worked,
and the strip alone cannot tell them apart.

### What counts as one visit

**Distinct days on which at least one progress entry was recorded — not
row count.** A volunteer who records a pause and a resume as two entries
made one outing, not two. Counting rows would inflate exactly the metric
chosen as primary.

### Month bucketing and time zone

`progress_entries.recorded_at` is `timestamptz`. Buckets are computed
`AT TIME ZONE 'America/Bogota'`. Bucketing in UTC would push a Sunday
evening outing into the following month and the strip would be wrong.
Colombia is a fixed UTC-5 with no daylight saving, but the conversion must
be explicit rather than incidental.

Every active territory appears in the response even with no entries at
all: zeros and a null `lastWorkedAt`, never an omitted row.

## The view

### Placement

`App.tsx` is currently a single flat page with no notion of views. Two
views do not justify a router: a pair of buttons ("Resumen" / "Territorios")
and view state in `App.tsx`.

**Accepted tradeoff:** the overview has no URL of its own, so it cannot be
linked or bookmarked. Acceptable for a local tool used by one or two
administrators; revisit if a third view appears.

### Table

Columns: **Nº** · **Territorio** · **Veces en \<mes\>** · **Últimos 12 meses**
· **Última vez** · **Tamaño**.

- Area in **hectares** — a manzana is roughly one hectare, and km² would
  render as unreadable decimals at this scale.
- Default sort by number (natural, per the ordering above), with
  un-numbered territories last (`NULLS LAST`) rather than leading the
  table with a column of dashes. Sortable headers for times-in-month and
  last-worked.

### Filters

Deliberately few:

- Period: current month / previous month / pick a month.
- Attention state: all / no records in the period / never worked.
- Archived territories are excluded by default, with a toggle to include
  them.

No barrio filter: the barrio→territory relationship does not exist in the
schema (recorded as a gap in `docs/agents/README.md`). No person filter:
names are not shown.

### The 12-month strip

Twelve blocks, oldest to newest, in four intensity levels: 0 empty
outline, 1 light, 2–3 medium, 4+ full. Colours come from the existing
design tokens (periwinkle mist and ash); no new palette values.

**Accessibility is load-bearing here.** The strip encodes numbers as
colour, and this app's stated definition of done requires keyboard and
screen-reader operability. The strip is therefore `role="img"` with an
`aria-label` stating the series in words, and each block carries a title
("julio 2026: 2 veces"). Without that, the information exists only for
sighted users.

Row-level staleness colouring is deliberately NOT part of this: that is a
different metric (recency) and a separate deferred item.

### Empty states

Three distinct states, because conflating them is how this view would read
as broken:

1. No territories exist at all.
2. Territories exist but none has any recorded progress — **the likely
   state today.** This gets an explicit line rather than a wall of zeros:
   "Ningún territorio tiene progreso registrado todavía", noting that only
   an administrator can record progress at present.
3. Data exists.

State 2 is expected because progress recording is admin-only and the
question of letting volunteers record from the share link is parked for the
team (`docs/agents/README.md`, "Open questions for the team").

### Errors

Reuse `describeApiError` for server errors; error and empty are rendered
distinctly, never collapsed.

## Testing

The risk concentrates in the aggregation query, so that is where the
integration tests go (real PostGIS, Testcontainers, as the repo already
does):

- Two entries on the same day count as **one** visit.
- Entries in different months land in the correct buckets.
- **Time zone boundary:** an entry at 23:30 Bogota time on the last day of
  a month stays in that month. This is the case that would break silently.
- A territory with no entries still appears, with zeros and a null
  `lastWorkedAt`.
- A territory last worked **before** the window shows an all-zero strip but
  a non-null `lastWorkedAt` — this is what separates "nunca trabajado"
  from "sin registros en este período", and getting it wrong would label
  an old territory as never touched.
- Archived territories are excluded by default and included with the flag.

Route-level unit tests follow the repo's existing "poison pool" pattern
(a pool whose `connect()` throws, proving validation rejects before any
database round trip):

- Invalid `months` → 400 without touching the database.
- Duplicate number on PATCH → 409.

Pure unit tests for the count→intensity mapping and the "hace X días"
formatting.

**Not covered, stated rather than hidden:** no React component tests. The
admin app has none today, and introducing a component-testing harness is a
separate decision with its own cost. This spec does not smuggle it in.

## Out of scope

- Percentage of coverage (not derivable honestly — see above).
- Barrio grouping or filtering (blocked on the missing barrio→territory
  relationship).
- Per-person columns or participation statistics.
- Export or print.
- Staleness colour-coding of rows.
- React component test harness.

## Open questions

- Should territory metadata changes (name, number) write audit events? If
  yes, it covers both, not just numbering.
- Backfilling numbers for existing territories is manual, one PATCH at a
  time. If there are many, a bulk path may be wanted; not designed here.
