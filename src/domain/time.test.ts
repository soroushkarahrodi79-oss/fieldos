import { describe, expect, it } from 'vitest';
import { nowIso } from './time';

describe('nowIso', () => {
  it('formats an ISO-8601 timestamp with a local offset', () => {
    const ts = nowIso(new Date('2026-08-21T07:00:00.000Z'));
    // Shape: YYYY-MM-DDTHH:mm:ss.SSS±HH:MM
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });

  it('is parseable back to the same instant', () => {
    const instant = new Date('2026-08-21T07:00:00.000Z');
    expect(new Date(nowIso(instant)).getTime()).toBe(instant.getTime());
  });
});
