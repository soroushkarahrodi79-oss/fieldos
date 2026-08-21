# FieldOS — Project Instructions for Claude Code

Concise operating context for future sessions. Read the six Phase 0 docs for detail:
`PRODUCT_CONTRACT.md`, `DATA_MODEL.md`, `UX_FLOW.md`, `ARCHITECTURE_DECISION.md`, `MVP_BACKLOG.md`, this file.

## Product thesis
FieldOS is a **mobile-first, offline-first PWA** that turns a real-world tourism field
observation into **structured, located, timestamped, traceable, exportable evidence** with
minimal friction. Optimized for one-handed outdoor use, poor connectivity, minimum typing,
fast repeated capture, and **no data loss**. Single-user, client-only, no backend in MVP.

It is NOT: a dashboard, GIS platform, social network, route planner, booking app, generic
notes app, chatbot, SNTO frontend, or SaaS. It may integrate with research systems later;
v0 stands alone.

## Architecture constraints
- Client-only PWA. **No backend, no auth, no cloud sync in MVP.**
- Stack: React + TypeScript (strict) + Vite + vite-plugin-pwa (Workbox), Dexie over IndexedDB,
  Web Geolocation API + haversine helper (no map lib), native `<input capture>` photo,
  zero-dep GeoJSON/CSV/JSON data export, **fflate** for the full-session ZIP backup,
  storage-health module (`persist`/`persisted`/`estimate`), `crypto.randomUUID()` for IDs.
  No Redux, no Next.js, no ORM heavier than Dexie, no map/component libraries, no Tailwind/Zustand
  unless demonstrably necessary.
- Service Worker precaches the **app shell only** — it is not a sync layer. Do not depend on
  Background Sync/Push (unreliable/absent on iOS).
- Every entity carries `schemaVersion`; Dexie migrations are explicit; the backup manifest embeds the version.

## Evidence principles (non-negotiable)
1. Offline-first is architectural, not cosmetic. Save is local and never network-gated.
2. Local persistence precedes any cloud sync.
3. **Provenance is never silently overwritten.** `capturedLocation` + `capturedAt` are
   **write-once/immutable**; a correction writes a separate `locationAdjustment`; `effectiveLocation`
   is derived (never persisted over the raw fix); edits touch only interpretation fields and bump `editCount`.
4. Human observations and machine data must stay distinguishable. `evidence.method`
   (OBSERVED/MEASURED/REPORTED) is for the human observer ONLY. No AI output may wear it.
   No `DERIVED`/`MISSING` methods in P0 (absence = null data, not a source).
5. Raw evidence stays recoverable (raw fix retained after adjustment; media blob not destructively re-encoded).
6. **No fake precision, no fake comparability** — category-specific value sets (NOT a universal
   scale), no numeric score, no composite index, honest GPS `accuracyMeters`, no invented AI
   "confidence". Absent data is left absent, not fabricated. Export never regenerates a timestamp.
7. **Export ≠ backup.** Data export (json/csv/geojson) is for analysis; the full-session **ZIP
   backup** (manifest + files + media) is the durability backstop. Both portable, readable outside
   FieldOS (QGIS / Excel / text editor); canonical `observations.json` is restorable in principle.
8. Prefer simple data structures over premature abstraction. **No silent persistence failures** —
   every write handles storage/quota failure explicitly.

## MVP boundaries
- ~5 surfaces: Field Sessions · Session (list-first; **map is P1**) · New Observation ·
  Observation detail · Export & Backup.
- Core loop: open offline → session → observation (auto time+geo) → structured (category +
  category-specific value) + evidence + optional photo/note → save locally → repeat → export/backup.
- Controlled category vocabulary where **each category has its own value set** (discriminated union,
  no shared scale) + free text (see DATA_MODEL.md).
- Evidence methods in MVP: OBSERVED (default), MEASURED (+value/unit/context), REPORTED (+source note).
  `DERIVED`/`MISSING` are NOT exposed in P0.
- Geospatial context is list-first: GPS capture, asset coordinates, haversine distance to nearby/recent assets.

## Prohibited scope creep (do NOT build without an explicit decision to change the contract)
Accounts/auth, multi-user, cloud sync, backend/SaaS, dashboards, ML/auto-classification,
recommendations, GIS analytics, remote sensing / Sentinel-2 / Earth Engine, SNTO/HATI
integration, creator/business features, gamification, social, role management, payments,
arbitrary scoring, fabricated AI confidence. Also deferred: interactive offline **map/tiles**,
**voice-to-structured AI** (P2, must be machine-labelled), full event-sourced audit log,
polygon asset geometry.

## Testing requirements
- **P0 unit tests (Vitest):** data-layer CRUD, capture-block immutability, manual-fix-never-
  overwrites-raw, edit tracking, storage/quota-failure surfaces (no silent success), serializers
  (canonical JSON / CSV / GeoJSON) as golden files, ZIP backup manifest + media, and UUID/timestamp
  round-trip preservation.
- **P0 real-device smoke test** (physical iPhone + Android) BEFORE any field test: offline
  launch, capture with GPS, **background+restart data survival**, quota with photos, export + full
  backup via share sheet. This is the gate — durability is **validated on real devices**, not
  presumed to fail (installed Home Screen Web Apps are exempt from WebKit's ITP 7-day cap, but
  persistence is still browser-controlled and not guaranteed).
- No change may weaken the immutability of the capture block or the human-only evidence methods.

## Standard commands
```
npm install
npm run dev          # local dev server (HTTPS needed for geolocation/PWA)
npm run build        # production build (tsc + vite build)
npm run preview      # preview built PWA
npm run test         # Vitest unit tests (run)
npm run typecheck    # tsc --noEmit (strict)
```

## Current status
**Phase 1A (foundation) in progress.** Data layer, domain types, serializers, backup, storage-health
and tests only. **No polished UI, no maps, no deploy, no auth.** A minimal dev/debug screen may exist
to verify persistence. Build the polished five-screen UI only after the Phase 1A review passes.
