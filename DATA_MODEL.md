# FieldOS — Data Model (v0, Phase 0.5 corrected)

> Goal: the **smallest defensible** model that preserves provenance and survives export.
> Principle bias: simple structures over premature abstraction; raw evidence never silently
> overwritten; user vs machine data distinguishable; no fake precision, no fake comparability.
>
> **Phase 0.5 changes:** (2) the universal ordinal `level` is **removed** and replaced by a
> **discriminated, category-specific value**; (3) evidence methods tightened to
> OBSERVED/MEASURED/REPORTED with source/measurement context; (4) original capture is preserved
> via immutable `capturedLocation` + separate adjustment, with a derived `effectiveLocation`.

## Modelling decisions (and what was rejected)

- **Entities kept:** `FieldSession`, `Asset`, `Observation`, `MediaAttachment`.
- **`LocationEvidence` is NOT a separate entity.** It is an **embedded value object**
  (`CapturedLocation` / `LocationAdjustment`) stored *inside* an Observation. A normalized
  location table buys nothing in a single-user offline app and adds joins.
- **`Asset` is optional** and lightweight (a named point). **Point geometry only** in MVP; polygons are P1.
- **IDs are client-generated UUIDv4** (`crypto.randomUUID()`) so offline records never collide on a future sync.
- **Timestamps are ISO-8601 strings with offset**, plus retained raw epoch ms where it matters.
  The device clock may be wrong offline — we record as-is and never "correct" it. Export never
  regenerates a timestamp.
- **Capture is immutable.** The raw device fix and the capture timestamp are written once and
  never edited. Interpretation fields are editable, with lightweight edit tracking. No event sourcing in P0.
- **No universal ordinal scale, no numeric score, no composite index.** Each category owns its
  own controlled value set (below); values across categories are **not** semantically comparable.

Legend: **R** = required, **O** = optional. Types are logical (stored as JSON in IndexedDB).

---

## Entity: FieldSession

| Field | Type | R/O | Allowed / notes | Provenance meaning |
|------|------|-----|-----------------|--------------------|
| `id` | UUIDv4 string | R | `crypto.randomUUID()` | stable identity across export/backup |
| `schemaVersion` | int | R | starts at `1` | lets exports be interpreted later |
| `title` | string | R | free text, e.g. "Lakeside trail, Aug morning" | human label |
| `purpose` | string | O | free text | context for later readers |
| `observerName` | string | O | free text; **self-declared, unverified** | closest we get to "who"; P0 has no auth |
| `status` | enum | R | `active` \| `closed` | closed = intended complete |
| `createdAt` | ISO-8601 | R | device clock | when session started (immutable) |
| `closedAt` | ISO-8601 | O | | when marked complete |
| `updatedAt` | ISO-8601 | R | | last mutation |
| `deviceLabel` | string | O | UA/platform snapshot at creation | helps explain data quirks later |

> `observerName` is a self-declared string. Nothing in the model or export may imply an
> authenticated observer identity — P0 has no authentication.

---

## Entity: Asset  *(optional grouping / geospatial reference)*

| Field | Type | R/O | Allowed / notes | Provenance meaning |
|------|------|-----|-----------------|--------------------|
| `id` | UUIDv4 string | R | | identity |
| `schemaVersion` | int | R | `1` | |
| `sessionId` | UUIDv4 | O | may be reusable across sessions | link |
| `name` | string | R | free text | label |
| `assetType` | enum | O | `trailhead` \| `car_park` \| `viewpoint` \| `visitor_centre` \| `path_segment` \| `public_space` \| `other` | coarse classification |
| `latitude` | number | O | WGS84 | known coordinate (enables nearby/distance) |
| `longitude` | number | O | WGS84 | |
| `source` | enum | R | `field_created` \| `preloaded` | field-dropped vs imported reference (imported = P1) |
| `createdAt` | ISO-8601 | R | | immutable |
| `updatedAt` | ISO-8601 | R | | |

> Asset coordinates power P0 geospatial context: **distance to nearby assets** and
> **selection from nearby/recent assets** (haversine helper) — no map library, no tiles.

---

## Value object: CapturedLocation  *(embedded, IMMUTABLE)*

Written once at capture. **Never rewritten.**

| Field | Type | R/O | Allowed / notes |
|------|------|-----|-----------------|
| `latitude` | number \| null | R | null when no fix |
| `longitude` | number \| null | R | null when no fix |
| `accuracyMeters` | number \| null | R | from Geolocation `coords.accuracy`; **honest uncertainty, never dropped** |
| `altitudeMeters` | number \| null | O | if provided |
| `locationStatus` | enum | R | `CAPTURED` \| `DENIED` \| `UNAVAILABLE` \| `TIMEOUT` |
| `capturedAt` | ISO-8601 | R | when the fix was taken |

If `locationStatus !== CAPTURED`, coordinates are `null` — we **never fabricate a coordinate**.

## Value object: LocationAdjustment  *(embedded, optional — set only if the user corrects the pin)*

