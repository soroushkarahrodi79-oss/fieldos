// SYNTHETIC TEST DATA — NOT REAL OBSERVATIONS.
//
// This fixture exists only to exercise the data layer, serializers and backup. Every value is
// invented. Coordinates are placeholders in a fictional area and must never be presented as a
// real tourism claim or a real place assessment.

import type { Repositories } from '../db/repositories';
import type { CapturedLocation, IsoTimestamp } from '../domain/types';

const SYNTHETIC_MARKER = 'SYNTHETIC TEST DATA — not a real observation';

function capturedAt(minuteOffset: number): IsoTimestamp {
  // Deterministic timestamps around a fixed synthetic base moment (local offset preserved).
  const base = new Date('2026-08-21T09:00:00.000');
  base.setMinutes(base.getMinutes() + minuteOffset);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const off = -base.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}` +
    `T${pad(base.getHours())}:${pad(base.getMinutes())}:${pad(base.getSeconds())}.000` +
    `${sign}${pad(Math.trunc(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

function goodFix(minute: number, lat: number, lon: number, accuracy = 6): CapturedLocation {
  return {
    latitude: lat,
    longitude: lon,
    accuracyMeters: accuracy,
    altitudeMeters: 667,
    altitudeAccuracyMeters: 4.5,
    headingDegrees: 127,
    speedMetersPerSecond: 1.8,
    locationStatus: 'CAPTURED',
    capturedAt: capturedAt(minute),
  };
}

function noFix(minute: number, status: 'TIMEOUT' | 'DENIED' | 'UNAVAILABLE'): CapturedLocation {
  return {
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    altitudeMeters: null,
    altitudeAccuracyMeters: null,
    headingDegrees: null,
    speedMetersPerSecond: null,
    locationStatus: status,
    capturedAt: capturedAt(minute),
  };
}

/** A tiny fake binary blob standing in for a photo (content is irrelevant to the foundation). */
function fakePhoto(seedByte: number): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, seedByte, 0x00, 0x10])], {
    type: 'image/jpeg',
  });
}

export interface SeededFixture {
  sessionId: string;
  assetIds: string[];
  observationIds: string[];
  mediaIds: string[];
}

/** Seed ~1 session, 3 assets, 10 observations, 3 photos into the given repositories. */
export async function seedFixture(repos: Repositories): Promise<SeededFixture> {
  const session = await repos.createSession({
    title: 'SYNTHETIC — Demo field session',
    purpose: SYNTHETIC_MARKER,
    observerName: 'Test Observer (synthetic, unverified)',
    deviceLabel: 'fixture',
  });

  const assets = [
    await repos.createAsset({
      sessionId: session.id,
      name: 'North car park (synthetic)',
      assetType: 'car_park',
      latitude: 47.3701,
      longitude: 8.5401,
    }),
    await repos.createAsset({
      sessionId: session.id,
      name: 'Lakeside trailhead (synthetic)',
      assetType: 'trailhead',
      latitude: 47.3712,
      longitude: 8.5422,
    }),
    await repos.createAsset({
      sessionId: session.id,
      name: 'Viewpoint (synthetic, no coords)',
      assetType: 'viewpoint',
      latitude: null,
      longitude: null,
    }),
  ];

  const observationIds: string[] = [];

  const o1 = await repos.createObservation({
    sessionId: session.id,
    assetId: assets[1]!.id,
    capturedLocation: goodFix(0, 47.3713, 8.5423),
    observation: { category: 'visitor_pressure', value: 'HIGH' },
    evidence: { method: 'OBSERVED' },
    note: `${SYNTHETIC_MARKER}: busy trailhead`,
  });
  const o2 = await repos.createObservation({
    sessionId: session.id,
    assetId: assets[0]!.id,
    capturedLocation: goodFix(4, 47.3702, 8.5402),
    observation: { category: 'parking_pressure', value: 'FULL' },
    evidence: { method: 'MEASURED', value: 42, unit: 'vehicles', context: 'counted occupied bays' },
    note: null,
  });
  const o3 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(9, 47.372, 8.543, 45), // poor accuracy
    observation: { category: 'path_condition', value: 'POOR' },
    evidence: { method: 'OBSERVED' },
    note: `${SYNTHETIC_MARKER}: eroded surface`,
  });
  const o4 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(13, 47.3725, 8.5435),
    observation: { category: 'litter', value: 'MODERATE' },
    evidence: { method: 'OBSERVED' },
    note: null,
  });
  const o5 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(18, 47.373, 8.544),
    observation: { category: 'infrastructure_condition', value: 'DAMAGED' },
    evidence: { method: 'REPORTED', sourceNote: 'reported by site warden' },
    note: `${SYNTHETIC_MARKER}: broken railing`,
  });
  const o6 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: noFix(22, 'TIMEOUT'), // GPS timeout — saved anyway, no fabricated coordinate
    observation: { category: 'signage_condition', value: 'MISSING' },
    evidence: { method: 'OBSERVED' },
    note: `${SYNTHETIC_MARKER}: expected waymarker absent`,
  });
  const o7 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(27, 47.3735, 8.5445, 20),
    observation: { category: 'accessibility_barrier', value: 'MAJOR' },
    evidence: { method: 'OBSERVED' },
    note: `${SYNTHETIC_MARKER}: steep steps, no ramp`,
  });
  // Non-destructive manual correction on o7 (original capture preserved).
  await repos.adjustLocation(o7.id, {
    latitude: 47.37355,
    longitude: 8.54462,
    reason: 'moved pin to the actual step location',
  });

  const o8 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(31, 47.374, 8.545),
    observation: { category: 'visitor_management', value: 'PRESENT' },
    evidence: { method: 'OBSERVED' },
    note: 'one-way walking system in place',
  });
  const o9 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(36, 47.3745, 8.5455),
    observation: { category: 'other', value: null },
    evidence: { method: 'OBSERVED' },
    note: `${SYNTHETIC_MARKER}: informal desire path forming across the meadow`,
  });
  const o10 = await repos.createObservation({
    sessionId: session.id,
    capturedLocation: goodFix(41, 47.375, 8.546),
    observation: { category: 'visitor_pressure', value: 'MODERATE' },
    evidence: { method: 'MEASURED', value: 18, unit: 'people', context: 'headcount at viewpoint' },
    note: null,
  });

  const all = [o1, o2, o3, o4, o5, o6, o7, o8, o9, o10];
  observationIds.push(...all.map((o) => o.id));

  const m1 = await repos.addMedia({
    observationId: o1.id,
    kind: 'photo',
    blob: fakePhoto(0x01),
    mimeType: 'image/jpeg',
    originalFilename: 'trailhead.jpg',
  });
  const m2 = await repos.addMedia({
    observationId: o3.id,
    kind: 'photo',
    blob: fakePhoto(0x02),
    mimeType: 'image/jpeg',
    originalFilename: 'path.jpg',
  });
  const m3 = await repos.addMedia({
    observationId: o7.id,
    kind: 'photo',
    blob: fakePhoto(0x03),
    mimeType: 'image/jpeg',
    originalFilename: 'steps.jpg',
  });

  return {
    sessionId: session.id,
    assetIds: assets.map((a) => a.id),
    observationIds,
    mediaIds: [m1.id, m2.id, m3.id],
  };
}
