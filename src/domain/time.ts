import type { IsoTimestamp } from './types';

/**
 * Current wall-clock time as an ISO-8601 string with local offset.
 *
 * IMPORTANT (provenance): the device clock may be wrong when offline. We record it as-is
 * and never "correct" it. Exports must never regenerate a stored timestamp — they pass the
 * stored string through verbatim.
 *
 * `Date.prototype.toISOString()` yields UTC ("Z"); to preserve the local offset we format
 * manually so a reader can see when, locally, the observation happened.
 */
export function nowIso(date: Date = new Date()): IsoTimestamp {
  const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const millis = pad(date.getMilliseconds(), 3);

  // getTimezoneOffset() returns minutes BEHIND UTC (positive when local is behind UTC).
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offH = pad(Math.trunc(Math.abs(offsetMinutes) / 60));
  const offM = pad(Math.abs(offsetMinutes) % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offH}:${offM}`;
}
