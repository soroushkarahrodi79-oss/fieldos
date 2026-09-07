import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { buildFieldPack } from './build';
import { inspectFieldPack } from './import';
import { FieldPackValidationError } from './manifest';
import { parseFieldPackAssets } from './assets';
import { TOURISM_CORE_PROTOCOL } from '../protocol/tourismCore';
import type { FieldPackAssetSpec } from './types';

const ASSETS: FieldPackAssetSpec[] = [
  { sourceRef: 'trailhead-01', name: 'North Trailhead', assetType: 'trailhead', latitude: 40.8, longitude: -3.9 },
  { sourceRef: 'car-park-01', name: 'Main Car Park', assetType: 'car_park', latitude: 40.81, longitude: -3.91 },
];

async function validPack(overrides: Partial<Parameters<typeof buildFieldPack>[0]> = {}) {
  return buildFieldPack({
    fieldpackId: 'pack-demo', fieldpackVersion: 1, title: 'Demo mission', description: null,
    protocol: TOURISM_CORE_PROTOCOL, assets: ASSETS, ...overrides,
  });
}

/** Rebuild a pack's ZIP after mutating one JSON payload (keeps the others intact). */
function repack(bytes: Uint8Array, mutate: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(bytes);
  mutate(files);
  return zipSync(files);
}
const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('FieldPack build + inspect (happy path)', () => {
  it('builds a valid, integrity-hashed pack that inspects as VERIFIED', async () => {
    const { bytes, manifest } = await validPack();
    expect(manifest.integrity.algorithm).toBe('SHA-256');
    expect(Object.keys(manifest.integrity.files).sort()).toEqual(['assets.geojson', 'protocol.json']);
    // The manifest never hashes itself.
    expect(manifest.integrity.files).not.toHaveProperty('manifest.json');

    const inspection = await inspectFieldPack(bytes);
    expect(inspection.integrityStatus).toBe('VERIFIED');
    expect(inspection.protocol.protocolId).toBe('fieldos-tourism-core');
    expect(inspection.assets).toHaveLength(2);
    expect(inspection.assets.map((a) => a.sourceRef)).toEqual(['trailhead-01', 'car-park-01']);
    expect(inspection.assetTypeBreakdown).toEqual({ trailhead: 1, car_park: 1 });
    expect(inspection.collision).toEqual({ kind: 'none' });
  });

  it('is deterministic for the same inputs', async () => {
    const a = await validPack();
    const b = await validPack();
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });
});

