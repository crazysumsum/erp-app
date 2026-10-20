const DEFAULTS = Object.freeze({
  maxLinesPerDocument: 100,
  maxAllocationsPerLine: 50,
  defaultPageSize: 20,
  maxPageSize: 100,
  operationLeaseMs: 60000,
  recoveryBatchSize: 100,
  exportBatchSize: 1000,
  exportMaxRows: 250000,
  exportRetentionHours: 24,
  archiveQueryMaxRangeDays: 366,
  reconciliationBatchSize: 500
});

const MAXIMUMS = Object.freeze({
  maxLinesPerDocument: 100,
  maxAllocationsPerLine: 50,
  defaultPageSize: 100,
  maxPageSize: 100,
  exportMaxRows: 250000,
  archiveQueryMaxRangeDays: 366
});

export function normalizeFulfillmentConfig(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Fulfillment config must be an object");
  }
  for (const name of Object.keys(source)) {
    if (!Object.hasOwn(DEFAULTS, name)) throw new Error(`Fulfillment config contains unsupported setting "${name}"`);
  }

  const config = {};
  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    const value = source[name] === undefined ? fallback : source[name];
    const maximum = MAXIMUMS[name] ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`Fulfillment config "${name}" must be an integer from 1 to ${maximum}`);
    }
    config[name] = value;
  }
  if (config.defaultPageSize > config.maxPageSize) {
    throw new Error('Fulfillment config "defaultPageSize" must not exceed "maxPageSize"');
  }
  return Object.freeze(config);
}
