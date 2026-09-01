import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PhotoSourcePicker, selectedPhoto } from './PhotoSourcePicker';

function inputTag(markup: string, testId: string): string {
  const tag = markup.match(new RegExp(`<input[^>]*data-testid="${testId}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`Missing ${testId}`);
  return tag;
}

describe('PhotoSourcePicker', () => {
  it('renders separate native camera and existing-photo inputs with the required attributes', () => {
    const markup = renderToStaticMarkup(createElement(PhotoSourcePicker, {
      value: null,
      onChange: vi.fn(),
      formatSize: () => '0 KB',
    }));

    const camera = inputTag(markup, 'camera-photo-input');
    expect(markup).toContain('Take photo');
    expect(camera).toContain('type="file"');
    expect(camera).toContain('accept="image/*"');
    expect(camera).toContain('capture="environment"');

    const library = inputTag(markup, 'library-photo-input');
    expect(markup).toContain('Choose photo');
    expect(library).toContain('type="file"');
    expect(library).toContain('accept="image/*"');
    expect(library).not.toContain('capture=');
  });

  it('stages a file selected from either photo source', () => {
    const cameraPhoto = new File(['camera'], 'camera.jpg', { type: 'image/jpeg' });
    const libraryPhoto = new File(['library'], 'library.png', { type: 'image/png' });

    expect(selectedPhoto(null, [cameraPhoto])).toBe(cameraPhoto);
    expect(selectedPhoto(null, [libraryPhoto])).toBe(libraryPhoto);
  });

  it('keeps the staged photo when a picker is cancelled', () => {
    const staged = new File(['existing'], 'existing.jpg', { type: 'image/jpeg' });

    expect(selectedPhoto(staged, [])).toBe(staged);
    expect(selectedPhoto(staged, null)).toBe(staged);
  });

  it('replaces the staged photo when another file is selected', () => {
    const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
    const replacement = new File(['replacement'], 'replacement.jpg', { type: 'image/jpeg' });

    expect(selectedPhoto(first, [replacement])).toBe(replacement);
  });

  it('shows the staged filename and formatted size', () => {
    const photo = new File(['content'], 'field evidence.jpg', { type: 'image/jpeg' });
    const markup = renderToStaticMarkup(createElement(PhotoSourcePicker, {
      value: photo,
      onChange: vi.fn(),
      formatSize: () => '2.4 MB',
    }));

    expect(markup).toContain('field evidence.jpg · 2.4 MB');
  });
});
