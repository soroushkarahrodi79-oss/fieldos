# FieldOS — Operating Context

FieldOS is a mobile-first, offline-first, single-user PWA for capturing structured tourism field
evidence. It turns an observation into located, timestamped, traceable, exportable local data with
minimal field friction. It has no backend, accounts, authentication, or cloud sync.

## Read these first

- `PRODUCT_CONTRACT.md` owns product thesis, scope, non-goals, and deliberate decisions.
- `DATA_MODEL.md` owns canonical data semantics and provenance rules.
- `ARCHITECTURE_DECISION.md` owns accepted architecture and invariants.
- `UX_FLOW.md` owns intended interaction surfaces and principles.
- `MVP_BACKLOG.md` is the **canonical implementation-status ledger**: delivered, validated,
  pending, deferred, and the evidence supporting each claim.
- `docs/` contains evidence records and checklists. Claims must never be strengthened without
  newly recorded evidence.

## Non-negotiable invariants

1. Offline-first is architectural. Save is local and never network-gated.
2. Local persistence precedes any cloud capability.
3. `capturedAt` and raw `capturedLocation` are write-once. A correction is a separate
   `locationAdjustment`; `effectiveLocation` is derived.
4. `OBSERVED`, `MEASURED`, and `REPORTED` are human evidence methods only. Machine output must be
   clearly labelled and cannot impersonate them.
5. Do not fabricate coordinates, confidence, missing values, universal scores, or composite scores.
6. Data export and full ZIP backup are distinct. Local audit history is application-level,
   append-only history—not cryptographic tamper-proofing or a legal chain of custody.
7. Surface storage/quota failures; never report a failed write as saved.

## Current implementation and evidence ceiling

The implemented workflow includes local sessions; structured observations; immutable GPS/time
provenance and non-destructive correction; photos with separate camera and library selection;
offline voice-note capture; revision history; export; ZIP backup; storage safeguards; and a
read-only MapLibre session map with an online-only basemap. The map was excluded from historical
P0 and later delivered as P1-1; it is not an offline-map feature.

Recorded validation is deliberately narrower: an owner-attested iPhone device checklist
(2026-08-21), one owner-attested real 60–120 minute iPhone field run (2026-08-31), iPhone voice
core flow (2026-08-31), and iPhone map validation (2026-09-01). This is not a production-ready,
cross-platform, or generally field-proven claim. Physical Android validation, voice edge cases,
GPS accuracy measurement, and repeated/long-duration campaigns remain unrecorded or pending.
See `MVP_BACKLOG.md` and the linked evidence records for exact boundaries.

## Explicitly deferred

Restore/import UI, preloaded GeoJSON assets, polygon geometry, multiple photos, privacy export
profiles, quota dashboard, selected/per-observation export, offline PMTiles basemap, cloud sync,
multi-user capability, dashboards/analytics, AI voice-to-structured suggestions, and SNTO/HATI
integration are not implemented. Do not add them without a deliberate contract decision.

## Standard checks

```bash
npm run typecheck
npm test
npm run build
```
