# FieldOS

FieldOS is an offline-first progressive web app for structured tourism field research and evidence collection. It keeps sessions, observations, GPS provenance, and photos on the device, then produces portable JSON, CSV, GeoJSON, and full-session ZIP backups without requiring a network connection.

## Current status

The repository contains the first usable MVP workflow:

- create, resume, inspect, and close local field sessions;
- capture category-specific observations with timestamps and honest GPS status;
- record observed, measured, or reported evidence;
- attach a photo and link a nearby known asset;
- review and edit interpretation while preserving the immutable capture block;
- adjust a location non-destructively and soft-delete with undo;
- export portable data or create a ZIP backup with media;
- surface storage durability and quota failures instead of reporting false success.

Physical iPhone and Android validation is still required before using FieldOS for a real field campaign. See [MVP_BACKLOG.md](MVP_BACKLOG.md) and [PRODUCT_CONTRACT.md](PRODUCT_CONTRACT.md) for the release gates and scope.

The exact physical-device procedure and evidence to record are in
[docs/DEVICE_SMOKE_TEST.md](docs/DEVICE_SMOKE_TEST.md).

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

Exports may contain observer names, precise coordinates, notes, and photographs. They should be handled as sensitive field evidence. FieldOS does not upload records automatically.

## Decisions still required

Before device testing can begin, the repository owner must choose an HTTPS deployment target. Before
making the repository an open-source project, the owner must also choose and add a license. Neither
decision is implied by the current code or repository visibility.

## License

No open-source license has been selected yet. Copyright remains with the repository owner until a license is added.
