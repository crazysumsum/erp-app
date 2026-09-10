/**
 * Claim 一個 `uploaded` import job，讀佢嘅來源 CSV，跑 preflight
 * validation，寫結果。設計說明見 docs/items_management/design_spec.md
 * §8.6、§12.3（結構化 log 事件名稱）。
 *
 * 抽成獨立函式而唔係直接寫喺 `ItemImportWorkerService` 嘅方法入面——一個
 * plain async function 淨係要 mock 幾個依賴就測到，唔使起返成個 scheduler
 * 註冊機制。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAndValidateCsv } from "../../../modules/item/import/ItemImportProcessor.js";

export async function validateItemImportJob({
  importService,
  database,
  logger,
  importDirectory,
  maxRows,
  batchSize,
  leaseOwner,
  leaseDurationMs
}) {
  const job = await importService.claimNextUploadedJobForValidation({ leaseOwner, leaseDurationMs });

  if (!job) {
    return { claimed: false };
  }

  void logger?.info?.("item.import.claimed", "Import job claimed for validation", {
    jobId: job.id,
    leaseOwner
  });

  let csvText;
  try {
    csvText = await readFile(path.join(importDirectory, job.fileStoredName), "utf8");
  } catch (error) {
    // 來源檔缺失屬於 job 層級嘅問題（例如尚未接上嘅 upload 流程有 bug、
    // 或者檔案喺清理 job 之外被人手移走），同 CSV 內容本身無關，一樣令 job
    // 轉 invalid，唔會拋出去令 worker 卡住冇釋放 lease。
    await importService.recordValidationResult({
      jobId: job.id,
      rows: [],
      counts: { total: 0, valid: 0, warning: 0, invalid: 0 },
      jobLevelError: { code: "SOURCE_FILE_MISSING", message: "找不到來源 CSV 檔案" },
      batchSize
    });
    void logger?.error?.("item.import.failed", "Import job's source file could not be read", {
      jobId: job.id,
      storedName: job.fileStoredName,
      error: { name: error.name, code: error.code ?? null }
    });
    return { claimed: true, jobId: job.id, outcome: "source_missing" };
  }

  const result = await parseAndValidateCsv({ csvText, mode: job.mode, connection: database, maxRows });

  await importService.recordValidationResult({ jobId: job.id, batchSize, ...result });

  if (!result.jobLevelError) {
    // 冇 rows 好報就唔使產生一份得返 header 嘅結果檔——`jobLevelError` 個案
    // （CSV 解析唔到／超過列數上限）根本冇任何逐列結果。
    await importService.writeResultFile({ jobId: job.id, importDirectory });
  }

  void logger?.info?.("item.import.validated", "Import job validation completed", {
    jobId: job.id,
    outcome: result.jobLevelError ? "job_level_error" : result.counts.invalid > 0 ? "invalid" : "ready",
    ...(result.jobLevelError ? { errorCode: result.jobLevelError.code } : { counts: result.counts })
  });

  return { claimed: true, jobId: job.id, outcome: "validated" };
}
