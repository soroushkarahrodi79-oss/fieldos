# FieldOS voice notes (P1-2) — physical-device smoke test

This checklist is the acceptance gate for the **P1-2 offline voice notes** feature. The automated
suite (`npm test`) covers MIME negotiation, recorder lifecycle, audio persistence, media badges,
and ZIP-backup audio coverage — but microphone hardware, iOS Safari media handling, and real
device storage **can only be validated on physical phones**. Run this on at least one physical
iPhone (Safari) and one physical Android (Chrome) before relying on voice capture in the field.

Desktop emulation does not count. Do not attach real recordings, coordinates, or observer names to
a public GitHub issue — use synthetic observations and say a few test words only.

## Test record

Complete one copy per device.

| Field | Result |
| --- | --- |
| Commit tested | |
| Date / tester | |
| Device model | |
| OS + browser version | |
| Installed mode | Home Screen / installed PWA |
| Recorded MIME type (from backup file extension) | `.m4a` (iOS) / `.webm` (Android) / … |
| Automated suite | PASS / FAIL |
| Overall device result | PASS / FAIL |

For every failure record the step, the exact visible message, whether the observation itself
still saved, and the smallest reliable reproduction.

## iPhone / Safari — core flow

1. Open the installed FieldOS PWA and resume or start a session.
2. Put the device in airplane mode (offline) — voice capture must work with no network.
3. Tap **New observation**, pick a category.
4. In the **Voice note** section tap **🎙 Record voice note**.
5. Grant microphone permission when Safari prompts. Permission must be requested **only now**,
   never on page load.
6. Confirm the **live timer** counts up and a recording indicator is visible (not colour-only).
7. Speak for 20–30 seconds, then tap **■ Stop**.
8. **Replay before saving** with the native audio player. Confirm audio is audible.
9. Tap **Record again**, record a shorter clip, stop — confirm the first clip was discarded.
10. Tap **Save observation**. Confirm the success message mentions the voice note.
11. Open the observation detail. Confirm a **Voice evidence** section with a working player.
12. Fully close and reopen the app (kill from app switcher). Replay the stored audio again — it
    must survive a restart.
13. Go to **Export & backup → Create full backup**. Save/share the ZIP.
14. Open the ZIP (Files app / desktop). Confirm `media/<obs>_<media>.m4a` exists and plays.

## iPhone / Safari — failure & edge cases

15. **Permission denied:** new observation → Record → *Deny* microphone. Confirm a clear
    "Microphone access was denied. You can continue without a voice note." message and that the
    observation still saves normally without audio.
16. **Cancel/navigation while recording:** start recording, then tap **← Cancel** (leave the
    screen). Confirm the microphone indicator in the OS status bar turns off (tracks released) and
    no partial audio was saved.
17. **Long recording:** record continuously and confirm it stops cleanly at the 3:00 cap without
    discarding the audio.
18. **Storage pressure:** with the device near full, save an observation with audio and confirm a
    quota failure is surfaced (not silently swallowed) while the observation itself is preserved.

## Android / Chrome — checks

Repeat steps 1–18. Expected recorded container is typically `audio/webm;codecs=opus`, so the
backup file should be `…​.webm` and play in the archive. Also verify:

- The session list badge shows **Voice** (or **Photo · Voice**), never mislabels audio as Photo.
- Backgrounding the app mid-recording does not leave the microphone live after returning.

## Unsupported-browser check (any device)

19. On a browser without `MediaRecorder`, confirm the Voice note section shows
    "Voice recording is not supported in this browser. You can still save the observation
    normally." and that photo/GPS/note capture and saving are unaffected.

---

**AUTOMATED PASS** — `npm run typecheck`, `npm test`, `npm run build` all green.

**PHYSICAL DEVICE VALIDATION: PENDING** — iPhone and Android runs of this checklist have not yet
been performed. Do not claim iPhone/Android validation until the tables above are filled in on
real hardware.
