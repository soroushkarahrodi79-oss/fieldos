# FieldOS — Product Contract (v0)

> Phase 0 document. This is a contract, not marketing copy. If a later decision
> contradicts this file, this file must be changed deliberately, not ignored.

## 1. Problem

Tourism field observation today is fragmented across the camera roll, a notes app,
a voice memo, a spreadsheet filled in that evening, a separate GPS app, and human
memory. The consequence is not "messy files" — it is **loss of evidence**:

- The link between *what was seen*, *where*, and *when* is broken and later reconstructed from memory.
- Observations are not comparable across sites, days, or observers (everyone free-texts differently).
- Provenance is lost: nobody can later tell whether a value was directly seen, measured, or assumed.
- Data is silently lost (a phone dies, a note is never transcribed, a photo is never labelled).

The cost is highest exactly where the work matters: outdoors, offline, one-handed, in a hurry.

## 2. Target user

**Primary (MVP):** an individual field researcher / student / destination-management
practitioner walking a site (trail, viewpoint, car park, visitor centre, public space)
and recording repeated structured observations over a 1–2 hour campaign.

Assumptions about this user:
- Uses a mid-range **smartphone**, often outdoors in sun, sometimes with gloves.
- Has **intermittent or no connectivity**.
- Is time-pressured and motivated to keep moving, not to fill long forms.
- Cares about **traceability** — the data must survive scrutiny later.
- Is technically ordinary. Will not sideload, will not configure a server.

**Explicitly NOT the MVP user:** teams collaborating live, managers viewing dashboards,
the public, or an automated pipeline. Those are downstream consumers of exported data.

## 3. Job to be done

> "When I see something worth recording in the field, help me capture it as
> structured, located, time-stamped, traceable evidence in a few seconds —
> without a signal — so that later I can trust it, compare it, and export it."

Two sub-jobs, both first-class:
- **Capture** (in the field, fast, offline, low-friction).
- **Preserve & export** (get the data out intact, in a portable format, before it can be lost).

## 4. Core workflow

```
Open app (offline OK)
  → resume or create a Field Session
  → (optionally) pick or drop a named Asset/point
  → New Observation
      • timestamp captured automatically
      • coordinates + GPS accuracy captured automatically
      • pick a category (controlled list)
      • pick the category-specific value (no universal scale) and/or free text
      • set evidence method (default OBSERVED)
      • optionally attach a photo / note (voice later)
  → Save — persisted locally, immediately, even with no signal
  → repeat rapidly
  → later: Export (json/csv/geojson) and/or Full session backup (ZIP with media)
```

The single most important sentence: **Save must never depend on the network, and
saved data must never silently disappear.**

## 5. MVP scope (in)

- Field Sessions: create, name, resume, close; local only.
- Observations: fast capture with automatic timestamp + geolocation + accuracy.
- A **small** controlled vocabulary of observation categories, each with its **own category-specific
  value set** (no universal ordinal scale, no numeric score, no composite index) + free text.
- Evidence method per observation (OBSERVED / MEASURED / REPORTED — see DATA_MODEL.md §evidence).
- Location provenance: raw device fix (`capturedLocation`) preserved immutably; manual adjustment
  is non-destructive (`locationAdjustment`); `effectiveLocation` is derived.
- One photo per observation via native capture (`<input capture>`); notes as text.
- Fully offline persistence in IndexedDB; edit unsynced records without destroying original capture.
- Geospatial context without a map: GPS capture, known asset coordinates, distance to nearby assets,
  selection from nearby/recent assets.
- **Data export** (`observations.json` + `.csv` + `.geojson`) **and a separate full-session ZIP
  backup** (manifest + the three files + media), both generated on-device.
- Storage-durability safeguards (request persistent storage; report storage health; explicit
  backup nudges; every write handles failure explicitly).

## 6. Non-goals (out — see brief §8, upheld)

Accounts/auth, multi-user, cloud sync, SaaS backend, dashboards, ML / auto-classification,
recommendation, GIS analytics, remote sensing / Sentinel-2 / Earth Engine, SNTO / HATI
integration, creator/business features, gamification, social, role management, payments,
arbitrary scoring, fabricated AI confidence scores.

