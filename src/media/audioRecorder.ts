// Offline voice-note capture for FieldOS.
//
// This module owns the browser media plumbing for a single voice recording: capability
// detection, microphone acquisition, deterministic MIME negotiation, MediaRecorder lifecycle,
// chunk collection, cleanup, and Blob production. The UI consumes the small API below and never
// touches getUserMedia / MediaRecorder directly.
//
// Constraints honoured here:
//  - Native platform first: navigator.mediaDevices.getUserMedia + MediaRecorder, no dependency.
//  - No network. Recording is entirely local; nothing is uploaded.
//  - Microphone tracks are ALWAYS released (stop, cancel, failure). No dangling live mic.
//  - The produced Blob's mimeType reflects what the browser actually encoded.

import type { IsoTimestamp } from '../domain/types';
import { nowIso } from '../domain/time';

/**
 * Ordered MIME candidates. Safari/iOS only reliably records `audio/mp4` (AAC), so it leads;
 * Chromium/Firefox fall through to Opus in WebM/OGG. The first supported type wins; if none is
 * explicitly supported we let MediaRecorder choose its own default rather than failing.
 */
export const AUDIO_MIME_CANDIDATES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const;

/** Defensive cap so a forgotten recording cannot exhaust IndexedDB / device storage. */
export const MAX_RECORDING_MS = 180_000; // 3 minutes

/** The result of a completed recording, ready to persist as an audio MediaAttachment. */
export interface AudioRecording {
  blob: Blob;
  mimeType: string;
  /** Wall-clock time the recording STARTED — used as the audio evidence `capturedAt`. */
  startedAt: IsoTimestamp;
  durationMs: number;
}

export type AudioRecorderErrorKind =
  | 'unsupported'
  | 'permission_denied'
  | 'no_audio'
  | 'start_failed'
  | 'stop_failed';

/** A recorder failure carrying a machine-readable kind so the UI can pick the right message. */
export class AudioRecorderError extends Error {
  readonly kind: AudioRecorderErrorKind;
  override readonly cause: unknown;
  constructor(kind: AudioRecorderErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'AudioRecorderError';
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * Pick the first explicitly-supported candidate MIME type, or `null` to mean
 * "let MediaRecorder decide". Pure and isolated so it can be unit-tested exhaustively.
 */
export function pickAudioMimeType(
  isTypeSupported: (type: string) => boolean = defaultIsTypeSupported,
): string | null {
  for (const candidate of AUDIO_MIME_CANDIDATES) {
    if (isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function defaultIsTypeSupported(type: string): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(type)
  );
}

/**
 * The browser capabilities the recorder needs. Injectable so the lifecycle can be unit-tested in
 * Node without a real DOM. Defaults bind to the live browser APIs.
 */
export interface RecorderDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  isTypeSupported(type: string): boolean;
  createRecorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder;
}

function defaultDeps(): RecorderDeps {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    isTypeSupported: defaultIsTypeSupported,
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
  };
}

/** True when this browser can record audio at all (both getUserMedia and MediaRecorder present). */
export function isAudioRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/**
 * Drives one voice recording from microphone acquisition to a finished Blob. A single instance
 * records once; create a fresh instance (or call {@link cancel} first) to record again.
 */
export class AudioRecorder {
  private readonly deps: RecorderDeps;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAtMs = 0;
  private startedAtIso: IsoTimestamp = '';
  private mimeType = '';
  private released = false;

  constructor(deps: RecorderDeps = defaultDeps()) {
    this.deps = deps;
  }

  /**
   * Request the microphone (this is the ONLY place permission is asked) and begin recording.
   * Throws {@link AudioRecorderError} with a specific `kind` on any failure, releasing the
   * microphone before rethrowing.
   */
  async start(): Promise<void> {
    if (this.recorder) throw new AudioRecorderError('start_failed', 'Recording already started.');

    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia({ audio: true });
    } catch (cause) {
      // NotAllowedError / SecurityError → the user (or policy) denied the mic.
      const name = cause instanceof Error ? cause.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        throw new AudioRecorderError('permission_denied', 'Microphone access was denied.', cause);
      }
      throw new AudioRecorderError('start_failed', 'The microphone could not be opened.', cause);
    }
    this.stream = stream;

    const picked = pickAudioMimeType(this.deps.isTypeSupported);
    const options: MediaRecorderOptions = picked ? { mimeType: picked } : {};
    let recorder: MediaRecorder;
    try {
      recorder = this.deps.createRecorder(stream, options);
    } catch (cause) {
      // Some engines reject a mimeType they claimed to support; retry with the default.
      try {
        recorder = this.deps.createRecorder(stream, {});
      } catch (secondCause) {
        this.releaseStream();
        throw new AudioRecorderError('start_failed', 'This browser could not start audio recording.', secondCause);
      }
    }

    this.recorder = recorder;
    this.chunks = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };

    try {
      recorder.start();
    } catch (cause) {
      this.releaseStream();
      this.recorder = null;
      throw new AudioRecorderError('start_failed', 'This browser could not start audio recording.', cause);
    }
    this.startedAtMs = Date.now();
    this.startedAtIso = nowIso();
    // Prefer the type the recorder actually adopted; fall back to what we picked.
    this.mimeType = recorder.mimeType || picked || '';
  }

  /** Milliseconds elapsed since recording started (0 before start / after release). */
  elapsedMs(): number {
    if (!this.startedAtMs || this.released) return 0;
    return Date.now() - this.startedAtMs;
  }

  get isRecording(): boolean {
    return this.recorder !== null && !this.released;
  }

  /**
   * Stop recording and resolve with the finished audio. Releases the microphone in every path.
   * Rejects with `kind: 'no_audio'` if no bytes were captured (e.g. stopped instantly).
   */
  stop(): Promise<AudioRecording> {
    return new Promise<AudioRecording>((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) {
        reject(new AudioRecorderError('stop_failed', 'No active recording to stop.'));
        return;
      }
      const durationMs = this.elapsedMs();
      recorder.onstop = () => {
        this.releaseStream();
        this.recorder = null;
        // The real produced type: recorder.mimeType if the browser set one, else our chosen type.
        const type = recorder.mimeType || this.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        if (blob.size === 0) {
          reject(new AudioRecorderError('no_audio', 'No audio was captured. Please try again.'));
          return;
        }
        resolve({ blob, mimeType: blob.type || type, startedAt: this.startedAtIso, durationMs });
      };
      try {
        recorder.stop();
      } catch (cause) {
        this.releaseStream();
        this.recorder = null;
        reject(new AudioRecorderError('stop_failed', 'Recording could not be finalised.', cause));
      }
    });
  }

  /** Abort without producing a recording. Safe to call multiple times; always releases the mic. */
  cancel(): void {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // The recorder may already be inactive; the microphone is released below regardless.
      }
    }
    this.recorder = null;
    this.chunks = [];
    this.releaseStream();
  }

  private releaseStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.released = true;
  }
}
