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
- export portable data or create a ZIP backup with media;
- surface storage durability and quota failures instead of reporting false success.

Test deployment: [https://soroushkarahrodi79-oss.github.io/fieldos/](https://soroushkarahrodi79-oss.github.io/fieldos/)

The P0 physical-device gate (iPhone and Android) is recorded as **passed** on 2026-08-21, based on
the repository owner's attestation against the checklist in
[docs/DEVICE_SMOKE_TEST.md](docs/DEVICE_SMOKE_TEST.md) — see
[docs/DEVICE_TEST_RESULT.md](docs/DEVICE_TEST_RESULT.md) for the recorded result and reopening
conditions. **FIRST FIELD RUN: PASS — owner-attested, 2026-08-31.** The real 60–120 minute workflow
completed offline with no intended data loss; tested close/reopen persistence, exports, and backup
checks passed, and the owner reports they would rely on FieldOS in field use. Exact counts and
timings were not recorded. See [docs/FIRST_FIELD_RUN.md](docs/FIRST_FIELD_RUN.md) for the evidence
record and [MVP_BACKLOG.md](MVP_BACKLOG.md) for the next engineering state.

The core physical iPhone voice-recording path is also **PASS — owner-attested, 2026-08-31**. This
does not close the separate voice edge-case or Android checks; those remain pending in
[docs/VOICE_NOTES_SMOKE_TEST.md](docs/VOICE_NOTES_SMOKE_TEST.md).

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

FieldOS deliberately has no backend in the MVP. React and TypeScript provide the UI and domain model, Dexie wraps IndexedDB, the Web Geolocation API captures location provenance, Workbox precaches the application shell, and `fflate` creates offline ZIP backups. See [ARCHITECTURE_DECISION.md](ARCHITECTURE_DECISION.md) and [DATA_MODEL.md](DATA_MODEL.md).

## Privacy

Exports may contain observer names, precise coordinates, notes, photographs, and voice recordings. They should be handled as sensitive field evidence. Voice notes stay on this device until you export them; the microphone is accessed only after you press Record, and no audio is ever uploaded. FieldOS does not upload records automatically.

## License

Copyright 2026 Soroush Karahrodi. FieldOS source code and documentation are available under the
[Apache License 2.0](LICENSE).
