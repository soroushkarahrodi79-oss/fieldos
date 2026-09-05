# LinkedIn post — FieldOS first field run

**Publication status: READY TO PUBLISH**

## Canonical repository

https://github.com/soroushkarahrodi79-oss/fieldos

Live test deployment: https://soroushkarahrodi79-oss.github.io/fieldos/

## Post copy

I've been building FieldOS, an offline-first PWA for structured tourism field research: it turns a
field observation into timestamped, geolocated, traceable evidence — category, evidence method,
optional photo or voice note — saved locally, with no backend and no cloud dependency.

Working on it at my desk was never going to be the evidence I needed. A tool built for field
conditions has to prove itself in field conditions, so I took it outside for a real 60–120 minute
session, phone in airplane mode, and used it the way I actually intend to use it.

What survived: offline capture worked end to end. I closed and reopened the app mid-session and
every observation was still there. Exporting to JSON/CSV/GeoJSON and creating the full backup ZIP
both worked, and I'd trust the resulting records for later analysis.

What I'm not claiming: this was one session, on one physical iPhone. It is not evidence that FieldOS
is "validated," production-ready, or reliable across field conditions — and it says nothing about
Android, which I haven't been able to test on physical hardware yet. GPS accuracy wasn't measured
independently, and voice notes have only been checked for their core recording path, not their edge
cases.

The distinction I keep coming back to: a feature existing in the codebase is not the same thing as
evidence that it works in its intended environment. One field run moves FieldOS from "built" to
"field-tested once" — nothing more, and that's the honest claim.

Repo (code, docs, and the evidence records behind these claims) is linked below.

#FieldResearch #OpenSource #TourismResearch #GIS #ResearchSoftware

## Evidence boundary (what backs this post)

- First field run: `docs/FIRST_FIELD_RUN.md` — owner-attested, 2026-08-31, one iPhone session,
  offline capture / close-reopen persistence / export / backup all passed; exact counts and timing
  not recorded.
- Physical-device gate: `docs/DEVICE_TEST_RESULT.md` — iPhone only; Android explicitly pending.
- Voice notes: `docs/VOICE_NOTES_SMOKE_TEST.md` — iPhone core recording/save/playback only; edge
  cases, Android, and transcription (not implemented) are out of scope for this claim.
- Automated coverage: 127 Vitest tests, typecheck, and production build all green at the time of
  writing.

## Recommended visual

TEXT-ONLY RECOMMENDED.

No screenshot, photo, or evidence artifact from the actual field run exists in the repository (by
design — `docs/FIRST_FIELD_RUN.md` intentionally excludes exports, coordinates, and photos to avoid
leaking field-evidence metadata). The only visual assets in the repo are generic app icons
(`public/icons/*.svg`), which don't strengthen this specific story. Do not generate a decorative
image for this post.

## Suggested hashtags

`#FieldResearch #OpenSource #TourismResearch #GIS #ResearchSoftware`
