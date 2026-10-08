// Deployment tuning only; domain constants live in modules/sales/salesConstants.js.
const salesConfig = {
  manualConfirmationWaitMs: Number(process.env.SALES_MANUAL_CONFIRMATION_WAIT_MS ?? 2500),
  confirmationLeaseMs: Number(process.env.SALES_CONFIRMATION_LEASE_MS ?? 60000),
  confirmationRecoveryBatchSize: Number(process.env.SALES_CONFIRMATION_RECOVERY_BATCH_SIZE ?? 50),
  importChannelCodes: process.env.SALES_IMPORT_CHANNEL_CODES?.trim() ? process.env.SALES_IMPORT_CHANNEL_CODES.split(",").map(code => code.trim()) : [],
  importMaxBytes: Number(process.env.SALES_IMPORT_MAX_BYTES ?? 50 * 1024 * 1024),
  importMaxRows: Number(process.env.SALES_IMPORT_MAX_ROWS ?? 100000),
  importMaxOrders: Number(process.env.SALES_IMPORT_MAX_ORDERS ?? 10000),
  importWorkerBatchSize: Number(process.env.SALES_IMPORT_WORKER_BATCH_SIZE ?? 50),
  importFileRetentionDays: Number(process.env.SALES_IMPORT_FILE_RETENTION_DAYS ?? 90),
  intakePayloadRetentionDays: Number(process.env.SALES_INTAKE_PAYLOAD_RETENTION_DAYS ?? 90),
  backorderBatchSize: Number(process.env.SALES_BACKORDER_BATCH_SIZE ?? 500),
  backorderNoStockRetryMs: Number(process.env.SALES_BACKORDER_NO_STOCK_RETRY_MS ?? 300000),
  archiveDayOfMonth: Number(process.env.SALES_ARCHIVE_DAY_OF_MONTH ?? 2),
  archiveHourHkt: Number(process.env.SALES_ARCHIVE_HOUR_HKT ?? 2),
  archiveBatchSize: Number(process.env.SALES_ARCHIVE_BATCH_SIZE ?? 500),
  archiveQueryMaxRangeDays: Number(process.env.SALES_ARCHIVE_QUERY_MAX_RANGE_DAYS ?? 366),
  exportMaxRows: Number(process.env.SALES_EXPORT_MAX_ROWS ?? 250000),
  exportFileRetentionDays: Number(process.env.SALES_EXPORT_FILE_RETENTION_DAYS ?? 7),
  auditDetailMaxBytes: Number(process.env.SALES_AUDIT_DETAIL_MAX_BYTES ?? 16384),
  transactionTimeoutMs: Number(process.env.SALES_TRANSACTION_TIMEOUT_MS ?? 30000),
};

export default salesConfig;
