const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RETENTION_DAYS = 2557;
const DEFAULTS = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 100,
  maxCommandLines: 100,
  maxQuantity: Number.MAX_SAFE_INTEGER,
  httpIdempotencyTtlMs: 7 * DAY_MS,
  domainOperationRetentionDays: MIN_RETENTION_DAYS,
  exportMaxRows: 100000,
  exportTimeoutMs: 120000,
  openingMaxRows: 10000,
  openingMaxBytes: 10 * 1024 * 1024,
  openingWorkerIntervalMs: 5000,
  openingLeaseMs: 60000,
  openingLeaseRenewIntervalMs: 20000,
  openingMaxAttempts: 3,
  retainedHistoryDays: MIN_RETENTION_DAYS
});

function integer(source, name, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(source[name] ?? DEFAULTS[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Inventory config "${name}" must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export function normalizeInventoryConfig(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Inventory config must be an object");
  }

  const unknown = Object.keys(source).filter((name) => !Object.hasOwn(DEFAULTS, name));
  if (unknown.length > 0) {
    throw new Error(`Inventory config contains unsupported setting "${unknown[0]}"`);
  }

  const config = {
    defaultPageSize: integer(source, "defaultPageSize", { maximum: 100 }),
    maxPageSize: integer(source, "maxPageSize", { maximum: 100 }),
    maxCommandLines: integer(source, "maxCommandLines"),
    maxQuantity: integer(source, "maxQuantity"),
    httpIdempotencyTtlMs: integer(source, "httpIdempotencyTtlMs", { minimum: 7 * DAY_MS }),
    domainOperationRetentionDays: integer(source, "domainOperationRetentionDays", { minimum: MIN_RETENTION_DAYS }),
    exportMaxRows: integer(source, "exportMaxRows"),
    exportTimeoutMs: integer(source, "exportTimeoutMs"),
    openingMaxRows: integer(source, "openingMaxRows", { maximum: 10000 }),
    openingMaxBytes: integer(source, "openingMaxBytes"),
    openingWorkerIntervalMs: integer(source, "openingWorkerIntervalMs"),
    openingLeaseMs: integer(source, "openingLeaseMs"),
    openingLeaseRenewIntervalMs: integer(source, "openingLeaseRenewIntervalMs"),
    openingMaxAttempts: integer(source, "openingMaxAttempts"),
    retainedHistoryDays: integer(source, "retainedHistoryDays", { minimum: MIN_RETENTION_DAYS })
  };

  if (config.defaultPageSize > config.maxPageSize) {
    throw new Error('Inventory config "defaultPageSize" must not exceed "maxPageSize"');
  }
  if (config.openingLeaseRenewIntervalMs >= config.openingLeaseMs / 2) {
    throw new Error('Inventory config "openingLeaseRenewIntervalMs" must be less than half of "openingLeaseMs"');
  }

  return Object.freeze(config);
}
