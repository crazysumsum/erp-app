import { parseAndPrecheckCustomerCsv } from "../../../modules/customer/import/CustomerImportProcessor.js";

export async function precheckCustomerImportJob({ importService, database, logger, leaseOwner, leaseDurationMs, maxRows, maxBytes, rowBatchSize }) {
  const job = await importService.claimForPrecheck({ leaseOwner, leaseDurationMs });
  if (!job) return { claimed: false };
  void logger?.info?.("customer.import.claimed", "Customer import claimed for precheck", { jobId: job.id });
  await importService.preparePrecheck({ jobId: job.id, leaseOwner });
  let result;
  try {
    const source = await importService.readSource(job);
    result = await parseAndPrecheckCustomerCsv({
      source, mode: job.mode, connection: database, maxRows, maxBytes, batchSize: rowBatchSize,
      onRows: (rows) => importService.appendPrecheckRows({ jobId: job.id, leaseOwner, leaseDurationMs, rows })
    });
  } catch {
    result = { jobLevelError: { code: "SOURCE_FILE_UNAVAILABLE", message: "匯入來源檔案無法讀取或驗證" } };
  }
  const summary = await importService.recordPrecheck({ jobId: job.id, leaseOwner, ...result });
  void logger?.info?.("customer.import.prechecked", "Customer import precheck completed", {
    jobId: job.id, status: summary.status,
    counts: { total: summary.totalCount, valid: summary.validCount, warning: summary.warningCount, invalid: summary.invalidCount }
  });
  return { claimed: true, jobId: job.id, status: summary.status };
}
