# FieldOS physical-device release gate

This checklist is the acceptance gate for P0-21. Run it on at least one physical iPhone and one
physical Android phone before a real field campaign. Desktop emulation does not count.

Do not attach real exports, coordinates, photographs, observer names, or other sensitive field
evidence to a public GitHub issue. Use synthetic observations for this test.

## Test record

Complete one copy of this table for each device.

| Field | Result |
| --- | --- |
| Commit tested | `fe7bdbd` or newer |
| Date / tester | |
| Device model | |
| OS version | |
| Browser version | |
| Installed mode | Home Screen / installed PWA |
| Network conditions | online setup, then airplane mode |
| Overall result | PASS / FAIL |

For every failure, record the step, exact visible message, whether data remained present, and the
smallest reliable reproduction. Screenshots must use synthetic data.

## Prerequisite: HTTPS test build

- [ ] The exact commit under test is deployed at an HTTPS URL reachable by both phones.
- [ ] The app is installed from the browser to the Home Screen/app launcher.
- [ ] The installed app opens in standalone mode rather than as a normal browser tab.
- [ ] No production or personally identifying field data is loaded for this test.

Geolocation, camera capture, service workers, and installation should not be accepted based on an
HTTP LAN address. `localhost` exceptions apply only to the development computer.

## A. Offline application shell

1. Open the installed app online once and wait for the sessions screen.
2. Close it fully.
3. Enable airplane mode and confirm Wi-Fi is off.
4. Reopen the installed app.

- [ ] The FieldOS sessions screen opens without a network-error page.
- [ ] Creating, opening, and closing a session remains available.
- [ ] The app clearly indicates that local/offline operation is ready.

Failure of any item in this section blocks the field test.

## B. Local persistence and restart survival

1. In airplane mode, create a session named `SYNTHETIC DEVICE TEST`.
2. Create three observations in different categories.
3. Close the app, remove it from the recent-app switcher, and reopen it.
4. Restart the phone and reopen FieldOS.
5. Leave the installed app unused for at least one hour, then check again.

- [ ] The session remains present after app termination.
- [ ] All observations remain present after phone restart.
- [ ] Timestamps, category values, evidence methods, and notes are unchanged.
- [ ] A failed write, if encountered, produces a visible error and never reports success.

Any missing or altered record blocks the field test.

## C. GPS behavior and provenance

Run the following cases with synthetic observations:

- [ ] Permission granted: latitude, longitude, and accuracy are shown and saved.
- [ ] Permission denied: the app says GPS is denied and still permits saving.
- [ ] Location unavailable or timed out: the app saves without fabricated coordinates.
- [ ] Re-fix: requesting a new fix updates the capture-screen location before saving.
- [ ] Manual adjustment: the detail screen stores the adjustment separately.
- [ ] Export inspection confirms the original captured location was not overwritten.

Record approximate time-to-fix and typical accuracy for each device.

## D. Capture speed and field ergonomics

Create ten synthetic observations while walking outdoors or simulating realistic one-handed use.
Include observed, measured, and reported evidence; at least one `other` observation; and at least
one observation linked to a dropped asset.

- [ ] Median time from opening capture to saved observation is under 20 seconds without a photo.
- [ ] All required controls have comfortable touch targets and remain readable in bright light.
- [ ] The keyboard does not hide the Save action permanently.
- [ ] Saving always returns to the session with the newest observation first.
- [ ] Nearby assets appear nearest-first with a distance when a GPS fix exists.

## E. Photos and storage pressure

1. Capture a photo from the native camera flow.
2. Choose an existing photo if the operating system offers that route.
3. Cancel photo selection once and save the observation without media.
4. Create at least 20 photo observations or enough to exercise meaningful storage use.

- [ ] Photo capture returns to FieldOS and the image appears on observation detail.
- [ ] Cancelling or failing photo capture never blocks saving the structured observation.
- [ ] The storage warning remains understandable and offers a persistence request.
- [ ] Storage/quota failure is visible and does not claim that missing data was saved.

Record approximate storage usage and the largest successful session backup size.

## F. Review, correction, deletion, and undo

- [ ] Editing category/value/evidence/note increments the edit count.
- [ ] Original capture time and raw GPS remain read-only after interpretation edits.
- [ ] A location adjustment shows both the effective adjustment and preserved raw capture.
- [ ] Removing an observation hides it from the live list.
- [ ] Undo restores the removed observation.
- [ ] A closed session remains readable and exportable but cannot accept new observations.

## G. Export and full backup

Perform this section while still in airplane mode.

- [ ] Data export produces `observations.json`, `observations.csv`, and `observations.geojson`.
- [ ] Full backup produces one ZIP with `manifest.json`, the three data files, and all media.
- [ ] The ZIP manifest counts match the session and included media.
- [ ] CSV opens correctly in Excel/LibreOffice without broken rows or columns.
- [ ] GeoJSON opens in QGIS or another standards-compliant GeoJSON viewer.
- [ ] JSON preserves UUIDs, timestamps, evidence, edit metadata, and location provenance.
- [ ] Deleted observations remain recoverable in the full backup.
- [ ] If ZIP creation fails, the data-export fallback remains usable.

Transfer the files to a computer for inspection. Keep synthetic test exports out of the repository
unless they have been reviewed for metadata and location leakage.

## H. Real campaign dry run

After both device smoke tests pass, run one 1–2 hour synthetic or non-sensitive outdoor dry run.

- [ ] The observer does not revert to a notes app or camera roll because FieldOS is too slow.
- [ ] Zero intended observations are missing at the end.
- [ ] At least 90% of intended located observations have coordinates and recorded accuracy.
- [ ] A data export and full backup are successfully transferred off the device.
- [ ] The observer would trust the resulting records for later analysis.

## Release decision

FieldOS may proceed to its first real field test only when both phones pass sections A–G and the dry
run passes section H. A failure involving data loss, false save success, provenance destruction,
offline launch, or unusable export is a stop-ship defect.
