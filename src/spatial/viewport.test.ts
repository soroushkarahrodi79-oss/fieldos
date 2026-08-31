import { describe, expect, it } from 'vitest';
import { collectCoordinates, computeViewport } from './viewport';
import type { Coordinate } from '../domain/types';

const c = (latitude: number, longitude: number): Coordinate => ({ latitude, longitude });

describe('computeViewport', () => {
  it('reports empty when there are no coordinates at all', () => {
    expect(computeViewport([])).toEqual({ kind: 'empty' });
  });

  it('centres on a single coordinate', () => {
    const viewport = computeViewport([c(47.37, 8.54)]);
    expect(viewport).toEqual({ kind: 'point', center: [8.54, 47.37], zoom: 15 });
  });

  it('collapses duplicate coordinates to a single point', () => {
    const viewport = computeViewport([c(47.37, 8.54), c(47.37, 8.54)]);
    expect(viewport.kind).toBe('point');
  });

  it('fits bounds around several coordinates in [[w,s],[e,n]] order', () => {
    const viewport = computeViewport([c(47, 8), c(48, 9), c(46.5, 8.5)]);
    expect(viewport).toEqual({
      kind: 'bounds',
      bounds: [
        [8, 46.5],
        [9, 48],
      ],
    });
  });
});

describe('collectCoordinates', () => {
  it('gathers coordinates from several feature groups', () => {
    const coords = collectCoordinates(
      [{ coordinate: c(1, 2) }, { coordinate: c(3, 4) }],
      [{ coordinate: c(5, 6) }],
    );
    expect(coords).toEqual([c(1, 2), c(3, 4), c(5, 6)]);
  });

  it('is empty when every group is empty', () => {
    expect(collectCoordinates([], [])).toEqual([]);
  });
});