describe('FieldPack manifest + archive validation', () => {
  it('rejects a non-readable archive', async () => {
    await expect(inspectFieldPack(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(FieldPackValidationError);
  });

  it('rejects a missing protocol.json', async () => {
    const { bytes } = await validPack();
    const broken = repack(bytes, (files) => { delete files['protocol.json']; });
    await expect(inspectFieldPack(broken)).rejects.toThrow('missing protocol.json');
  });

  it('rejects a missing assets.geojson', async () => {
    const { bytes } = await validPack();
    const broken = repack(bytes, (files) => { delete files['assets.geojson']; });
    await expect(inspectFieldPack(broken)).rejects.toThrow('missing assets.geojson');
  });

  it('rejects an unexpected/unsafe archive path', async () => {
    const { bytes } = await validPack();
    const broken = repack(bytes, (files) => { files['../evil.txt'] = enc('x'); });
    await expect(inspectFieldPack(broken)).rejects.toThrow('unsafe or unexpected');
  });

  it('rejects a malformed manifest (wrong format tag)', async () => {
    const { bytes } = await validPack();
    const broken = repack(bytes, (files) => {
      const m = JSON.parse(strFromU8(files['manifest.json']!));
      m.format = 'something-else';
      files['manifest.json'] = enc(m);
    });
    await expect(inspectFieldPack(broken)).rejects.toThrow('not a FieldOS FieldPack');
  });

  it('rejects an unsupported (newer) fieldpack schema', async () => {
    const { bytes } = await validPack();
    const broken = repack(bytes, (files) => {
      const m = JSON.parse(strFromU8(files['manifest.json']!));
      m.fieldpackSchemaVersion = 999;
      files['manifest.json'] = enc(m);
    });
    await expect(inspectFieldPack(broken)).rejects.toThrow('newer FieldPack schema');
  });

  it('rejects a manifest missing required integrity', async () => {
    const { bytes } = await validPack();
    const broken = repack(bytes, (files) => {
      const m = JSON.parse(strFromU8(files['manifest.json']!));
      delete m.integrity;
      files['manifest.json'] = enc(m);
    });
    await expect(inspectFieldPack(broken)).rejects.toThrow('integrity');
  });

  it('rejects changed payload bytes (integrity mismatch)', async () => {
    const { bytes } = await validPack();
    const broken = repack(bytes, (files) => {
      files['assets.geojson'] = enc({ type: 'FeatureCollection', features: [] });
    });
    await expect(inspectFieldPack(broken)).rejects.toThrow('integrity verification failed');
  });

  it('rejects an unsupported (newer) protocol schema, re-hashing so integrity still matches', async () => {
    // Build a pack whose protocol declares a newer engine schema, so the failure is the protocol
    // schema gate, not an integrity mismatch.
    const { bytes } = await buildFieldPack({
      fieldpackId: 'pack-newer', fieldpackVersion: 1, title: 'Newer', description: null,
      protocol: { ...TOURISM_CORE_PROTOCOL, schemaVersion: 999 }, assets: ASSETS,
    });
    await expect(inspectFieldPack(bytes)).rejects.toThrow('protocol is invalid');
  });
});

describe('assets.geojson validation (§9)', () => {
  const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features });
  const point = (props: Record<string, unknown>, coords: [number, number] = [-3.9, 40.8]) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props,
  });

  it('accepts valid point assets and preserves unique source refs', () => {
    const specs = parseFieldPackAssets(fc([
      point({ id: 'a', name: 'A', assetType: 'viewpoint' }),
      point({ id: 'b', name: 'B' }, [-3.5, 40.1]),
    ]));
    expect(specs.map((s) => s.sourceRef)).toEqual(['a', 'b']);
    expect(specs[0]!.assetType).toBe('viewpoint');
    expect(specs[1]!.assetType).toBeNull();
  });

  it('rejects duplicate source refs', () => {
    expect(() => parseFieldPackAssets(fc([point({ id: 'a', name: 'A' }), point({ id: 'a', name: 'B' })]))).toThrow('Duplicate source asset id');
  });

  it('rejects a missing/empty name', () => {
    expect(() => parseFieldPackAssets(fc([point({ id: 'a', name: '' })]))).toThrow('non-empty name');
  });

  it('rejects an out-of-range coordinate', () => {
    expect(() => parseFieldPackAssets(fc([point({ id: 'a', name: 'A' }, [200, 40])]))).toThrow('out-of-range longitude');
    expect(() => parseFieldPackAssets(fc([point({ id: 'a', name: 'A' }, [10, 99])]))).toThrow('out-of-range latitude');
  });

  it('rejects Polygon, LineString, and null geometry', () => {
    expect(() => parseFieldPackAssets(fc([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { id: 'a', name: 'A' } }]))).toThrow('only Point assets');
    expect(() => parseFieldPackAssets(fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: { id: 'a', name: 'A' } }]))).toThrow('only Point assets');
    expect(() => parseFieldPackAssets(fc([{ type: 'Feature', geometry: null, properties: { id: 'a', name: 'A' } }]))).toThrow('no geometry');
  });

  it('rejects an unknown assetType instead of silently dropping it', () => {
    expect(() => parseFieldPackAssets(fc([point({ id: 'a', name: 'A', assetType: 'spaceport' })]))).toThrow('unknown assetType');
  });

  it('rejects a non-FeatureCollection', () => {
    expect(() => parseFieldPackAssets({ type: 'Feature' })).toThrow('FeatureCollection');
  });
});
