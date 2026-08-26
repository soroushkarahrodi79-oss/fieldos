import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_MIME_CANDIDATES,
  AudioRecorder,
  AudioRecorderError,
  pickAudioMimeType,
  type RecorderDeps,
} from './audioRecorder';

// ---------------------------------------------------------------------------
// MIME negotiation (pure)
// ---------------------------------------------------------------------------

describe('pickAudioMimeType', () => {
  it('prefers audio/mp4 (Safari/iOS) when everything is supported', () => {
    expect(pickAudioMimeType(() => true)).toBe('audio/mp4');
  });

  it('falls back to webm/opus when mp4 is unsupported', () => {
    const supported = (t: string) => t !== 'audio/mp4';
    expect(pickAudioMimeType(supported)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to plain audio/webm when opus variants are unsupported', () => {
    const supported = (t: string) => t === 'audio/webm';
    expect(pickAudioMimeType(supported)).toBe('audio/webm');
  });

  it('falls back to ogg/opus as the last explicit candidate', () => {
    const supported = (t: string) => t === 'audio/ogg;codecs=opus';
    expect(pickAudioMimeType(supported)).toBe('audio/ogg;codecs=opus');
  });

  it('returns null (let the recorder decide) when nothing is explicitly supported', () => {
    expect(pickAudioMimeType(() => false)).toBeNull();
  });

  it('only ever returns a member of the candidate list', () => {
    const picked = pickAudioMimeType(() => true);
    expect(AUDIO_MIME_CANDIDATES).toContain(picked as (typeof AUDIO_MIME_CANDIDATES)[number]);
  });
});

// ---------------------------------------------------------------------------
// Recorder lifecycle (mocked browser APIs)
// ---------------------------------------------------------------------------

class FakeTrack {
  stop = vi.fn();
}

class FakeStream {
  tracks = [new FakeTrack(), new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    // Emit a chunk then fire onstop, mimicking the browser.
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) });
    this.onstop?.();
  });
  constructor(_stream: unknown, options: { mimeType?: string }) {
    this.mimeType = options.mimeType ?? 'audio/webm';
  }
}

function makeDeps(overrides: Partial<RecorderDeps> = {}): {
  deps: RecorderDeps;
  stream: FakeStream;
  recorders: FakeRecorder[];
} {
  const stream = new FakeStream();
  const recorders: FakeRecorder[] = [];
  const deps: RecorderDeps = {
    getUserMedia: vi.fn(async () => stream as unknown as MediaStream),
    isTypeSupported: (t) => t === 'audio/webm;codecs=opus',
    createRecorder: (s, options) => {
      const rec = new FakeRecorder(s, options);
      recorders.push(rec);
      return rec as unknown as MediaRecorder;
    },
    ...overrides,
  };
  return { deps, stream, recorders };
}

describe('AudioRecorder lifecycle', () => {
  it('start → recording → stop produces a non-empty blob with the produced MIME type', async () => {
    const { deps, recorders } = makeDeps();
    const recorder = new AudioRecorder(deps);
    await recorder.start();
    expect(recorder.isRecording).toBe(true);
    expect(recorders[0]!.start).toHaveBeenCalled();

    const result = await recorder.stop();
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.mimeType).toBe('audio/webm;codecs=opus');
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(recorder.isRecording).toBe(false);
  });

  it('releases every microphone track on stop', async () => {
    const { deps, stream } = makeDeps();
    const recorder = new AudioRecorder(deps);
    await recorder.start();
    await recorder.stop();
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('releases microphone tracks on cancel without producing a recording', async () => {
    const { deps, stream } = makeDeps();
    const recorder = new AudioRecorder(deps);
    await recorder.start();
    recorder.cancel();
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
    expect(recorder.isRecording).toBe(false);
  });

  it('maps a permission denial to a permission_denied AudioRecorderError and releases nothing dangling', async () => {
    const denial = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const { deps } = makeDeps({ getUserMedia: vi.fn(async () => { throw denial; }) });
    const recorder = new AudioRecorder(deps);
    await expect(recorder.start()).rejects.toMatchObject({ kind: 'permission_denied' });
    expect(recorder.isRecording).toBe(false);
  });

  it('passes the negotiated MIME type to the recorder constructor', async () => {
    const { deps, recorders } = makeDeps();
    const recorder = new AudioRecorder(deps);
    await recorder.start();
    expect(recorders[0]!.mimeType).toBe('audio/webm;codecs=opus');
    recorder.cancel();
  });

  it('lets the recorder choose its default when no candidate is supported', async () => {
    const { deps, recorders } = makeDeps({ isTypeSupported: () => false });
    const recorder = new AudioRecorder(deps);
    await recorder.start();
    // No mimeType option was forced; the fake defaults to audio/webm.
    expect(recorders[0]!.mimeType).toBe('audio/webm');
    recorder.cancel();
  });

  it('rejects with no_audio when stopped before any chunk exists', async () => {
    const { deps } = makeDeps();
    const recorder = new AudioRecorder(deps);
    await recorder.start();
    // Replace stop so it fires onstop WITHOUT emitting any data.
    const fake = (recorder as unknown as { recorder: FakeRecorder }).recorder;
    fake.stop = vi.fn(() => {
      fake.state = 'inactive';
      fake.onstop?.();
    });
    await expect(recorder.stop()).rejects.toBeInstanceOf(AudioRecorderError);
  });

  it('rejects a second start on the same instance', async () => {
    const { deps } = makeDeps();
    const recorder = new AudioRecorder(deps);
    await recorder.start();
    await expect(recorder.start()).rejects.toMatchObject({ kind: 'start_failed' });
    recorder.cancel();
  });
});
