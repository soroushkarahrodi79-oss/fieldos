# FieldOS — MVP Backlog (v0)

Priority definitions:
- **P0** — required before the first real 1–2 hour field test. If any P0 is missing, the core
  workflow (capture → located → offline-saved → exported, without data loss) is broken.
- **P1** — useful right after the first field test; not required to prove the thesis.
- **P2** — later; explicitly out of the near path.

Every P0 below is traced to the core workflow. If it isn't necessary for that workflow, it isn't P0.

## Canonical implementation-status ledger — reconciled 2026-09-07

Status terms are intentional: **implemented** means present in merged code; **validated** means
only the evidence explicitly linked below; **pending** means a planned check or feature without
that evidence; **deferred** means not implemented and not an accepted commitment beyond the
existing contract. Code, merged history, and recorded evidence together determine status.

- Implemented in code: P0-1 through P0-20, including the five-screen local workflow, honest GPS
  failure states, nearby asset selection, one-photo capture, non-destructive editing/location
  adjustment, data export, ZIP backup, durability banner, and automated domain/data/export tests.
- Completed by owner attestation on 2026-08-21: **P0-21 physical-device smoke testing on iPhone**,
  using [docs/DEVICE_SMOKE_TEST.md](docs/DEVICE_SMOKE_TEST.md). The recorded gate result is in
  [docs/DEVICE_TEST_RESULT.md](docs/DEVICE_TEST_RESULT.md). Android physical-device testing has not
  been performed and remains pending — the P0-21 checklist calls for both platforms, but only iPhone
  evidence exists.
- Completed by owner attestation on 2026-08-31: **FIRST FIELD RUN: PASS**. The 60–120 minute real
  field workflow passed its executed acceptance checks, including offline capture, tested
  close/reopen persistence, export, and backup, with no intended data loss. Exact counts and timing
  metrics were not recorded. See [docs/FIRST_FIELD_RUN.md](docs/FIRST_FIELD_RUN.md).
- Delivered on 2026-08-31: **P1-5 append-only observation audit/revision history**. Each observation
  now carries a durable `observationAudit` log (`CREATED`, `INTERPRETATION_UPDATED`,
  `LOCATION_ADJUSTED`, `SOFT_DELETED`, `RESTORED`) written atomically with the observation in one
  Dexie transaction (DB version 1 → 2; logical schema 2 → 3). Raw capture immutability is preserved,
  no history is fabricated for legacy records, and canonical JSON / ZIP backup carry the full trail.
  It is append-only local history — **not** cryptographic tamper-proofing. See DATA_MODEL.md.
- Delivered on 2026-08-31: **P1-1 Spatial Map MVP**. A per-session MapLibre GL
  map view shows observations, assets, and a single current-position fix as tappable points, with a
  concise popup card and navigation to the existing observation detail. Observation placement uses the
  existing derived `effectiveLocation` policy (adjusted pin when a `locationAdjustment` exists, raw fix
  otherwise); the card states honestly when a mapped position is manually adjusted and that the raw GPS
  is retained. Basemap is **online-only** OpenStreetMap raster (keyless, attributed, MVP/testing only);
  offline or tile failure shows a "Basemap unavailable" banner while overlays remain renderable. **No
  schema or Dexie migration**, no map-only persisted coordinates. PMTiles / offline basemap / tracking
  remain deferred. Spatial transformation logic is isolated in `src/spatial/` with focused unit tests;
  MapLibre rendering is not unit-tested (validated by production preview + browser QA).
- Delivered on 2026-09-07: **P1-6 Restore + backup integrity**. Sessions can be restored from a
  preflighted full FieldOS ZIP or data-only canonical JSON with provenance-preserving IDs/timestamps,
  atomic Dexie writes, collision rejection, and clear media-loss warnings for JSON. New ZIP manifests
  carry SHA-256 payload hashes; this verifies payload bytes against the manifest only, not authorship
  or tamper-proof evidence. Older valid backups remain explicitly legacy-unverified.
