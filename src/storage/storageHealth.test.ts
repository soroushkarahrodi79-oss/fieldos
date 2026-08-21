import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEstimate, getStorageHealth, isPersisted, requestPersistence } from './storageHealth';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(storage: Partial<StorageManager> | undefined): void {
  vi.stubGlobal('navigator', storage ? { storage } : {});
}

describe('storageHealth', () => {
  it('reports unsupported when the Storage Manager API is absent', async () => {
    stubStorage(undefined);
    const health = await getStorageHealth();
    expect(health.supported).toBe(false);
    expect(health.persisted).toBe(false);
  });

  it('reads persisted() and estimate() when supported', async () => {
    stubStorage({
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 250, quota: 1000 }),
    } as unknown as StorageManager);

    expect(await isPersisted()).toBe(true);
    const est = await getEstimate();
    expect(est.usageBytes).toBe(250);
    expect(est.quotaBytes).toBe(1000);
    expect(est.usageRatio).toBeCloseTo(0.25, 5);
  });

  it('requestPersistence does not re-request when already persisted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({
      persisted: vi.fn().mockResolvedValue(true),
      persist,
      estimate: vi.fn().mockResolvedValue({}),
    } as unknown as StorageManager);

    expect(await requestPersistence()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('requestPersistence asks the browser when not yet persisted', async () => {
    const persist = vi.fn().mockResolvedValue(false);
    stubStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist,
      estimate: vi.fn().mockResolvedValue({}),
    } as unknown as StorageManager);

    expect(await requestPersistence()).toBe(false);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('degrades gracefully when the API throws', async () => {
    stubStorage({
      persisted: vi.fn().mockRejectedValue(new Error('nope')),
      estimate: vi.fn().mockRejectedValue(new Error('nope')),
    } as unknown as StorageManager);

    expect(await isPersisted()).toBe(false);
    expect(await getEstimate()).toEqual({ usageBytes: null, quotaBytes: null, usageRatio: null });
  });
});
