import { describe, expect, it } from 'vitest';
import { makeTestRepos } from '../test/helpers';
import { seedFixture } from '../fixtures/testFixture';
import { buildSessionBundle } from './bundle';
import { parseSessionJson, serializeSessionJson } from './json';
import { serializeObservationsCsv } from './csv';
import { serializeObservationsGeoJson } from './geojson';

async function seededBundle() {
  const { repos } = makeTestRepos();
  const fixture = await seedFixture(repos);
  const { bundle } = await buildSessionBundle(repos, fixture.sessionId);
  return { bundle, fixture };
}

describe('canonical JSON', () => {
  it('round-trips and preserves UUIDs and timestamps verbatim', async () => {
    const { bundle } = await seededBundle();
    const text = serializeSessionJson(bundle);
    const parsed = parseSessionJson(text);

    expect(parsed.session.id).toBe(bundle.session.id);
    expect(parsed.session.createdAt).toBe(bundle.session.createdAt);
    expect(parsed.observations).toHaveLength(10);
    for (let i = 0; i < bundle.observations.length; i++) {
      expect(parsed.observations[i]!.id).toBe(bundle.observations[i]!.id);
      expect(parsed.observations[i]!.capturedAt).toBe(bundle.observations[i]!.capturedAt);
      expect(parsed.observations[i]!.createdAt).toBe(bundle.observations[i]!.createdAt);
    }
    expect(parsed.observations[0]!.capturedLocation.altitudeAccuracyMeters).toBe(4.5);
    expect(parsed.observations[0]!.capturedLocation.headingDegrees).toBe(127);
    expect(parsed.observations[0]!.capturedLocation.speedMetersPerSecond).toBe(1.8);
  });

  it('normalizes a legacy canonical export with absent GNSS additions', async () => {
    const { bundle } = await seededBundle();
    const legacy = JSON.parse(serializeSessionJson(bundle));
    legacy.fieldosSchemaVersion = 1;
    legacy.observations[0].schemaVersion = 1;
    delete legacy.observations[0].capturedLocation.altitudeAccuracyMeters;
    delete legacy.observations[0].capturedLocation.headingDegrees;
    delete legacy.observations[0].capturedLocation.speedMetersPerSecond;

    const parsed = parseSessionJson(JSON.stringify(legacy));
    expect(parsed.observations[0]!.capturedLocation.altitudeAccuracyMeters).toBeNull();
    expect(parsed.observations[0]!.capturedLocation.headingDegrees).toBeNull();
    expect(parsed.observations[0]!.capturedLocation.speedMetersPerSecond).toBeNull();
    expect(serializeSessionJson(parsed)).toContain('"altitudeAccuracyMeters": null');
  });

  it('carries schema + app version and media metadata (no blobs)', async () => {
    const { bundle } = await seededBundle();
    expect(bundle.fieldosSchemaVersion).toBe(3);
    expect(bundle.media).toHaveLength(3);
    // Media metadata must not contain a blob.
    expect(bundle.media[0]).not.toHaveProperty('blob');
    expect(bundle.media[0]!.backupFilename).toMatch(/^media\/.+\.jpg$/);
  });

  it('round-trips the full audit history exactly', async () => {
    const { bundle } = await seededBundle();
    // The fixture creates 10 observations (each a CREATED event) and one location adjustment.
    expect(bundle.auditEntries.length).toBe(11);

    const parsed = parseSessionJson(serializeSessionJson(bundle));
    expect(parsed.auditEntries).toEqual(bundle.auditEntries);
    const adjust = parsed.auditEntries.find((e) => e.eventType === 'LOCATION_ADJUSTED');
    expect(adjust?.before?.locationAdjustment).toBeNull();
    expect(adjust?.after.locationAdjustment?.latitude).toBeCloseTo(47.37355, 4);
  });

  it('normalizes a legacy canonical export that predates auditEntries to []', async () => {
    const { bundle } = await seededBundle();
    const legacy = JSON.parse(serializeSessionJson(bundle));
    legacy.fieldosSchemaVersion = 2;
    delete legacy.auditEntries; // schema-1/2 exports have no audit collection.

    const parsed = parseSessionJson(JSON.stringify(legacy));
    expect(parsed.auditEntries).toEqual([]); // no invented events.
  });
});

