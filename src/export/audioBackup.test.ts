import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { makeTestRepos } from '../test/helpers';
import { buildSessionBackup } from './backup';
import { extensionForMime, backupFilenameFor } from './types';
import type { CapturedLocation, MediaAttachment } from '../domain/types';

const fix = (): CapturedLocation => ({
  latitude: 47.37, longitude: 8.54, accuracyMeters: 5, altitudeMeters: null,
  altitudeAccuracyMeters: null, headingDegrees: null, speedMetersPerSecond: null,
  locationStatus: 'CAPTURED', capturedAt: '2026-08-21T09:00:00.000+02:00',
});

describe('extensionForMime — audio containers', () => {
  it('maps the recorder MIME types FieldOS can produce', () => {
    expect(extensionForMime('audio/mp4')).toBe('m4a');
    expect(extensionForMime('audio/webm')).toBe('webm');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('audio/ogg')).toBe('ogg');
  });

  it('normalises codec parameters (Safari/Chromium report these)', () => {
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionForMime('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
  });

  it('backup path for an audio blob carries the audio extension, not .bin', () => {
    const media = {
      id: 'mmmm', observationId: 'oooo', mimeType: 'audio/webm;codecs=opus',
    } as unknown as MediaAttachment;
    expect(backupFilenameFor(media)).toBe('media/oooo_mmmm.webm');
  });
});

describe('audio media through the ZIP backup', () => {
  it('persists an audio Blob with kind/mime/byteSize and preserves its bytes in the archive', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    const o = await repos.createObservation({
      sessionId: s.id,
      capturedLocation: fix(),
      observation: { category: 'other', value: null },
      evidence: { method: 'OBSERVED' },
    });

    const audioBytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const media = await repos.addMedia({
      observationId: o.id,
      kind: 'audio',
      blob: new Blob([audioBytes], { type: 'audio/webm;codecs=opus' }),
      mimeType: 'audio/webm;codecs=opus',
      capturedAt: '2026-08-21T09:10:00.000+02:00',
      originalFilename: 'voice-note.webm',
    });
    expect(media.kind).toBe('audio');
    expect(media.byteSize).toBe(audioBytes.byteLength);
    expect(media.capturedAt).toBe('2026-08-21T09:10:00.000+02:00');

    const backup = await buildSessionBackup(repos, s.id);
    expect(backup.manifest.mediaCount).toBe(1);

    const files = unzipSync(backup.zipBytes);
    const audioName = Object.keys(files).find((n) => n.startsWith('media/') && n.endsWith('.webm'));
    expect(audioName).toBeDefined();
    expect(Array.from(files[audioName!]!)).toEqual(Array.from(audioBytes));

    // The canonical JSON records the audio metadata with the correct backup path + kind.
    const meta = JSON.parse(new TextDecoder().decode(files['observations.json']!));
    const audioMeta = meta.media.find((m: { kind: string }) => m.kind === 'audio');
    expect(audioMeta.backupFilename).toBe(audioName);
    expect(audioMeta.mimeType).toBe('audio/webm;codecs=opus');
  });
});
