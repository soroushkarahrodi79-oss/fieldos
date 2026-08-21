# First FieldOS field run

Use the live installed PWA for one 60–120 minute observation campaign. The purpose is to validate
the complete capture-to-backup workflow under real movement, lighting, GPS, battery, and attention
constraints—not to collect a large research dataset.

Live app: [https://soroushkarahrodi79-oss.github.io/fieldos/](https://soroushkarahrodi79-oss.github.io/fieldos/)

## 1. Prepare before leaving

- [ ] Use the same physical phone that passed the device checklist.
- [ ] Confirm FieldOS is installed to the Home Screen/app launcher and opens standalone.
- [ ] Charge the phone above 60% and ensure at least 500 MB of free storage.
- [ ] Open FieldOS online once so the current app shell is cached.
- [ ] Create a session with a clear title, observer name, and purpose.
- [ ] Request persistent storage when the banner appears.
- [ ] Make one small preflight observation, close the app, enable airplane mode, reopen it, and
      confirm the observation is still present.
- [ ] Remove the preflight observation and use Undo, confirming both actions work.

Do not collect identifying photographs of people without an appropriate legal basis and consent.
Avoid notes that contain unnecessary personal data.

## 2. Run the campaign offline

Keep the phone in airplane mode for the full campaign. Aim for:

- 20–40 observations across at least five categories;
- at least two measured observations with explicit units;
- at least two reported observations with a source note;
- at least five photographs;
- at least two dropped assets, with observations linked to them;
- one interpretation edit after saving;
- one non-destructive location adjustment with a reason;
- one deliberate app close/reopen around the midpoint.

Record the start time, end time, and approximate capture duration for five representative
observations. Stop immediately and preserve the device state if FieldOS reports success but a record
is absent, if existing data disappears, or if the app cannot reopen offline.

## 3. Verify before reconnecting

- [ ] Reopen FieldOS while still offline.
- [ ] Count the intended observations and compare with the live session count.
- [ ] Open a sample of five records, including photos, edits, and adjusted locations.
- [ ] Confirm raw capture time/location remains visible and unchanged after edits.
- [ ] Close the session.

## 4. Back up and inspect

While still offline:

1. Create the **full session backup** first.
2. Create the three-file **data export**.
3. Transfer both outputs off the phone when connectivity is restored.
4. Open CSV in Excel/LibreOffice, GeoJSON in QGIS or another compliant viewer, JSON in a text
   editor, and the ZIP in an archive utility.
5. Confirm manifest counts, media files, UUIDs, timestamps, evidence, edit metadata, and location
   provenance.

Do not upload real field exports to the public repository.

## 5. Record the result

| Metric | Result |
| --- | --- |
| Planned observations | |
| Saved observations | |
| Located observations | |
| Photo observations | |
| Median representative capture time | |
| App close/reopen survival | PASS / FAIL |
| Phone restart survival | PASS / FAIL / NOT RUN |
| Full backup opened externally | PASS / FAIL |
| CSV opened | PASS / FAIL |
| GeoJSON opened | PASS / FAIL |
| Observer would rely on FieldOS | YES / NO |
| Overall result | PASS / FAIL |

The run passes only with zero intended data loss, no false save success, fully usable offline capture,
and externally readable export and backup files. Record usability problems even when they do not
block the run; those observations determine the next P1 priority.
