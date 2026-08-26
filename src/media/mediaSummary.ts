// Human-readable summary of an observation's attached media, by kind.
//
// Fixes the earlier limitation where any attachment was labelled "Photo" regardless of type.
// Media type is derived from the actual stored `kind`, never inferred from a total count.

import type { MediaAttachment, MediaKind } from '../domain/types';

export interface MediaCounts {
  photo: number;
  audio: number;
}

/** Tally attachments by kind. Unknown/future kinds are ignored for the summary. */
export function countMedia(media: Pick<MediaAttachment, 'kind'>[]): MediaCounts {
  const counts: MediaCounts = { photo: 0, audio: 0 };
  for (const item of media) {
    if (item.kind === 'photo') counts.photo += 1;
    else if (item.kind === 'audio') counts.audio += 1;
  }
  return counts;
}

const singular: Record<MediaKind, string> = { photo: 'Photo', audio: 'Voice' };
const plural: Record<MediaKind, string> = { photo: 'Photos', audio: 'Voice notes' };

/**
 * Compact accessible label for a media tally, e.g. "Photo", "Voice", "Photo · Voice",
 * "2 Photos · Voice". Returns '' when there is no media. Text-only (no emoji-only meaning).
 */
export function summarizeMedia(counts: MediaCounts): string {
  const parts: string[] = [];
  const add = (kind: MediaKind, n: number) => {
    if (n <= 0) return;
    parts.push(n === 1 ? singular[kind] : `${n} ${plural[kind]}`);
  };
  add('photo', counts.photo);
  add('audio', counts.audio);
  return parts.join(' · ');
}
