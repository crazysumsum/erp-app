const fulfillmentConfig = {
  maxLinesPerDocument: Number(process.env.FULFILLMENT_MAX_LINES_PER_DOCUMENT ?? 100),
  maxAllocationsPerLine: Number(process.env.FULFILLMENT_MAX_ALLOCATIONS_PER_LINE ?? 50),
  defaultPageSize: Number(process.env.FULFILLMENT_DEFAULT_PAGE_SIZE ?? 20),
  maxPageSize: Number(process.env.FULFILLMENT_MAX_PAGE_SIZE ?? 100),
  operationLeaseMs: Number(process.env.FULFILLMENT_OPERATION_LEASE_MS ?? 60000),
  recoveryBatchSize: Number(process.env.FULFILLMENT_RECOVERY_BATCH_SIZE ?? 100),
  exportBatchSize: Number(process.env.FULFILLMENT_EXPORT_BATCH_SIZE ?? 1000),
  exportMaxRows: Number(process.env.FULFILLMENT_EXPORT_MAX_ROWS ?? 250000),
  exportRetentionHours: Number(process.env.FULFILLMENT_EXPORT_RETENTION_HOURS ?? 24),
  archiveQueryMaxRangeDays: Number(process.env.FULFILLMENT_ARCHIVE_QUERY_MAX_RANGE_DAYS ?? 366),
  reconciliationBatchSize: Number(process.env.FULFILLMENT_RECONCILIATION_BATCH_SIZE ?? 500)
};

export default fulfillmentConfig;