**Additionally moved out of MVP after review (challenges to the brief):**
- **Interactive slippy basemap with tiles** → P1. Offline tile caching is a real trap on
  iOS and adds large complexity for little field value; coordinate capture does not need a
  basemap. MVP is **list-first**. (See UX_FLOW.md and the critical review.)
- **Voice-to-structured AI** → explicitly a *later module*, never MVP evidence.
- **Full event-sourced audit log** → P1; MVP uses immutable-capture + lightweight edit tracking.
- **`DERIVED` and `MISSING` evidence methods** → not exposed in P0; nothing derives data in v0
  and "missing" is the absence of a value, not an evidence type (see DATA_MODEL.md).
- **Polygon asset geometry** → P1; MVP assets are points only.

## 7. Success criteria for the first field test

A single observer completes a real 1–2 hour campaign and, afterwards, **all of these hold**:

1. **Zero data loss.** Every observation intended to be saved is present after the session,
   including across app backgrounding and a phone restart.
2. **Offline throughout.** The whole session is completed in airplane mode / no signal, with
   no blocked action and no error that requires connectivity.
3. **Speed.** Median time from "New Observation" to "Saved" is **under ~20 seconds** for a
   category+value+location observation (photo optional).
4. **Located.** ≥90% of observations carry a coordinate with recorded accuracy; the observer
   could correct a bad fix without destroying the original.
5. **Traceable export + backup.** The exported GeoJSON/CSV opens correctly in QGIS / Excel / a text
   editor and each record clearly answers *who-ish, where, when, how (evidence method), edited?*; and
   a full-session ZIP backup (canonical JSON + media) is produced and openable.
6. **Trust.** The observer reports they would rely on this data instead of their old
   photos-plus-memory method.

## 8. Failure conditions (any one = do not ship / stop and fix)

- Data captured offline is lost after backgrounding or restart, **or** a write silently fails while
  reporting success (storage/quota failure must be surfaced, never swallowed).
- A save silently fails or blocks on network.
- Geolocation cannot be captured, or a corrected location overwrites and destroys the raw fix.
- Export/backup produces a file that cannot be opened outside FieldOS or that drops provenance fields,
  or a full backup omits media that exists.
- Capture is so slow/fiddly that the observer abandons it and reverts to the camera roll.
- Evidence method / free observation cannot be distinguished from measured/reported values.

## 9. Assumptions requiring validation

| # | Assumption | Why it's risky | How to validate |
|---|-----------|----------------|-----------------|
| A1 | Browser IndexedDB durably holds a field session's data on the target phones (esp. iOS). | Durability is **not guaranteed**: `storage.persist()` is browser-controlled, quota failures and storage pressure and user deletion remain possible. (Note: an **installed Home Screen Web App is exempt from WebKit's ITP 7-day cap** — the earlier "loses data after ~7 days idle" claim was wrong and is corrected.) | Real-device validation on a physical iPhone: capture → background → restart → re-open later; call `storage.persist()`/`persisted()`/`estimate()`; confirm data survives and that every write handles failure explicitly. |
| A2 | The category-specific value sets + free text are expressive enough for real observations. | A category's value set may be too coarse or miss a case. | First field test with real observers; count how often free text carries the real signal / a value felt missing. |
| A3 | Native `<input capture>` photo flow is reliable and fast enough on iOS/Android PWAs. | getUserMedia in standalone PWA is historically flaky. | Capture 20+ photos in the field on both platforms. |
| A4 | List-first (no basemap) is acceptable to field users. | They may strongly expect a map. | Ask testers directly; see if they get lost without one. |
| A5 | Device clock/GPS are trustworthy enough offline. | Clock drift / poor fix outdoors. | Record accuracy + timestamps; spot-check against known points. |
| A6 | A 1–2 hour session volume fits comfortably in quota (with photos). | iOS quotas are lower; photos are large. | Measure bytes/observation; test a full session with photos. |
| A7 | Users will export before data is at risk. | People forget. | Observe whether testers export unprompted; tune nudges. |

Storage durability is treated as a **validation requirement** (prove it on real devices), not as a
presumed failure mechanism. If real-device testing shows data cannot be durably retained and cannot
be mitigated (persistent-storage + reliable backup), **the offline-first PWA thesis is in question**
and a different persistence strategy (or a thin native shell) must be reconsidered before scaling.