describe('CSV', () => {
  it('has a header and one row per observation with category-specific values', async () => {
    const { bundle } = await seededBundle();
    const csv = serializeObservationsCsv(bundle);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(11); // header + 10
    expect(lines[0]).toContain('category');
    expect(lines[0]).toContain('evidenceMethod');
    expect(csv).toContain('parking_pressure');
    expect(csv).toContain('FULL');
    // MEASURED context and REPORTED source note are present.
    expect(csv).toContain('vehicles');
    expect(csv).toContain('site warden');
  });

  it('escapes commas/quotes in free text', async () => {
    const { repos } = makeTestRepos();
    const s = await repos.createSession({ title: 'S' });
    await repos.createObservation({
      sessionId: s.id,
      capturedLocation: {
        latitude: 1, longitude: 2, accuracyMeters: 5, altitudeMeters: null,
        altitudeAccuracyMeters: null, headingDegrees: null, speedMetersPerSecond: null,
        locationStatus: 'CAPTURED', capturedAt: '2026-08-21T09:00:00.000+02:00',
      },
      observation: { category: 'other', value: null },
      evidence: { method: 'OBSERVED' },
      note: 'a note, with "quotes" and, commas',
    });
    const { bundle } = await buildSessionBundle(repos, s.id);
    const csv = serializeObservationsCsv(bundle);
    expect(csv).toContain('"a note, with ""quotes"" and, commas"');
  });

  it('emits deterministic raw GNSS columns and empty cells for unavailable values', async () => {
    const { bundle } = await seededBundle();
    const lines = serializeObservationsCsv(bundle).split('\r\n');
    const columns = lines[0]!.split(',');
    const altitudeAccuracy = columns.indexOf('location_altitude_accuracy_m');
    const heading = columns.indexOf('location_heading_deg');
    const speed = columns.indexOf('location_speed_mps');
    expect(altitudeAccuracy).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(-1);
    expect(speed).toBeGreaterThan(-1);

    const located = lines[1]!.split(',');
    expect(located[altitudeAccuracy]).toBe('4.5');
    expect(located[heading]).toBe('127');
    expect(located[speed]).toBe('1.8');

    const unlocated = lines.find((line) => line.includes(',TIMEOUT,'))!.split(',');
    expect(unlocated[altitudeAccuracy]).toBe('');
    expect(unlocated[heading]).toBe('');
    expect(unlocated[speed]).toBe('');
  });
});

describe('GeoJSON', () => {
  it('is a valid FeatureCollection with [lon,lat] geometry and null geometry when unlocated', async () => {
    const { bundle } = await seededBundle();
    const gj = JSON.parse(serializeObservationsGeoJson(bundle));
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.features).toHaveLength(10);

    const located = gj.features.filter((f: { geometry: unknown }) => f.geometry !== null);
    const unlocated = gj.features.filter((f: { geometry: unknown }) => f.geometry === null);
    expect(unlocated).toHaveLength(1); // the GPS-timeout observation
    // Coordinates are [longitude, latitude].
    const first = located[0];
    expect(first.geometry.type).toBe('Point');
    expect(first.geometry.coordinates[0]).toBeGreaterThan(8); // lon ~8.5
    expect(first.geometry.coordinates[1]).toBeGreaterThan(47); // lat ~47.3
  });

  it('reflects the adjusted location as locationSource=adjusted', async () => {
    const { bundle } = await seededBundle();
    const gj = JSON.parse(serializeObservationsGeoJson(bundle));
    const adjusted = gj.features.find(
      (f: { properties: { locationSource: string } }) => f.properties.locationSource === 'adjusted',
    );
    expect(adjusted).toBeDefined();
    expect(adjusted.geometry.coordinates[1]).toBeCloseTo(47.37355, 4);
    expect(adjusted.properties.altitudeAccuracyMeters).toBe(4.5);
    expect(adjusted.properties.headingDegrees).toBe(127);
    expect(adjusted.properties.speedMetersPerSecond).toBe(1.8);
  });
});