- Delivered on 2026-09-07: **Protocol Engine v1**. The observation vocabulary is now definition-driven
  rather than a hard-coded TypeScript union. Each session binds an **immutable, versioned protocol
  snapshot** (`src/protocol/`) defining its categories, controlled values, labels, and note policy;
  capture, detail/edit, map, revision-history, and export all resolve through it. The built-in
  **Tourism Field Observation Core** (`fieldos-tourism-core` v1) reproduces the exact P0 vocabulary
  and is the default. Correctness moved from a compile-time union to runtime validation enforced at
  every write. Serialized observation shape (`{ category, value }`) is unchanged; canonical JSON/ZIP
  carry the snapshot and restore validates its structure (blocking malformed/newer protocols). Legacy
  sessions keep `protocolSnapshot: null` and use the legacy Tourism vocabulary with no fabricated
  snapshot. Logical schema 3 → 4; **no Dexie migration** (DB stays version 2). Claim boundary: this is
  a narrow, evidence-oriented protocol model — **not** a generic form/survey builder, and v1 has no
  user protocol authoring, import, or remote registry (deferred to a future FieldPack gate).
- Corrected on 2026-09-01: New Observation offers separate native **Take photo** and **Choose photo**
  actions. Both stage the same single optional photo and use the existing local media persistence path.
- Delivered on 2026-09-07: **Campaign + FieldPack v1**. FieldOS can prepare a bounded field mission
  before going outside and run it fully offline. A versioned, SHA-256 integrity-checked `.fieldpack`
  (ZIP of `manifest.json` + `protocol.json` + `assets.geojson`) is validated **preflight-first**
  entirely in memory (manifest → SHA-256 → protocol → GeoJSON → collision → preview → confirm) and
  installed **atomically** as a local **`FieldCampaign`** (`src/fieldpack/`) binding one immutable
  protocol snapshot plus preloaded **point** assets; campaigns can also be created locally. Sessions
  bind to a campaign (`FieldSession.campaignId`), inherit a copy of its protocol, and resolve campaign
  planned assets by reference (nearby/link/map) without duplication; assets keep `campaignId` +
  `sourceRef` (external mission id preserved beside the local UUID). Duplicate `fieldpackId+version`
  imports and same-id different-version upgrades are blocked. Export carries lightweight
  `campaignContext`; a campaign-bound session restores self-contained with **no fabricated Campaign**.
  Logical schema 4 → 5; **Dexie DB 2 → 3** (new `campaigns` store + `campaignId` indexes; legacy rows
  preserved). This closes the deferred "preloaded GeoJSON assets" capability for **points only**.
  Claim boundary: **not** remote deployment, live team coordination, signed/trusted packages,
  automatic updates, a FieldPack/protocol editor, generic GIS import, offline maps, coverage planning,
  or analytics.
- The historical P0 decision was list-first, with no interactive map library. The later P1-1 map
  does not revise that history or make offline maps implemented.
- The remaining P1/P2 entries below are deferred unless the product contract is deliberately changed.

---

## P0 — historical first-field-test scope (implemented; evidence is bounded)

### Foundation
- **P0-1** Project scaffold: React + TS (strict) + Vite + vite-plugin-pwa; installable PWA that **launches offline**.
- **P0-2** IndexedDB data layer (Dexie): `FieldSession`, `Asset`, `Observation`, `MediaAttachment`
  with `schemaVersion`; write-once capture block enforced in code; discriminated `ObservationValue` + `Evidence`.
- **P0-3** Storage-health module wrapping `storage.persist()` / `persisted()` / `estimate()`; request
  persistence on first write; expose durability + quota state to UI; **every write handles failure explicitly**.
- **P0-4** Data-layer unit tests (Vitest): CRUD, capture-block immutability, manual-fix-never-overwrites-raw,
  edit tracking, and storage/quota-failure surfaces (no silent success).

### Field Sessions
- **P0-5** Create / name / resume / close a session (title required; observerName/purpose optional). Local only.
- **P0-6** Sessions home screen with empty state and "resume active session."

