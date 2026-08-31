// Shared human-readable labels and formatting for controlled vocabularies.
// Extracted so the capture/detail screens and the spatial map render the SAME wording
// (single source of truth — a category renamed here changes everywhere at once).

import type { AssetType, ObservationCategory } from './types';

export const categoryLabels: Record<ObservationCategory, string> = {
  visitor_pressure: 'Visitor pressure',
  parking_pressure: 'Parking pressure',
  path_condition: 'Path condition',
  litter: 'Litter',
  infrastructure_condition: 'Infrastructure',
  signage_condition: 'Signage',
  accessibility_barrier: 'Accessibility',
  visitor_management: 'Visitor management',
  other: 'Other',
};

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
