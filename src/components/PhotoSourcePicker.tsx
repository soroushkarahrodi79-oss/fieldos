import type { ChangeEvent } from 'react';

interface PhotoSourcePickerProps {
  value: File | null;
  onChange: (photo: File) => void;
  formatSize: (bytes: number) => string;
}

/** Keep the staged photo when a native picker is cancelled (files is empty). */
export function selectedPhoto(current: File | null, files: ArrayLike<File> | null | undefined): File | null {
  return files?.[0] ?? current;
}

export function PhotoSourcePicker({ value, onChange, formatSize }: PhotoSourcePickerProps) {
  const stageSelectedPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const next = selectedPhoto(value, event.currentTarget.files);
    if (next !== null && next !== value) onChange(next);
  };

  return <div className="photo-source" role="group" aria-labelledby="photo-source-label">
    <span className="field-label" id="photo-source-label">Photo <span className="field-hint">optional</span></span>
    <div className="photo-source-actions">
      <label className="photo-source-button">
        <input data-testid="camera-photo-input" type="file" accept="image/*" capture="environment" onChange={stageSelectedPhoto} />
        <span>Take photo</span>
      </label>
      <label className="photo-source-button">
        <input data-testid="library-photo-input" type="file" accept="image/*" onChange={stageSelectedPhoto} />
        <span>Choose photo</span>
      </label>
    </div>
    {value && <small className="photo-selection" aria-live="polite">{value.name} · {formatSize(value.size)}</small>}
  </div>;
}