| Field | Type | R/O | Allowed / notes |
|------|------|-----|-----------------|
| `latitude` | number | R | corrected WGS84 |
| `longitude` | number | R | corrected WGS84 |
| `locationAdjustedAt` | ISO-8601 | R | when corrected |
| `locationAdjustmentReason` | string \| null | O | e.g. "moved pin to the actual bench" |

**Rules (correction §4):**
- On capture, `capturedLocation` is written once with the raw fix. It is immutable — editing an
  observation never touches it.
- A correction writes a **separate** `locationAdjustment`. The original `capturedLocation` is retained.
- **`effectiveLocation` is DERIVED, not stored** — a helper returns `locationAdjustment` if present,
  else `capturedLocation`. Export records which was used (`locationSource: captured | adjusted`).
  It is derived (not persisted) so it can never go stale or overwrite the original.

---

## Entity: Observation  *(the core record)*

| Field | Type | R/O | Allowed / notes |
|------|------|-----|-----------------|
| `id` | UUIDv4 string | R | |
| `schemaVersion` | int | R | `1` |
| `sessionId` | UUIDv4 | R | belongs to a session |
| `assetId` | UUIDv4 \| null | O | null for ad-hoc points |
| **— Capture block (IMMUTABLE) —** | | | |
| `capturedAt` | ISO-8601 | R | device clock at capture; **never regenerated** |
| `capturedLocation` | `CapturedLocation` | R | raw located evidence (immutable) |
| **— Interpretation block (editable) —** | | | |
| `observation` | `ObservationValue` | R | discriminated `{ category, value }` — see below |
| `evidence` | `Evidence` | R | discriminated `{ method, ... }` — see below |
| `note` | string \| null | O | free text — often the real signal |
| `locationAdjustment` | `LocationAdjustment` \| null | O | set only if the pin was corrected |
| **— Bookkeeping —** | | | |
| `createdAt` | ISO-8601 | R | when the record row was created (immutable) |
| `updatedAt` | ISO-8601 | R | last edit to interpretation block |
| `editCount` | int | R | starts `0`, +1 per edit |
| `edited` | boolean | R | `editCount > 0`; surfaced in export |
| `deleted` | boolean | R | soft-delete, default `false`; never hard-delete in the field |

### ObservationValue — discriminated, category-specific (correction §2)

The universal ordinal `level` is **gone**. There is no shared scale, no numeric score, no
composite index. Each category owns its own controlled values; values are **not** comparable
across categories.

```ts
type ObservationValue =
  | { category: 'visitor_pressure';         value: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' }
  | { category: 'parking_pressure';         value: 'LOW' | 'MODERATE' | 'HIGH' | 'FULL' }
  | { category: 'path_condition';           value: 'GOOD' | 'FAIR' | 'POOR' | 'BLOCKED' }
  | { category: 'litter';                   value: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' }
  | { category: 'infrastructure_condition'; value: 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED' }
  | { category: 'signage_condition';        value: 'GOOD' | 'DAMAGED' | 'MISSING' | 'UNCLEAR' }
  | { category: 'accessibility_barrier';    value: 'NONE' | 'MINOR' | 'MAJOR' | 'UNKNOWN' }
  | { category: 'visitor_management';       value: 'PRESENT' | 'ABSENT' | 'NOT_ASSESSED' }
  | { category: 'other';                    value: null }; // note carries the content
```

**Category definitions (so semantics are clean and non-overlapping):**

| Category | Scope (what it is about) | Values & meaning |
|----------|--------------------------|------------------|
| `visitor_pressure` | Density/pressure of people at this point now. | NONE→HIGH ordinal crowding. |
| `parking_pressure` | Occupancy of a parking area. | LOW/MODERATE/HIGH occupancy; **FULL** = no spaces. (No NONE: "empty" = LOW.) |
| `path_condition` | The walking surface of a trail/path. | GOOD/FAIR/POOR degradation; **BLOCKED** = impassable. |
| `litter` | Visible litter / waste on the ground. | NONE→HIGH amount. |
| `infrastructure_condition` | **Built structures other than the path and signage** (railings, steps, boardwalk, benches, toilets, barriers). | GOOD = sound; FAIR = minor wear; POOR = significant degradation, reduced function; DAMAGED = broken/unsafe/non-functional. |
| `signage_condition` | Wayfinding/interpretive signs. | GOOD; DAMAGED (physically); MISSING (expected sign absent); UNCLEAR (present but unreadable/ambiguous). Nominal, not ordinal. |
| `accessibility_barrier` | Barrier to access (steps, gradient, surface, width). | NONE; MINOR; MAJOR; UNKNOWN (not assessable). |
| `visitor_management` | Presence of a management measure (marshalling, ropes, one-way, wardens). | PRESENT / ABSENT / NOT_ASSESSED. Nominal. |
| `other` | Anything not covered above. | No categorical value; `note` required by UI convention. |

