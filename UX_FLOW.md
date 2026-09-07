# FieldOS — UX Flow (v0)

> Designed for a sweaty thumb in bright sun with no signal — not for a desktop demo.
> Every screen below states: purpose · primary action · info shown · navigation ·
> offline behavior · empty state · failure state.

## Design constraints (apply to every screen)

- **One-handed, thumb-reachable.** Primary action is a large button in the bottom third.
- **Minimum typing.** Prefer taps on controlled values; free text is always optional.
- **Large touch targets** (≥48px), high-contrast, works in sunlight; supports large system fonts.
- **Offline is the default state, not an error.** Never show a blocking "no connection" screen.
- **Save is instant and local.** No spinner should ever block a save on the network.
- **Destructive actions are hard to hit** (soft-delete, confirm, undo).
- **Persistent visible session context** so the observer always knows what they're recording into.

## Surface map (challenged from the brief's 5)

The brief proposed: Field Sessions · Map/Assets · New Observation · Observation detail · Export.
**Historical P0** demoted the interactive basemap (offline tiles = iOS trap, low field value)
to P1 and made surface 2 **list-first**. P1-1 later added a read-only MapLibre map with an
online-only basemap; the list remains the durable primary workflow.

1. **Field Sessions** (home)
2. **Session** = Observation list + Assets, with an optional read-only Map view
3. **New Observation** (capture)
4. **Observation detail / edit**
5. **Export**

Plus a persistent **Storage/durability banner** (not a screen) when data is at risk.

---

## 1. Field Sessions (home)

- **Purpose:** land here on open; resume the current campaign in one tap or start a new one.
- **Primary action:** ▶ **Resume active session** (if one exists) — full-width bottom button.
  Secondary: **＋ New session**.
- **Info shown:** list of sessions (title, date, observation count, status active/closed),
  active session pinned on top.
- **Navigation:** tap a session → Session screen. New session → quick create (title required,
  observerName/purpose optional) → Session screen. The create form shows the **protocol** bound to
  the session (e.g. "Protocol · Tourism Field Observation Core · v1") with a one-line note that it
  defines the session's categories/values and is fixed for the session's life. With a single built-in
  protocol the flow stays one-tap; the form becomes a selector only if more protocols exist.
- **Offline:** fully functional; sessions are local. No network needed to create or open.
- **Empty state:** friendly "No sessions yet. Start your first field session." + big ＋ button;
  one line explaining data stays on this device until you export.
- **Failure state:** if local storage can't be read → clear error "Can't open local data on this
  device" + link to durability help; never a blank screen. If storage isn't persistent, show the
  durability banner (below).

## 2. Session (observation list + assets)

- **Purpose:** the field cockpit — see what's been recorded and add more, fast.
- **Primary action:** huge **＋ New Observation** FAB/bar, always visible, thumb-reachable.
- **Info shown:** reverse-chronological list of observations (category icon, category-specific value,
  time, 📍 accuracy, 📷 if media, ✎ if edited). Header shows session title + running count.
  A collapsible **Assets** section lists points with distance-from-here when coordinates exist;
  "＋ Drop asset here" uses current GPS.
- **Navigation:** tap observation → detail. Menu → Export, Close session, Edit session.
- **Offline:** everything works offline. GPS may be used when dropping an asset.
- **Empty state:** "No observations yet — tap ＋ to record your first." Nudge to capture, not configure.
- **Failure state:** if the list query fails, show cached count + retry; never lose the ＋ button.

## 3. New Observation (capture) — the critical screen

- **Purpose:** turn a real-world thing into a structured, located, timestamped record in seconds.
- **Primary action:** **Save** (large, bottom, always enabled once a category is chosen).
- **Info shown / flow (top to bottom, all on one scrollable screen — no wizard):**
  1. **Auto-captured, read-only chips at top:** ⏱ timestamp (now) · 📍 lat/lon + `±Xm` accuracy,
     acquired automatically on screen open. A subtle "↻ re-fix" and "adjust 📍" control.
  2. **Category** — a grid of large tap targets (single-select). This is the one required choice.
     The categories, their labels, and an optional short description come from the **session's
     protocol** (not a hard-coded list), so a session bound to a different protocol shows that
     protocol's categories.
  3. **Value** — a single row of the **category-specific** controlled values (from the protocol) that
     appears *after* a category is picked (e.g. Tourism Core path_condition → GOOD · FAIR · POOR ·
     BLOCKED; parking_pressure → LOW · MODERATE · HIGH · FULL). There is **no universal scale**. A
     valueless category (e.g. `other`) shows no value row; a protocol category may also require a note.
  4. **Evidence** — default **OBSERVED**; a compact toggle to MEASURED (reveals value+unit+context)
     or REPORTED (reveals optional source note).
  5. **Note** — optional free text (voice-to-text is the OS keyboard's job; FieldOS does not
     transcribe).
  6. **Photo** — separate native **Take photo** and **Choose photo** actions stage one optional
     photo; neither blocks save.
  7. **Voice note** — one optional raw offline recording; recording is user-initiated and never
     blocks saving the structured observation. See the validation boundary in
     `docs/VOICE_NOTES_SMOKE_TEST.md`.
