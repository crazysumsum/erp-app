const DAY_MS = 24 * 60 * 60 * 1000;

const inventoryConfig = {
  defaultPageSize: Number(process.env.INVENTORY_DEFAULT_PAGE_SIZE || 20),
  maxPageSize: Number(process.env.INVENTORY_MAX_PAGE_SIZE || 100),
  maxCommandLines: Number(process.env.INVENTORY_MAX_COMMAND_LINES || 100),
  maxQuantity: Number(process.env.INVENTORY_MAX_QUANTITY || Number.MAX_SAFE_INTEGER),
  httpIdempotencyTtlMs: Number(process.env.INVENTORY_HTTP_IDEMPOTENCY_TTL_MS || 7 * DAY_MS),
  domainOperationRetentionDays: Number(process.env.INVENTORY_OPERATION_RETENTION_DAYS || 2557),
  exportMaxRows: Number(process.env.INVENTORY_EXPORT_MAX_ROWS || 100000),
  exportTimeoutMs: Number(process.env.INVENTORY_EXPORT_TIMEOUT_MS || 120000),
  openingMaxRows: Number(process.env.INVENTORY_OPENING_MAX_ROWS || 10000),
  openingMaxBytes: Number(process.env.INVENTORY_OPENING_MAX_BYTES || 10 * 1024 * 1024),
  openingWorkerIntervalMs: Number(process.env.INVENTORY_OPENING_WORKER_INTERVAL_MS || 5000),
  openingLeaseMs: Number(process.env.INVENTORY_OPENING_LEASE_MS || 60000),
  openingLeaseRenewIntervalMs: Number(process.env.INVENTORY_OPENING_LEASE_RENEW_INTERVAL_MS || 20000),
  openingMaxAttempts: Number(process.env.INVENTORY_OPENING_MAX_ATTEMPTS || 3),
  retainedHistoryDays: Number(process.env.INVENTORY_RETAINED_HISTORY_DAYS || 2557)
};

export default inventoryConfig;
