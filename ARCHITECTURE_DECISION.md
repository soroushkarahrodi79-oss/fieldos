# FieldOS — Architecture Decision (v0)

> Rule of the day (brief §10): offline-first is architectural, local persistence precedes
> cloud, prefer **boring, mature** technology, and for every dependency answer:
> *what does this solve that the platform cannot do adequately by itself?*

## Guiding stance

MVP has **no backend**. It is a client-only, offline-first PWA that reads/writes local storage
and exports files. That single decision removes an entire universe of complexity (auth, servers,
sync, infra) and is aligned with the thesis. Everything below is judged against "does it earn its place."

## Decisions

### React — **ADOPT (with reservation)**
- *Problem it solves:* component model + huge, boring ecosystem + team hireability. Managing the
  capture form's state and a few list screens by hand is doable but tedious and error-prone.
- *Could the platform do it?* Yes — vanilla JS or web components could. The app is small.
- *Verdict:* Adopt for maturity/familiarity, but this is the least-essential choice. **Preact**
  (3KB, same API) is a legitimate lighter swap if bundle size matters on slow field connections.
  Do not reach for Next.js/SSR — there is no server and no SEO need; it would be pure overhead.

### TypeScript — **ADOPT (strong yes)**
- *Problem it solves:* the whole product is about **provenance integrity**. Types make the
  data model (evidence methods, immutable capture block, CapturedLocation, discriminated
  ObservationValue, schemaVersion) enforceable
  and refactor-safe. This is exactly where TS pays off.
- *Platform alternative:* JSDoc types — weaker. Adopt real TS.

### Vite — **ADOPT**
- *Problem it solves:* fast dev/build, first-class PWA support via `vite-plugin-pwa`
  (Workbox under the hood), sane defaults. Boring and mature.
- *Platform alternative:* hand-rolled build — more work, no benefit. Adopt.

### PWA + Service Worker — **ADOPT (required by thesis)**
- *Problem it solves:* offline app-shell loading (open the app with no signal), installability
  (add-to-home-screen), and cache control. Without a SW the app cannot open offline. Non-negotiable.
- *Scope discipline:* the SW's MVP job is **precache the app shell / assets** for offline launch.
  It is **not** a data-sync layer. Background Sync is unreliable (absent on iOS) — do not depend on it.
- *Platform alternative:* none for offline launch. Adopt, minimal Workbox config.

### IndexedDB — **ADOPT (required)**
- *Problem it solves:* the only browser store that holds **structured records + Blobs (photos)**
  at meaningful size, asynchronously, offline. localStorage is ~5MB, synchronous, strings-only — unusable for media.
- *Platform alternative:* none adequate. Adopt.

### Dexie — **ADOPT (convenience, not necessity)**
- *Problem it solves:* raw IndexedDB is verbose and awkward (transactions, cursors, versioning
  ceremony). Dexie is a small, mature, well-documented wrapper with clean queries and schema
  versioning/migrations — which we need for `schemaVersion` evolution.
- *Platform alternative:* raw IndexedDB (works, more boilerplate/bugs) or idb (thin wrapper).
- *Verdict:* Adopt Dexie for developer safety on migrations and transactions. If we want to
  minimize deps, `idb` (Jake Archibald, tiny) is the fallback. Either is fine; **not** a heavier ORM.

### Web Geolocation API — **ADOPT (required)**
- *Problem it solves:* lat/lon + accuracy + altitude/altitude accuracy + heading + speed + timestamp,
  the core located-evidence capture. Every value is mapped directly from the browser fix; FieldOS
  does not derive missing motion or uncertainty metadata.
  `getCurrentPosition` with `enableHighAccuracy` and a timeout.
- *Platform alternative:* none. Adopt. Note: requires HTTPS + user gesture; no background geo in PWA.

### Media Capture — **ADOPT native `<input type="file" accept="image/*" capture>` (MVP)**
- *Problem it solves:* a photo, reliably, on iOS and Android, using the OS camera.
- *Why not getUserMedia/MediaRecorder for photos?* Historically flaky in standalone iOS PWAs and
  more code. The native input is boring and reliable. **Audio (MediaRecorder) is P1** precisely
  because of iOS quirks. Adopt the simplest thing that works.

### GeoJSON / CSV / JSON export — **ADOPT (all three, dependency-free)**
- *Problem it solves:* portability (§10.8). GeoJSON → QGIS/mapping; CSV → Excel/analysts;
  JSON → canonical full fidelity. Generated on-device with `Blob` + the OS share/download sheet.
- *Platform alternative:* the platform *does* this itself (no library needed) — keep it dependency-free.
- Serialization invariant: UUIDs and timestamps pass through **verbatim**; no timestamp is
  regenerated on export.

### fflate (ZIP for full-session backup) — **ADOPT (justified, correction §5)**
- *Problem it solves:* a **full session backup** must be a single shareable archive bundling
  `manifest.json` + the three data files + `media/*`. The web platform has **no built-in ZIP writer**;
  hand-rolling a spec-correct ZIP (with binary media) is error-prone.
- *Why fflate specifically:* tiny (~8KB), zero-dependency, actively maintained, synchronous
  `zipSync` — boring and appropriate. Distinct from *data export* (json/csv/geojson), which stays
  dependency-free.
- *Verdict:* **Accept** — this is the one MVP dependency beyond the core stack, and it is justified
  by "export ≠ backup when media exists."

### Storage-health utilities — **ADOPT (platform APIs, no dependency)**
- *Problem it solves:* durability is **not guaranteed** and must be observable. Wrap
  `navigator.storage.persist()`, `persisted()`, and `estimate()` into a small module used to
  request persistence on first write, report status to the durability banner, and account for quota.
