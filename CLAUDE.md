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
   append-only history—not cryptographic tamper-proofing or a legal chain of custody. Restore
   preflights a ZIP or canonical JSON, then reconstructs in one atomic transaction that never
   remaps UUIDs and never overwrites existing records (collisions are rejected, no silent partial
   restore); new backups carry SHA-256 payload-byte verification — a corruption/change check only,
   not signing, authentication, tamper-proofing, or a legal chain of custody.
7. Surface storage/quota failures; never report a failed write as saved.

## Current implementation and evidence ceiling

The implemented workflow includes local sessions; structured observations; immutable GPS/time
provenance and non-destructive correction; photos with separate camera and library selection;
offline voice-note capture; revision history; export; ZIP backup; atomic full-session restore
(full ZIP, or canonical JSON data-only) with collision rejection; storage safeguards; and a
read-only MapLibre session map with an online-only basemap. The map was excluded from historical
P0 and later delivered as P1-1; it is not an offline-map feature.

**Protocol Engine v1 (delivered):** the observation vocabulary is now definition-driven, not
hard-coded. Each session binds an immutable, versioned **protocol snapshot** that defines its
categories, values, labels, and note policy; capture and runtime validation are driven by that
snapshot. The built-in **Tourism Field Observation Core** carries the exact historical P0
vocabulary and is the default. Legacy pre-engine sessions keep `protocolSnapshot: null` and
validate against the legacy Tourism vocabulary — no fabricated snapshot is written. Logical schema
3 → 4 (additive nullable `FieldSession.protocolSnapshot`; **no Dexie migration** — DB stays at
version 2). Evidence methods stay FieldOS-owned and separate from protocols.

**Campaign + FieldPack v1 (delivered):** FieldOS can prepare a bounded mission before going outside
and operate it fully offline. A `.fieldpack` (a ZIP of `manifest.json` + `protocol.json` +
`assets.geojson`, with **required** SHA-256 payload integrity) is validated entirely in memory
(preflight-first: manifest → SHA-256 → protocol → GeoJSON → collision → preview → confirm), then
installed **atomically** as a local **`FieldCampaign`** binding exactly one immutable protocol
snapshot plus preloaded **point** assets. Campaigns can also be created locally against a built-in
protocol. A session may be bound to a campaign (`FieldSession.campaignId`) and inherits a copy of
the campaign's protocol snapshot; standalone/legacy sessions stay `campaignId: null`. Campaign
assets carry `campaignId` + `sourceRef` (external mission id preserved alongside the local UUID) and
`sessionId: null` — they are resolved by reference into a session's asset queries, never duplicated.
Duplicate `fieldpackId+version` imports are blocked; a same-id different-version import is blocked as
an unsupported upgrade (no auto-update/merge). Logical schema 4 → 5; **Dexie DB 2 → 3** (new
`campaigns` store + `campaignId` indexes; legacy rows preserved, campaign fields normalize to `null`
on read). Session export carries lightweight `campaignContext`; a campaign-bound session restores
self-contained even when its Campaign is absent — no Campaign is ever fabricated. This closes the
previously deferred "preloaded GeoJSON assets" capability for points only. It is **not** remote
mission deployment, a signed/trusted-publisher package, automatic FieldPack updates, a FieldPack or
protocol authoring UI, coverage intelligence, or offline map tiles.

Recorded validation is deliberately narrower: an owner-attested iPhone device checklist
(2026-08-21), one owner-attested real 60–120 minute iPhone field run (2026-08-31), iPhone voice
core flow (2026-08-31), and iPhone map validation (2026-09-01). This is not a production-ready,
cross-platform, or generally field-proven claim. Physical Android validation, voice edge cases,
GPS accuracy measurement, and repeated/long-duration campaigns remain unrecorded or pending.
See `MVP_BACKLOG.md` and the linked evidence records for exact boundaries.

## Explicitly deferred

FieldPack **authoring/export UI**, campaign **updates/merge/auto-upgrade**, non-point (polygon)
FieldPack assets, offline map tiles inside packs, remote FieldPack registry, Coverage Intelligence,
generic protocol form builder / user protocol authoring, polygon geometry, multiple photos, privacy
export profiles, quota dashboard, selected/per-observation export, offline PMTiles basemap, cloud
sync, multi-user capability, dashboards/analytics, AI voice-to-structured suggestions /
transcription, and SNTO/HATI integration are not implemented. (Campaign + FieldPack v1 delivered
import of a versioned, integrity-checked pack with a protocol and preloaded **point** assets,
installed as a local Campaign — see above.) Do not add the remaining items without a deliberate
contract decision.

## Standard checks

```bash
npm run typecheck
npm test
npm run build
```
