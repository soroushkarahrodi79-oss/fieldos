# FieldOS

FieldOS is an offline-first progressive web app for structured tourism field research and evidence collection. It keeps sessions, observations, GPS provenance, and photos on the device, then produces portable JSON, CSV, GeoJSON, and full-session ZIP backups without requiring a network connection.

## Current status

The repository contains the first usable MVP workflow:

- create, resume, inspect, and close local field sessions;
- capture category-specific observations with timestamps and honest GPS status;
- record observed, measured, or reported evidence;
- attach a photo, record an optional offline voice note, and link a nearby known asset;
- review and edit interpretation while preserving the immutable capture block;
- adjust a location non-destructively and soft-delete with undo;
- read a per-observation append-only revision history (what changed, when, and the previous state) —
  local application history, not cryptographic tamper-proofing;
- open a **spatial map** of a session (MapLibre GL) to see observations, assets, and the current
  position as points, tap a point to inspect it, and jump to the full observation detail — with an
  **online-only** basemap that degrades gracefully (records stay usable if tiles cannot load);
- export portable data or create a ZIP backup with media;
- surface storage durability and quota failures instead of reporting false success.

Test deployment: [https://soroushkarahrodi79-oss.github.io/fieldos/](https://soroushkarahrodi79-oss.github.io/fieldos/)

**FieldOS completed its first real 60–120 minute field run on 2026-08-31**, on a physical iPhone:
offline capture, tested close/reopen persistence, export, and backup all passed with no intended
data loss, and the owner reports they would rely on FieldOS in field use. This is one owner-attested
session on one platform — not broad field validation, and not a claim that Android has been
physically tested. See [docs/FIRST_FIELD_RUN.md](docs/FIRST_FIELD_RUN.md) for the full evidence
record and reopening conditions, and the validation table below for what each result does and does
not cover.

## Validation status

Evidence comes from three different sources that are **not interchangeable**: automated tests (run
on every commit), physical-device checklists (manual, owner-attested, no independent audit), and the
one real field run. "Tested once on iPhone" is not the same claim as "validated" or
"production-ready," and neither implies Android has been checked — no physical Android device has
been used with FieldOS yet, which is an untested evidence boundary, not a product failure.

| Capability | Evidence status |
| --- | --- |
| Data layer, capture immutability, serializers, backup (unit tests) | Automated, CI-verified on every commit |
| Offline launch, capture, persistence, export/backup — physical iPhone | Device-tested, owner-attested, 2026-08-21 ([DEVICE_TEST_RESULT.md](docs/DEVICE_TEST_RESULT.md)) |
| Same checklist — physical Android | **Pending.** Not yet run on a physical Android device. |
| First real field session (offline capture → export/backup, ~60–120 min) | Completed once, iPhone, 2026-08-31, owner-attested ([FIRST_FIELD_RUN.md](docs/FIRST_FIELD_RUN.md)) |
| Voice note — capture, save, playback — physical iPhone | Device-tested, owner-attested, 2026-08-31 |
| Voice note — permission denial, storage pressure, 3-minute cap, unsupported browser | Not yet exercised ([VOICE_NOTES_SMOKE_TEST.md](docs/VOICE_NOTES_SMOKE_TEST.md)) |
| Voice note — physical Android | Pending (same Android boundary as above) |
| Voice transcription | Not implemented — out of scope; voice notes stay as raw audio |
| Repeated or long-duration field campaigns | Not yet validated — one session only |
| GPS positional accuracy | Not independently measured — capture is functional and provenance is preserved, but accuracy figures were not recorded |

**Can claim:** FieldOS survived one real offline field session on one physical iPhone with no
reported data loss, and separately passed an iPhone device checklist and iPhone voice-note core
flow. **Cannot yet claim:** that FieldOS is validated, production-ready, field-proven, reliable
across conditions, or cross-platform verified — those all require more sessions and an independent
Android pass. See [MVP_BACKLOG.md](MVP_BACKLOG.md) for the next engineering state.

## Run locally

Requires Node.js 20 or newer.

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run typecheck
npm test
npm run build
```

The browser app uses IndexedDB. Clearing site data removes local FieldOS records, so create a full backup before clearing browser storage.

## Architecture

FieldOS deliberately has no backend in the MVP. React and TypeScript provide the UI and domain model, Dexie wraps IndexedDB, the Web Geolocation API captures location provenance, Workbox precaches the application shell, and `fflate` creates offline ZIP backups. The optional spatial map uses **MapLibre GL JS** (open-source, no API key) rendering derived map features over an **online-only** OpenStreetMap raster basemap — suitable for MVP/testing, not high-volume production, and **not** an offline-maps feature (PMTiles/offline tiles are deferred). The map is a read-only derived view; it consumes the existing canonical data, adds no persisted coordinates, and requires no schema or database migration. See [ARCHITECTURE_DECISION.md](ARCHITECTURE_DECISION.md) and [DATA_MODEL.md](DATA_MODEL.md).

## Privacy

Exports may contain observer names, precise coordinates, notes, photographs, and voice recordings. They should be handled as sensitive field evidence. Voice notes stay on this device until you export them; the microphone is accessed only after you press Record, and no audio is ever uploaded. FieldOS does not upload records automatically.

## License

Copyright 2026 Soroush Karahrodi. FieldOS source code and documentation are available under the
[Apache License 2.0](LICENSE).
