// Shared human-readable labels and formatting.
//
// Observation CATEGORY/VALUE labels are no longer hard-coded here — they are resolved from the
// session's protocol (see `src/protocol/resolve.ts`). This module keeps only vocabulary that is
// NOT protocol-driven (asset types) plus the generic `readable` token formatter.

import type { AssetType } from './types';

export const assetTypeLabels: Record<AssetType, string> = {
  trailhead: 'Trailhead',
  car_park: 'Car park',
  viewpoint: 'Viewpoint',
  visitor_centre: 'Visitor centre',
  path_segment: 'Path segment',
  public_space: 'Public space',
  other: 'Other',
};

/** Turn an UPPER_SNAKE controlled-vocabulary token into a readable label. */
export function readable(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
