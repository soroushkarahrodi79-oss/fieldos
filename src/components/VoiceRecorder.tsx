import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioRecorder,
  AudioRecorderError,
  MAX_RECORDING_MS,
  isAudioRecordingSupported,
  type AudioRecording,
} from '../media/audioRecorder';

/**
 * Optional voice-note capture for the New Observation flow. Self-contained: it owns the recorder
 * lifecycle and UI state machine, and reports a finished (but not-yet-persisted) recording up to
 * the parent via `onChange`. The parent persists it as an audio MediaAttachment on Save.
 *
 * Recording never requires network. Microphone permission is requested only when the user presses
 * Record — never on mount. Microphone tracks are released on stop, remove, re-record, and unmount.
 */
export type RecorderUiState =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'processing'
  | 'ready'
  | 'error';

interface VoiceRecorderProps {
  /** The current pending recording, owned by the parent so it survives across re-renders. */
  value: AudioRecording | null;
  onChange: (recording: AudioRecording | null) => void;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const supported = isAudioRecordingSupported();

export function VoiceRecorder({ value, onChange }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderUiState>(value ? 'ready' : 'idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Manage the preview object URL for the pending blob; always revoke the previous one.
  useEffect(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (value) {
      const url = URL.createObjectURL(value.blob);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [value]);

  // Release the microphone and timer if the screen unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimer();
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, [clearTimer]);

  const finish = useCallback(
    async (recorder: AudioRecorder) => {
      setState('processing');
      clearTimer();
      try {
        const recording = await recorder.stop();
        recorderRef.current = null;
        onChange(recording);
        setState('ready');
      } catch (cause) {
        recorderRef.current = null;
        const message =
          cause instanceof AudioRecorderError
            ? cause.message
            : 'The recording could not be saved. Please try again.';
        setErrorMessage(message);
        setState('error');
      }
    },
    [clearTimer, onChange],
  );

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    setElapsedMs(0);
    setState('requesting_permission');
    const recorder = new AudioRecorder();
    try {
      await recorder.start();
    } catch (cause) {
      const message =
        cause instanceof AudioRecorderError
          ? cause.kind === 'permission_denied'
            ? 'Microphone access was denied. You can continue without a voice note.'
            : cause.message
          : 'Voice recording could not start on this device.';
      setErrorMessage(message);
      setState('error');
      return;
    }
    recorderRef.current = recorder;
    setState('recording');
    timerRef.current = setInterval(() => {
      const ms = recorder.elapsedMs();
      setElapsedMs(ms);
      if (ms >= MAX_RECORDING_MS) void finish(recorder);
    }, 250);
  }, [finish]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder) void finish(recorder);
  }, [finish]);

  const removeRecording = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    clearTimer();
    setElapsedMs(0);
    setErrorMessage(null);
    onChange(null);
    setState('idle');
  }, [clearTimer, onChange]);

  if (!supported) {
    return (
      <div className="voice-recorder" role="group" aria-label="Voice note">
        <p className="muted">
          Voice recording is not supported in this browser. You can still save the observation
          normally.
        </p>
      </div>
    );
  }

  return (
    <div className="voice-recorder" role="group" aria-label="Voice note">
      {(state === 'idle' || state === 'error') && !value && (
        <button type="button" className="secondary voice-record-btn" onClick={() => void startRecording()}>
          🎙 Record voice note
        </button>
      )}

      {state === 'requesting_permission' && (
        <p className="muted" role="status">
          Waiting for microphone permission…
        </p>
      )}

      {state === 'recording' && (
        <div className="voice-recording-active">
          <span className="recording-indicator" role="status">
            <span className="rec-dot" aria-hidden="true" /> Recording voice note ·{' '}
            {formatDuration(elapsedMs)}
          </span>
          <button type="button" className="secondary" onClick={stopRecording}>
            ■ Stop
          </button>
          <small className="muted">Stops automatically at {formatDuration(MAX_RECORDING_MS)}.</small>
        </div>
      )}

      {state === 'processing' && (
        <p className="muted" role="status">
          Finishing recording…
        </p>
      )}

      {value && (state === 'ready' || state === 'idle' || state === 'error') && previewUrl && (
        <div className="voice-preview">
          <span className="voice-preview-label">
            Voice note · {formatDuration(value.durationMs)}
          </span>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- field voice memo, no caption track */}
          <audio controls src={previewUrl} preload="metadata" />
          <div className="button-row">
            <button type="button" className="ghost" onClick={() => void startRecording()}>
              Record again
            </button>
            <button type="button" className="ghost danger-text" onClick={removeRecording}>
              Remove
            </button>
          </div>
        </div>
      )}

      {state === 'error' && errorMessage && (
        <p className="voice-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