- **Navigation:** Save → returns to Session list with the new item on top (and a brief undo/confirm).
  Back/cancel → confirm discard only if something was entered.
- **Offline:** the entire screen is offline-native. GPS is the only device dependency and it works offline.
- **Geospatial context:** capture remains list-first and may show **distance to the nearest known
  assets** and offer **selection from nearby/recent assets** to attach `assetId`, using asset
  coordinates + a haversine calculation. The separate P1-1 map is read-only and derived; its
  online-only tiles are not required for capture or record access.
- **Empty state:** n/a (creation screen) — but sensible defaults mean a valid observation is one tap
  (pick category) + Save (for `other`, a note).
- **Failure states (explicit, because this is where field reality bites):**
  - **GPS denied/timeout/unavailable** → show the reason, set `locationStatus`, let the observer
    **save anyway** (no fabricated coordinate) and optionally add location later. Never block.
  - **Slow fix** → save with whatever accuracy is available; show `±Xm` honestly; allow re-fix.
  - **Photo capture fails/cancelled** → observation still saves without media.
  - **Save error (quota/storage)** → loud, non-dismissable error + guidance to export/free space;
    do **not** pretend it saved.

## 4. Observation detail / edit

- **Purpose:** review one record, correct interpretation, adjust location non-destructively, add media.
- **Primary action:** context-dependent — **Edit** interpretation, or **Done**.
- **Info shown:** all fields; **raw captured location and time shown as immutable**; if edited,
  show "edited ✎ ×N, last {updatedAt}". Photo(s) shown full-width. Category/value labels (and the
  edit form's category/value choices and the revision-history diff) resolve through the session's
  protocol; a legacy (no-snapshot) session is labelled honestly as using the legacy FieldOS
  vocabulary rather than a bound protocol.
- **Navigation:** back to list; menu → soft-delete (with confirm + undo), export just this record (P1).
- **Offline:** full edit offline. Editing interpretation fields bumps `editCount`; capture block stays frozen.
- **Empty state:** n/a.
- **Failure state:** if the record can't load, show its id + "couldn't open this record" + back;
  never silently show a blank/wrong record. Location adjustment writes a new manual fix — never
  overwrites the raw one (and says so in the UI).

## 5. Export & Backup

Two clearly separated outputs (see DATA_MODEL.md §Export vs Backup):

- **Purpose:** get the data off the device, intact and portable, before anything can be lost.
- **Primary actions:**
  - **Data export** → `observations.json` + `observations.csv` + `observations.geojson`
    (analysis / interoperability; **does not embed media**).
  - **Full session backup** → a single **ZIP** (`manifest.json` + the three files + `media/*`) —
    the complete, restorable-in-principle package. This is the true durability backstop when media exists.
- **Info shown:** session summary (observation count, media count, date range, size incl. media),
  a clear label that data export is not a full backup, and a plain warning that these files may
  contain **precise locations and photos of real places/people**.
- **Navigation:** triggers the OS share/download sheet; returns to Session.
- **Offline:** **fully offline** — files/ZIP are generated on-device and saved/shared via the OS.
  No upload, no server.
- **Empty state:** if the session has no observations, disable both with "Nothing to export yet."
- **Failure state:** if generation fails (memory/quota with large media) → tell the user which part
  failed, and offer **data export without media** as a fallback so the structured data still gets out;
  never report success on a failed write.

---

## 6. Restore backup

- **Entry:** a secondary **Restore backup** action on Field Sessions, subordinate to New session.
- **Flow:** choose a FieldOS ZIP or canonical `observations.json` → inspect and validate → preview
  counts, schema/app version, full/data-only status, integrity status, warnings, and collisions →
  explicitly confirm → one atomic local write → open the reconstructed session.
- **Safety:** no write follows file selection. Existing IDs block restore; FieldOS never overwrites,
  merges, regenerates, or remaps imported evidence identities.
- **Media:** full ZIP restores metadata and original blob bytes. JSON-only restore says how many
  attachments are unavailable and never fabricates attachment rows/blobs.
- **Integrity wording:** `VERIFIED` means SHA-256 payload bytes matched the archive manifest only.
  Pre-integrity archives can be restored as `LEGACY_UNVERIFIED`; neither state means signed,
  authenticated, tamper-proof, or legal chain-of-custody evidence.

---

## Cross-screen: durability banner (not a screen, always-available safety net)

- Appears when `navigator.storage.persisted()` is **false** (persistent storage not granted), or
  when unbacked-up observations exceed a threshold / a session is > N hours old and unbacked-up.
- Copy is plain and non-alarmist: "Your data lives only on this device. Persistent storage isn't
  guaranteed — back up to keep it safe." with a **Full backup** shortcut.
- This targets the biggest MVP risk (device-only durability — durability is not guaranteed and must
  be validated on real devices; see critical review and PRODUCT_CONTRACT A1).

## What we deliberately do NOT build in the UX (anti-friction, anti-scope-creep)

- No multi-step wizard for a single observation (kills speed).
- No login, no onboarding tour, no settings maze.
- No offline basemap or tile pack (coordinate capture does not need one; offline tiles remain deferred).
- No required free-text anywhere.
- No per-observation "confidence %" or score (would be fake precision).