**Critical review of the vocabulary (done once, as instructed):**
- Every category above can be defined with a **non-overlapping scope**, so all nine are kept.
- Two boundaries were scrutinized and pinned down rather than left fuzzy:
  - `infrastructure_condition` **POOR vs DAMAGED** — resolved by definition (degraded-but-functional
    vs broken/unsafe) and by scoping it to *non-path, non-signage* built structures so it does not
    overlap `path_condition` or `signage_condition`.
  - `signage_condition` **MISSING** — this is a *condition of signage at a place* (the expected sign
    isn't there) and is **unrelated** to any evidence method. To avoid confusion with the old
    evidence taxonomy, note that P0 evidence methods are only OBSERVED/MEASURED/REPORTED (below);
    `MISSING` never appears as an evidence method.
- Values are intentionally heterogeneous (some ordinal, some nominal). This is correct: a shared
  scale would manufacture fake comparability. Aggregation/indexing is explicitly out.

### Evidence — discriminated (correction §3)

P0 evidence methods: **OBSERVED, MEASURED, REPORTED**. `DERIVED` and `MISSING` are **not** exposed.
Absence of evidence is represented by **missing/null data**, never by a pretend "MISSING" source.

```ts
type Evidence =
  | { method: 'OBSERVED' }
  | { method: 'MEASURED'; value: number; unit: string; context?: string | null }
  | { method: 'REPORTED'; sourceNote?: string | null };
```

| Method | Meaning | Extra fields |
|--------|---------|--------------|
| `OBSERVED` | Observer directly perceived it (default). | — |
| `MEASURED` | Backed by a count/instrument reading. | `value`, `unit` (e.g. 12, "vehicles"); `context` preserves how/with what it was measured. |
| `REPORTED` | Told by a third party / sign / another person; not directly seen. | `sourceNote` (who/what reported it). |

`DERIVED` is not in P0 (nothing derives data). `MISSING` is not an evidence method (absence ≠ source).

---

## Entity: MediaAttachment

| Field | Type | R/O | Allowed / notes |
|------|------|-----|-----------------|
| `id` | UUIDv4 string | R | |
| `schemaVersion` | int | R | `1` |
| `observationId` | UUIDv4 | R | owner |
| `kind` | enum | R | `photo` (MVP) \| `audio` (P1) |
| `blob` | Blob | R | stored in IndexedDB (raw evidence, not re-encoded) |
| `mimeType` | string | R | e.g. `image/jpeg` |
| `byteSize` | int | R | for quota accounting |
| `capturedAt` | ISO-8601 | R | |
| `originalFilename` | string \| null | O | if from picker |
| `createdAt` | ISO-8601 | R | |

Rules: the blob is raw evidence, never destructively re-encoded in MVP; media capture never blocks
observation save (an observation is valid with no media).

---

## Cross-cutting provenance guarantees

For any observation a later reader can answer:
- **Who?** → `session.observerName` (self-declared, unverified — never overstated).
- **Where?** → `capturedLocation` (raw, immutable) and/or `locationAdjustment`; `effectiveLocation` derived; `accuracyMeters` + `locationStatus` always honest.
- **When?** → `capturedAt` (never regenerated); `createdAt` vs `updatedAt` distinguish capture from edits.
- **How known?** → `evidence.method` (OBSERVED/MEASURED/REPORTED).
- **Modified?** → `edited` / `editCount` / `updatedAt`; capture block never mutated.

Anything the app cannot honestly answer (verified identity, true time accuracy, derived values) is
**left absent rather than faked**.

---

## Export vs Backup (correction §5)

Two distinct outputs. **Export ≠ backup when media exists.**

### DATA EXPORT (analysis / interoperability)
- `observations.json` — canonical, full-fidelity FieldOS records (both location fixes, evidence, edit flags).
- `observations.csv` — flat one-row-per-observation for spreadsheets (media referenced by id/filename).
- `observations.geojson` — one `Feature` per observation; geometry = `effectiveLocation`;
  `properties` carry category, value, evidence method, `edited`, `locationSource`, `accuracyMeters`, ids, timestamps.

CSV/GeoJSON are lossy for media (media is not embedded). That is why a separate backup exists.

### FULL SESSION BACKUP (complete, restorable-in-principle)
One downloadable/shareable **ZIP archive** containing:
```
manifest.json
observations.json
observations.csv
observations.geojson
media/{observationId}_{mediaId}.{ext}
```
`manifest.json` minimum fields:
- `fieldosSchemaVersion`
- `exportedAt` (ISO-8601)
- `sessionId`
- `observationCount`
- `mediaCount`
- `appVersion` (if available)

`observations.json` is the **canonical representation** — a future FieldOS version must, in
principle, be able to restore a session from it. (Restore UI may remain P1; the format is P0.)
ZIP packaging uses **`fflate`** (see ARCHITECTURE_DECISION.md — the platform has no built-in zip).

Serialization invariants: UUIDs and timestamps are **preserved verbatim** through
serialize→deserialize; no timestamp is regenerated on export.
