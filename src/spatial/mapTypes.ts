// Spatial presentation types (P1-6).
//
// These are DERIVED VIEWS over domain entities, never a new source of truth. A map feature
// is produced from an Observation/Asset for rendering and selection only; it is never persisted,
// never bumps a schema version, and never overrides the canonical record. The immutable capture
// block stays in the domain layer — the map only reads the DERIVED effective location.

import type {
  AssetSource,
  AssetType,
  Coordinate,
  EvidenceMethod,
  IsoTimestamp,
  LocationStatus,
  ObservationCategory,
  Uuid,
} from '../domain/types';

/** Which location an observation marker was placed at — mirrors `effectiveLocation` source. */
export type ObservationPlacement = 'captured' | 'adjusted';

/** An observation rendered as a point. Coordinate is the DERIVED effective location. */
export interface ObservationMapFeature {
  kind: 'observation';
  id: Uuid;
  coordinate: Coordinate;
  /**
   * 'adjusted' when a manual `locationAdjustment` moved the pin off the raw GNSS fix,
   * 'captured' when the marker sits on the raw captured coordinate. The popup uses this to
   * state honestly that a mapped position was manually adjusted — never implying the adjusted
   * coordinate was the original fix.
   */
  placement: ObservationPlacement;
  category: ObservationCategory;
  value: string | null;
  evidenceMethod: EvidenceMethod;
  capturedAt: IsoTimestamp;
  /** Raw GNSS accuracy of the underlying capture (metres); null when there was no fix accuracy. */
  accuracyMeters: number | null;
  locationStatus: LocationStatus;
}

/** An asset rendered as a point. Assets are POINT geometry only in this data model. */
export interface AssetMapFeature {
  kind: 'asset';
  id: Uuid;
  coordinate: Coordinate;
  name: string;
  assetType: AssetType | null;
  source: AssetSource;
}

/** The device's current position — a single fix, never a track. */
export interface DeviceMapFeature {
  kind: 'device';
  coordinate: Coordinate;
  accuracyMeters: number | null;
}

export type MapFeature = ObservationMapFeature | AssetMapFeature | DeviceMapFeature;