### Capture (the core)
- **P0-7** New Observation screen: auto timestamp + auto geolocation (with accuracy) on open.
- **P0-8** Category single-select (controlled vocabulary) — the one required choice.
- **P0-9** **Category-specific value** select (the discriminated per-category values; no universal
  scale) + free-text note (optional; required by convention for `other`).
- **P0-10** Evidence control: OBSERVED default / MEASURED (+ value/unit + optional context) /
  REPORTED (+ optional source note).
- **P0-11** Graceful geolocation failure: denied/timeout/unavailable → set `locationStatus`, **save anyway**, no fabricated coordinate.
- **P0-12** One photo per observation via native camera capture or existing photo/file selection;
  never blocks save; blob stored in IndexedDB.
- **P0-13** Save is instant, local, never network-gated; returns to list with new item on top.
- **P0-13b** Geospatial context without a map: distance to nearby assets + selection from
  nearby/recent assets (haversine helper; no map library).

### Review / edit
- **P0-14** Observation list per session (category, category-specific value, time, accuracy, media/edited badges).
- **P0-15** Observation detail with immutable capture block shown; edit interpretation fields (bumps editCount).
- **P0-16** Non-destructive location adjustment (writes `locationAdjustment`; raw `capturedLocation`
  retained; `effectiveLocation` derived); soft-delete with undo.

### Export & Backup (durability backstop)
- **P0-17** **Data export** → `observations.json` (canonical) + `observations.csv` + `observations.geojson`,
  generated on-device, via OS share/download. Fully offline. Timestamps/UUIDs preserved verbatim.
- **P0-18** Serializer golden-file tests incl. evidence method / edited / location-source / accuracy /
  category-specific value; UUID + timestamp round-trip preservation.
- **P0-19** **Full-session ZIP backup** (fflate): `manifest.json` + the three data files + `media/*`;
  manifest carries schema version, exportedAt, sessionId, observation count, media count, app version.
  Fallback "data export without media" if ZIP generation fails — structured data must always get out.

### Safety net
- **P0-20** Durability banner: nudge to **back up** when `persisted()` is false / session old & unbacked-up.
- **P0-21** Real-device smoke test (physical iPhone + Android): offline launch, capture+GPS,
  background/restart survival, quota-with-photos, export + full backup. **Implemented checklist;
  iPhone PASS is owner-attested; Android remains pending.** See `docs/DEVICE_TEST_RESULT.md`.

---

## P1 — useful after first field test

- **P1-1** Interactive map view (MapLibre/Leaflet) to see observations as points; **online tiles first**,
  cached/offline tiles only if justified. **Delivered 2026-08-31 as the P1-1 Spatial Map MVP.** MapLibre
  GL JS (open-source, no key) renders observations, assets, and a single current-position fix as tappable
  points over an **online-only** OSM raster basemap (attributed; MVP/testing, not production). Observation
  placement follows the derived `effectiveLocation` policy with explicit captured-vs-adjusted provenance
  in the popup; raw `capturedLocation` is never mutated. Graceful offline/tile-failure fallback; no schema
  or DB migration; pure spatial logic in `src/spatial/` is unit-tested. Cached/offline tiles (PMTiles) are
  **not** implemented and remain deferred (see out-of-scope note below).
- **P1-2** Voice notes (MediaRecorder) — audio attachments; handle iOS quirks.
  **Implemented in code; physical iPhone core flow PASS — owner-attested, 2026-08-31.** Native `getUserMedia` +
  `MediaRecorder` capture with runtime MIME negotiation (`audio/mp4` first for Safari/iOS),
  optional per-observation voice note, in-place preview/replay/remove/re-record, a 3-minute
  defensive cap, local IndexedDB persistence via the existing generic `MediaAttachment`, audio
  playback on the observation detail screen, honest media badges (no longer mislabelled "Photo"),
  and audio coverage in the full-session ZIP backup. No transcription, no backend, no AI, no
  network dependency. Permission denial, storage pressure, exact 3-minute auto-stop,
  unsupported-browser handling, other checklist edge cases, and Android physical validation remain
  pending. See `docs/VOICE_NOTES_SMOKE_TEST.md` for the evidence boundary and remaining plan.