- WebKit/Safari supports these APIs and **exempts installed Home Screen Web Apps from the ITP 7-day
  cap**; the earlier "loses IndexedDB after ~7 days" claim was incorrect and is removed. Durability
  is a **validation requirement** (real-device testing), not a presumed failure mode. Every write
  still handles failure explicitly — no silent persistence failures.

## Explicitly rejected for MVP

| Tech | Why rejected now |
|------|------------------|
| Any backend / DB server / API | No sync in MVP; adds infra, auth, ops. Local-first first. |
| Auth / accounts | Non-goal; `observerName` string suffices. |
| Map tile library (Leaflet/MapLibre) + offline tiles | Big complexity, low field value vs coordinate capture. **P1.** P0 geospatial context = GPS capture + asset coordinates + **haversine distance to nearby/recent assets** (a ~10-line helper, no dependency). |
| Redux / heavy state libs | App state is small; React state/context or a tiny store (Zustand) is plenty. |
| ORM heavier than Dexie | Overkill for 4 entities. |
| Background Sync / Push | Unreliable/absent on iOS; not needed with no backend. |
| Native app / Capacitor shell | Only reconsider **if** real-device durability testing (A1) proves IndexedDB cannot be durably retained even with persistent storage + backup. |

## Recommended P0 stack (concrete)

- **React + TypeScript + Vite**
- **vite-plugin-pwa (Workbox)** — precache app shell only
- **Dexie** over IndexedDB
- **Web Geolocation API** for located evidence + **haversine helper** for asset distance (no map lib)
- **Native file-capture input** for one photo per observation
- **Zero-dependency GeoJSON/CSV/JSON data export** via Blob + OS share/download
- **fflate** for the full-session **ZIP backup** (the one justified extra dependency)
- **Storage-health module** wrapping `storage.persist()/persisted()/estimate()`
- **`crypto.randomUUID()`** for IDs (platform built-in — no uuid library needed)
- Light state via React state/context; **no** Redux, **no** Zustand unless demonstrably necessary,
  **no** Tailwind/component libraries unless demonstrably necessary

## Architecture invariants (must hold in code)

1. **Persistence is synchronous-feeling and never network-gated.** Save writes to IndexedDB and
   returns. **No silent persistence failures** — a failed/quota-exceeded write surfaces an error and
   never reports success.
2. **Immutable capture block.** The code path that writes `capturedLocation`/`capturedAt` is
   write-once; edits touch only the interpretation block and bump `editCount`. A manual correction
   writes a separate `locationAdjustment`; `effectiveLocation` is derived, never persisted over the raw fix.
   Raw altitude accuracy, heading, and speed are included in this immutable block and are never
   overwritten by a manual location adjustment.
3. **Raw before derived, user before machine.** No machine-generated field may occupy an
   `evidence.method` of OBSERVED/MEASURED/REPORTED; those are for the human observer only. No
   `DERIVED`/`MISSING` methods, no fabricated coordinates, no fake confidence, no generic score.
4. **Schema is versioned.** Every entity carries `schemaVersion`; the backup manifest embeds the
   logical schema version so old archives remain interpretable. Dexie migrations are explicit when
   stores or indexes change. Schema 2's additive nullable GNSS fields require no IndexedDB migration:
   legacy missing properties normalize to explicit `null` at repository/import boundaries without
   rewriting on read. A later full observation write persists the normalized current shape and
   upgrades that entity's `schemaVersion` to the current schema. Schema 3 (P1-5) **does** take a real
   Dexie upgrade (**DB version 1 → 2**) because it adds a new `observationAudit` store; the logical
   FieldOS schema is a separate counter (**2 → 3**). The upgrade re-declares the four original stores
   unchanged so existing rows are preserved, and manufactures no historical entries.
7. **Append-only revision history, transactionally atomic (P1-5).** Beyond `editCount`, each
   observation has a durable `observationAudit` log answering *what changed, when, and the previous
   state*. It is append-only **at the application layer** (no public update/delete) — deliberately
   **not** described as cryptographically tamper-proof, signed, or a legal chain of custody, since P0
   has no accounts, signatures, or remote anchoring. Every audited mutation writes the observation and
   its audit entry in **one Dexie read-write transaction**; a failure rolls back both (surfaced as
   `StoragePersistenceError`, never a false success). The immutable raw capture block is never copied
   into snapshots and never appears as edited. Event sourcing remains out of scope: this is a targeted
   revision log over mutable fields, not a full event-sourced rebuild of every entity.
5. **Durability is engineered and validated, not assumed.** Request `storage.persist()` on first
   write; surface `persisted()`/`estimate()` state to the UI; make the **full-session backup** the
   trusted backstop. Durability is proven by real-device testing.
6. **Export/backup is lossless and portable.** Round-trip check: canonical `observations.json`
   serialize→deserialize reproduces records verbatim (UUIDs/timestamps preserved); GeoJSON opens in
   QGIS; CSV opens in Excel; the ZIP backup contains manifest + files + all media.

## Testing requirements (architectural, not aspirational)

- **Data-layer unit tests** are P0: create/edit/soft-delete observation; immutability of capture
  block; manual-fix-does-not-overwrite-raw; edit tracking; storage/quota-failure surfaces (never
  silent); serializers (canonical JSON/CSV/GeoJSON) golden-file tested; ZIP backup manifest + media;
  UUID/timestamp preservation through round-trip.
- **Real-device smoke test** on a physical iPhone + Android before the field test: offline launch,
  capture with GPS, background+restart survival, quota with photos, export via share sheet.
- Prefer **Vitest** (pairs with Vite) for units; manual device checklist for the rest in MVP.
  No heavy e2e harness for v0.
