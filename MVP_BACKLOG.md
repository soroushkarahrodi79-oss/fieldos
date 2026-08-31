# FieldOS — MVP Backlog (v0)

Priority definitions:
- **P0** — required before the first real 1–2 hour field test. If any P0 is missing, the core
  workflow (capture → located → offline-saved → exported, without data loss) is broken.
- **P1** — useful right after the first field test; not required to prove the thesis.
- **P2** — later; explicitly out of the near path.

Every P0 below is traced to the core workflow. If it isn't necessary for that workflow, it isn't P0.

## Implementation snapshot — 2026-08-31

- Implemented in code: P0-1 through P0-20, including the five-screen local workflow, honest GPS
  failure states, nearby asset selection, one-photo capture, non-destructive editing/location
  adjustment, data export, ZIP backup, durability banner, and automated domain/data/export tests.
- Completed by owner attestation on 2026-08-21: **P0-21 physical iPhone and Android smoke testing**,
  using [docs/DEVICE_SMOKE_TEST.md](docs/DEVICE_SMOKE_TEST.md). The recorded gate result is in
  [docs/DEVICE_TEST_RESULT.md](docs/DEVICE_TEST_RESULT.md).
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
- Next engineering state: maps, OPFS, or AI work remain deferred and bounded by the product contract.
- Post-MVP P1/P2 scope remains deferred unless the product contract is deliberately changed.

---

## P0 — required before first field test

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
- **P0-12** One photo per observation via native capture; never blocks save; blob stored in IndexedDB.
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
  background/restart survival, quota-with-photos, export + full backup. **Gate for the field test.**
  (Durability is validated here — not presumed to fail.)

---

## P1 — useful after first field test

- **P1-1** Interactive map view (MapLibre/Leaflet) to see observations as points; **online tiles first**,
  cached/offline tiles only if justified.
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
- **P1-3** Import preloaded reference assets from GeoJSON (with `source: preloaded`).
- **P1-4** Asset polygon geometry (beyond points).
- **P1-5** Full revision/audit log per observation (append-only), beyond editCount. **Delivered
  2026-08-31.** Transactional `observationAudit` store (Dexie DB v2, logical schema v3) recording
  `CREATED` / `INTERPRETATION_UPDATED` / `LOCATION_ADJUSTED` / `SOFT_DELETED` / `RESTORED` with
  before/after snapshots of mutable state (raw capture excluded and provably unchanged). No history
  fabricated for legacy records; full trail in canonical JSON + ZIP backup; read-only History surface
  on observation detail. Claim boundary: append-only local history, not cryptographic immutability.
- **P1-6** Restore UI: re-import a full-session backup / canonical `observations.json` (the format is P0; the UI is P1).
- **P1-7** Refine per-category value sets or add categories, if the first field test shows gaps.
- **P1-8** Multiple photos per observation.
- **P1-9** Coordinate-precision reduction option when sharing (privacy).
- **P1-10** Quota dashboard (bytes used / remaining, per session).
- **P1-11** Session-level and per-observation export; export selected records.

## P2 — later

- **P2-1** Optional cloud backup/sync (local-first still authoritative).
- **P2-2** Multi-user / shared sessions, roles.
- **P2-3** Any dashboard/analytics.
- **P2-4** AI voice-to-structured-observation module — **only** as clearly machine-labelled,
  never masquerading as OBSERVED/MEASURED/REPORTED field evidence.
- **P2-5** SNTO / HATI or other research-system integration.
- **P2-6** `DERIVED` evidence method (only once something actually derives data).

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