- **P1-3** Import preloaded reference assets from GeoJSON (with `source: preloaded`). **Delivered
  2026-09-07 as part of Campaign + FieldPack v1** — POINT assets only, imported inside a `.fieldpack`
  and installed atomically as campaign-owned assets (`campaignId` + `sourceRef`, `sessionId: null`).
  Standalone GeoJSON import outside a FieldPack, and non-point geometry, remain out of scope.
- **P1-4** Asset polygon geometry (beyond points). **Deferred; not implemented** (FieldPack v1
  rejects non-point geometry).
- **P1-5** Full revision/audit log per observation (append-only), beyond editCount. **Delivered
  2026-08-31.** Transactional `observationAudit` store (Dexie DB v2, logical schema v3) recording
  `CREATED` / `INTERPRETATION_UPDATED` / `LOCATION_ADJUSTED` / `SOFT_DELETED` / `RESTORED` with
  before/after snapshots of mutable state (raw capture excluded and provably unchanged). No history
  fabricated for legacy records; full trail in canonical JSON + ZIP backup; read-only History surface
  on observation detail. Claim boundary: append-only local history, not cryptographic immutability.
- **P1-6** Restore UI: re-import a full-session backup / canonical `observations.json` (the format is
  P0; the UI is P1). **Delivered 2026-09-07.** Flow is preflight → preview → confirm → one atomic
  restore: a full FieldOS ZIP or data-only canonical JSON is parsed and runtime-validated, previewed,
  then reconstructed in a single Dexie transaction with provenance-preserving IDs/timestamps and **no
  UUID remapping**. Collisions with existing sessions/records are **rejected** (no overwrite, no
  merge, no silent partial restore); JSON-only imports restore data without fabricating media and warn
  about media loss. New ZIP manifests carry **SHA-256 payload-byte** hashes verified before any write;
  older valid backups without hashes are treated as **legacy-unverified, not verified**. Integrity is
  a payload corruption/change check only — **not** signing, authentication, tamper-proofing, or a
  legal chain of custody.
- **P1-7** Refine per-category value sets or add categories, if field evidence shows gaps. **Deferred; not implemented.**
- **P1-8** Multiple photos per observation. **Deferred; not implemented.**
- **P1-9** Coordinate-precision reduction option when sharing (privacy). **Deferred; not implemented.**
- **P1-10** Quota dashboard (bytes used / remaining, per session). **Deferred; not implemented.**
- **P1-11** Session-level and per-observation export; export selected records. **Deferred; not implemented.**

## P2 — later

- **P2-1** Optional cloud backup/sync (local-first still authoritative). **Deferred; not implemented.**
- **P2-2** Multi-user / shared sessions, roles. **Deferred; not implemented.**
- **P2-3** Any dashboard/analytics. **Deferred; not implemented.**
- **P2-4** AI voice-to-structured-observation module — **only** as clearly machine-labelled,
  never masquerading as OBSERVED/MEASURED/REPORTED field evidence. **Deferred; not implemented.**
- **P2-5** SNTO / HATI or other research-system integration. **Deferred; not implemented.**
- **P2-6** `DERIVED` evidence method (only once something actually derives data). **Deferred; not implemented.**

---

## Traceability check (P0 → workflow)

| Workflow step | Covered by |
|---------------|-----------|
| Open app offline | P0-1 |
| Resume/create session | P0-5, P0-6 |
| Create observation | P0-7, P0-8, P0-9 |
| Auto timestamp + coordinates + accuracy | P0-7 |
| Structured (category + category-specific value) + evidence + note | P0-8, P0-9, P0-10 |
| Geospatial context (nearby assets, no map) | P0-13b |
| Attach photo | P0-12 |
| Save locally offline, no loss | P0-2, P0-3, P0-13, P0-20 |
| Continue rapidly | P0-13, P0-14 |
| Edit unsynced / adjust location non-destructively | P0-15, P0-16 |
| Export + full backup later | P0-17, P0-19 |
| Trust / provenance / durability | P0-3, P0-4, P0-18, P0-20, P0-21 |
