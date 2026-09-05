# P0-21 physical-device gate result

**Device scope: physical iPhone only.** [DEVICE_SMOKE_TEST.md](DEVICE_SMOKE_TEST.md) calls for both
an iPhone and an Android device; this attestation covers iPhone. No physical Android device has been
used to run this checklist, so Android remains **pending** — this is an untested evidence boundary,
not a reported failure.

| Field | Result |
| --- | --- |
| Status | **PASS (iPhone)** |
| Confirmed | 2026-08-21 |
| Device | Physical iPhone, installed PWA |
| Checklist | [DEVICE_SMOKE_TEST.md](DEVICE_SMOKE_TEST.md) |
| Confirmation source | Repository owner reported that all checklist items were checked and correct |
| Android | Pending — not yet tested on physical hardware |
| Release decision | Proceed to the first 1–2 hour field run (on the validated iPhone) |

The repository intentionally does not contain test exports, precise coordinates, photographs, or
device identifiers. Those artifacts can contain sensitive metadata and should be retained privately
by the test owner if needed for later audit.

This result closes the P0 physical-device gate based on the owner's attestation. Any later report of
data loss, false save success, provenance destruction, offline-launch failure, or unusable export
reopens the gate and is treated as a stop-ship defect.
