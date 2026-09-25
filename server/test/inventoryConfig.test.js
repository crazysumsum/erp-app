import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInventoryConfig } from "../src/modules/inventory/normalizeInventoryConfig.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("Inventory config normalizes and freezes the approved defaults", () => {
  const config = normalizeInventoryConfig({});

  assert.deepEqual(config, {
    defaultPageSize: 20,
    maxPageSize: 100,
    maxCommandLines: 100,
    maxQuantity: Number.MAX_SAFE_INTEGER,
    httpIdempotencyTtlMs: 7 * DAY_MS,
    domainOperationRetentionDays: 2557,
    exportMaxRows: 100000,
    exportTimeoutMs: 120000,
    openingMaxRows: 10000,
    openingMaxBytes: 10 * 1024 * 1024,
    openingWorkerIntervalMs: 5000,
    openingLeaseMs: 60000,
    openingLeaseRenewIntervalMs: 20000,
    openingMaxAttempts: 3,
    retainedHistoryDays: 2557
  });
  assert.equal(Object.isFrozen(config), true);
});

test("Inventory config rejects unsafe limits and unapproved feature flags", () => {
  for (const source of [
    null,
    [],
    { defaultPageSize: 101 },
    { defaultPageSize: 50, maxPageSize: 20 },
    { maxPageSize: 101 },
    { maxCommandLines: 0 },
    { maxQuantity: Number.MAX_SAFE_INTEGER + 1 },
    { httpIdempotencyTtlMs: 7 * DAY_MS - 1 },
    { domainOperationRetentionDays: 2556 },
    { openingMaxRows: 10001 },
    { openingLeaseMs: 60000, openingLeaseRenewIntervalMs: 30000 },
    { retainedHistoryDays: 2556 },
    { negativeStockEnabled: true },
    { partialTransferEnabled: true },
    { stockStatuses: ["AVAILABLE", "CUSTOM"] },
    { typo: 1 }
  ]) {
    assert.throws(() => normalizeInventoryConfig(source));
  }
});
