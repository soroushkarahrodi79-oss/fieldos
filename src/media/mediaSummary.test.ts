import { describe, expect, it } from 'vitest';
import { countMedia, summarizeMedia } from './mediaSummary';
import type { MediaAttachment } from '../domain/types';

const of = (...kinds: MediaAttachment['kind'][]) => kinds.map((kind) => ({ kind }));

describe('media summary (badge classification)', () => {
  it('counts attachments by their actual kind', () => {
    expect(countMedia(of('photo', 'audio', 'photo'))).toEqual({ photo: 2, audio: 1 });
  });

  it('labels a single photo as "Photo" and a single audio as "Voice"', () => {
    expect(summarizeMedia({ photo: 1, audio: 0 })).toBe('Photo');
    expect(summarizeMedia({ photo: 0, audio: 1 })).toBe('Voice');
  });

  it('does NOT mislabel a lone voice note as a photo (the bug this fixes)', () => {
    const summary = summarizeMedia(countMedia(of('audio')));
    expect(summary).toBe('Voice');
    expect(summary).not.toContain('Photo');
  });

  it('combines both kinds', () => {
    expect(summarizeMedia({ photo: 1, audio: 1 })).toBe('Photo · Voice');
  });

  it('pluralises counts above one', () => {
    expect(summarizeMedia({ photo: 2, audio: 3 })).toBe('2 Photos · 3 Voice notes');
  });

  it('returns an empty string when there is no media', () => {
    expect(summarizeMedia({ photo: 0, audio: 0 })).toBe('');
  });
});
