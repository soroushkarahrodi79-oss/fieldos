// Storage-health utilities (correction §1).
//
// Durability is NOT guaranteed and must be OBSERVABLE. WebKit/Safari support these APIs and
// exempt installed Home Screen Web Apps from the ITP 7-day cap — but persistence is still
// browser-controlled and quota failures remain possible. So: request persistence, report
// status honestly, and let the UI nudge the user to back up. We never claim data is safe.

export interface StorageEstimate {
  /** Bytes used by this origin, if the browser reports it. */
  usageBytes: number | null;
  /** Total quota in bytes, if the browser reports it. */
  quotaBytes: number | null;
  /** usage/quota as 0..1, if both are known. */
  usageRatio: number | null;
}

export interface StorageHealth {
  /** Whether the Storage Manager API exists at all. */
  supported: boolean;
  /** True if the browser has granted persistent storage. */
  persisted: boolean;
  estimate: StorageEstimate;
}

function storageManager(): StorageManager | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.storage ?? null;
}

/** Is persistent storage currently granted? */
export async function isPersisted(): Promise<boolean> {
  const sm = storageManager();
  if (!sm?.persisted) return false;
  try {
    return await sm.persisted();
  } catch {
    return false;
  }
}

/**
 * Ask the browser to grant persistent storage. Browser-controlled: may resolve false.
 * Call on first write. Returns the resulting persisted state.
 */
export async function requestPersistence(): Promise<boolean> {
  const sm = storageManager();
  if (!sm?.persist) return false;
  try {
    if (sm.persisted && (await sm.persisted())) return true;
    return await sm.persist();
  } catch {
    return false;
  }
}

/** Current usage/quota estimate, with a ratio when both are known. */
export async function getEstimate(): Promise<StorageEstimate> {
  const sm = storageManager();
  const empty: StorageEstimate = { usageBytes: null, quotaBytes: null, usageRatio: null };
  if (!sm?.estimate) return empty;
  try {
    const { usage, quota } = await sm.estimate();
    const usageBytes = usage ?? null;
    const quotaBytes = quota ?? null;
    const usageRatio =
      usageBytes !== null && quotaBytes !== null && quotaBytes > 0
        ? usageBytes / quotaBytes
        : null;
    return { usageBytes, quotaBytes, usageRatio };
  } catch {
    return empty;
  }
}

/** One-shot snapshot of durability + quota for the durability banner. */
export async function getStorageHealth(): Promise<StorageHealth> {
  const sm = storageManager();
  if (!sm) {
    return {
      supported: false,
      persisted: false,
      estimate: { usageBytes: null, quotaBytes: null, usageRatio: null },
    };
  }
  const [persisted, estimate] = await Promise.all([isPersisted(), getEstimate()]);
  return { supported: true, persisted, estimate };
}
