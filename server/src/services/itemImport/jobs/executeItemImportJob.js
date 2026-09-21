/**
 * Claim 一個 `queued` import job，重新驗證所引用嘅 catalog／unique／SKU
 * version，喺單一個商品交易入面套用全部 valid row；成功狀態同商品一齊
 * commit，失敗狀態就喺 rollback 後用獨立短交易記錄。設計說明見
 * docs/items_management/design_spec.md §5.13、
 * §8.6、DEC-013（「匯入全有全無」）。
 *
 * 淨係支援 Standard 商品，對應 T28 已經核對過嘅 CSV 欄位契約：一列 CSV
 * 對應一個 Item＋SKU pair，create 建全新嘅 draft Item＋SKU，update 淨係改
 * 目標 SKU 嘅 `skuName`／`defaultTrackingPolicy`／`suggestedPriceAmount`／
 * `purchasable`／`sellable`（唔碰 Item 層級欄位、唔碰 SKU Code、唔碰 UOM／
 * barcode 集合）。
 *
 * Worker 本身唔直接寫 aggregate tables；每列交俾 Item domain 的
 * connection-aware command，既沿用同 HTTP API 相同的 domain authority，亦
 * 由 caller 保持整批只有一個 transaction。
 */

function sanitizeExecutionError(error) {
  // ApplicationError（categoryNotFound()／skuCodeTaken() 等）都帶
  // publicMessage，本身已經係安全、冇 SQL／stack 嘅中文訊息；其他錯誤
  // （例如未預期嘅 mysql2 error）一律用一句唔洩漏內部細節嘅泛用訊息，真正
  // 原因留喺 structured log。
  return error?.publicMessage || "套用失敗，已全部復原（詳情請查看伺服器日誌）";
}

export async function executeItemImportJob({
  importService,
  importAggregate,
  database,
  logger,
  time,
  importDirectory,
  transactionTimeoutMs,
  leaseOwner,
  leaseDurationMs
}) {
  const job = await importService.claimNextQueuedJobForExecution({ leaseOwner, leaseDurationMs });

  if (!job) {
    return { claimed: false };
  }

  void logger?.info?.("item.import.claimed", "Import job claimed for execution", {
    jobId: job.id,
    leaseOwner,
    leaseRecovered: job.leaseRecovered,
    // Job 由 `queued` 轉 `running`（呢一刻）距離入 `queued` 隊（confirmed_at）
    // 等咗幾耐——design_spec §12.3 要求嘅 import queue age 觀測指標。
    queueAgeMs: job.confirmedAt === null ? null : time.nowMs() - job.confirmedAt
  });

  const rows = await importService.listValidRowsForExecution({ jobId: job.id });
  const nowMs = time.nowMs();

  let appliedCount = 0;
  let executionError = null;
  let failedRowNumber = null;

  try {
    await database.withTransaction(
      async (connection) => {
        await importService.lockExecutionLease(connection, { jobId: job.id, leaseOwner });
        if (!job.confirmation) {
          throw new Error("Item import confirmation audit context is missing");
        }
        const actor = await importAggregate.authorizeExecution(connection, { actorId: job.confirmedBy });
        for (const row of rows) {
          try {
            await importAggregate.applyRow(connection, {
              row,
              actorId: job.confirmedBy,
              actor,
              reason: job.confirmation.reason,
              requestId: job.confirmation.requestId,
              ip: job.confirmation.ip,
              nowMs
            });
            appliedCount += 1;
          } catch (rowError) {
            failedRowNumber = row.rowNumber;
            throw rowError;
          }
        }
        await importService.recordExecutionSuccessInTransaction(connection, {
          jobId: job.id,
          leaseOwner,
          successCount: appliedCount,
          appliedRowNumbers: rows.map((row) => row.rowNumber)
        });
      },
      { timeoutMs: transactionTimeoutMs }
    );
  } catch (error) {
    executionError = error;
    failedRowNumber ??= rows[0]?.rowNumber ?? null;
  }

  const status = executionError ? "failed" : "completed";
  const successCount = executionError ? 0 : appliedCount;
  const failureCount = executionError ? rows.length : 0;
  const errorSummary = executionError
    ? `第 ${failedRowNumber} 列套用失敗，整批已復原：${sanitizeExecutionError(executionError)}`
    : null;

  // 失敗狀態用獨立短交易記錄，否則商品 transaction rollback 會連 job failure
  // 一齊撤銷；成功狀態已經同 aggregate 在上面的 transaction 原子提交。
  if (executionError) {
    const finalization = await importService.recordExecutionResult({
      jobId: job.id,
      leaseOwner,
      status,
      successCount,
      failureCount,
      errorSummary,
      failedRow: { rowNumber: failedRowNumber, message: sanitizeExecutionError(executionError) }
    });
    if (!finalization.recorded) {
      void logger?.warn?.("item.import.lease_lost", "Import worker lost ownership before failure finalization", {
        jobId: job.id,
        leaseOwner
      });
      return { claimed: true, jobId: job.id, outcome: "lost_lease" };
    }
  }
  await importService.writeResultFile({ jobId: job.id, importDirectory });

  void logger?.[executionError ? "error" : "info"]?.(
    executionError ? "item.import.failed" : "item.import.completed",
    "Import job execution finished",
    { jobId: job.id, status, successCount, failureCount, ...(failedRowNumber ? { failedRowNumber } : {}) }
  );

  return { claimed: true, jobId: job.id, outcome: status };
}
