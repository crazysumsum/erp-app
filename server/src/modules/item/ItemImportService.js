/**
 * Import Job／Row 的持久層操作：claim job 做 validation、寫入驗證結果、
 * 查詢 job／row。設計說明見 docs/items_management/design_spec.md §5.13、
 * §8.6。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——同 ItemAdminService／
 * ItemCatalogService 一路以嚟嘅慣例一致。
 *
 * 呢個 task（T28）只做 preflight：呢個檔案冚唔到 upload／confirm／
 * cancel／result 呢幾個 handler-facing 方法——嗰啲要到 T29 先接上真正嘅
 * HTTP 入口，現在冇端點可以建立一個 job，測試靠直接種 DB row。
 */
function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

export class ItemImportService {
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("ItemImportService requires database, logger and time");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
  }

  /**
   * 原子攞一個 `uploaded` job 嚟做 validation：用 compare-and-set 一次過轉
   * 做 `validating` 並寫 lease，防止兩個 worker instance 同時揀中同一個
   * job（§8.6：「同 Job 只有一個 owner」）。冇合資格嘅 job 就回 null。
   *
   * `FOR UPDATE` 鎖住揀中嗰一列，等 compare-and-set 嗰句 UPDATE 之間唔會被
   * 另一個並行嘅 claim 搶走同一個 job——單純 SELECT 再 UPDATE 會有競態窗口，
   * 兩個 worker 都可能揀中同一個 `uploaded` job。
   */
  async claimNextUploadedJobForValidation({ leaseOwner, leaseDurationMs }) {
    return this.database.withTransaction(async (connection) => {
      const [[job]] = await connection.query(
        `SELECT id, file_stored_name, mode, version
           FROM item_import_jobs
          WHERE status = 'uploaded'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE`
      );

      if (!job) {
        return null;
      }

      const nowMs = this.time.nowMs();
      const leaseUntil = nowMs + leaseDurationMs;

      await connection.execute(
        `UPDATE item_import_jobs
            SET status = 'validating', lease_owner = ?, lease_until = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ?`,
        [leaseOwner, leaseUntil, nowMs, job.id, job.version]
      );

      return { id: job.id, fileStoredName: job.file_stored_name, mode: job.mode };
    });
  }

  /**
   * 寫入驗證結果：刪走呢個 job 舊嘅 row（等重試安全——同一個 job 兩次跑
   * validation，第二次唔會令 row 重複）、批量插入新嘅（每 `batchSize` 行一次
   * INSERT，對齊 `config.item.importBatchSize`，避免一句 SQL 塞成千上萬個
   * placeholder）、更新 job 嘅統計／狀態／釋放 lease。
   *
   * `jobLevelError` 存在代表整份 CSV 層級嘅問題（解析唔到、超過列數上限）：
   * 呢種情況冇任何 row 好寫，job 直接轉 `invalid`，`error_summary` 記低
   * 已經清理過嘅訊息（唔含 stack／SQL）。
   *
   * `counts.invalid > 0` 就令 job 轉 `invalid`（唔可以 confirm），否則轉
   * `ready`——呼應 acceptance criterion「任一 invalid row 令 Job 不能
   * confirm」。`success_count`／`failure_count` 呢兩個欄本來嘅設計意圖係
   * execution 階段嘅「已套用／已失敗」統計（§5.13），呢個 task 暫時借用嚟
   * 表達「preflight 通過／preflight 唔通過」嘅列數，T29 執行完成之後會用
   * 真正嘅套用結果覆寫呢兩個數字。
   */
  async recordValidationResult({ jobId, rows, counts, jobLevelError, batchSize }) {
    return this.database.withTransaction(async (connection) => {
      await connection.execute("DELETE FROM item_import_rows WHERE job_id = ?", [jobId]);

      const nowMs = this.time.nowMs();

      if (jobLevelError) {
        await connection.execute(
          `UPDATE item_import_jobs
              SET status = 'invalid', error_summary = ?, total_count = 0, success_count = 0,
                  failure_count = 0, warning_count = 0, lease_owner = NULL, lease_until = NULL,
                  updated_at = ?, version = version + 1
            WHERE id = ?`,
          [String(jobLevelError.message).slice(0, 1000), nowMs, jobId]
        );
        return;
      }

      for (const batch of chunk(rows, batchSize)) {
        const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
        const params = [];

        for (const row of batch) {
          params.push(
            jobId,
            row.rowNumber,
            row.operation,
            row.matchSkuId,
            row.expectedSkuVersion,
            JSON.stringify(row.normalizedPayload),
            row.status,
            row.errors.length > 0 ? JSON.stringify(row.errors) : null,
            row.warnings.length > 0 ? JSON.stringify(row.warnings) : null,
            nowMs,
            nowMs
          );
        }

        await connection.query(
          `INSERT INTO item_import_rows
             (job_id, \`row_number\`, operation, match_sku_id, expected_sku_version, normalized_payload,
              status, errors, warnings, created_at, updated_at)
           VALUES ${placeholders}`,
          params
        );
      }

      const nextStatus = counts.invalid > 0 ? "invalid" : "ready";

      await connection.execute(
        `UPDATE item_import_jobs
            SET status = ?, total_count = ?, success_count = ?, failure_count = ?, warning_count = ?,
                lease_owner = NULL, lease_until = NULL, updated_at = ?, version = version + 1
          WHERE id = ?`,
        [nextStatus, counts.total, counts.valid, counts.invalid, counts.warning, nowMs, jobId]
      );
    });
  }

  async getJob({ id }) {
    const [[row]] = await this.database.query(
      `SELECT id, file_stored_name, result_stored_name, file_sha256, template_version, mode, status,
              total_count, success_count, failure_count, skipped_count, warning_count, error_summary,
              created_by, confirmed_by, created_at, updated_at, confirmed_at, completed_at,
              files_purged_at, version
         FROM item_import_jobs
        WHERE id = ?`,
      [id]
    );

    return row ? this.#toJobSummary(row) : null;
  }

  async listRows({ jobId, page = 1, pageSize = 20, status }) {
    const conditions = ["job_id = ?"];
    const params = [jobId];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const offset = (page - 1) * pageSize;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total FROM item_import_rows ${whereClause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT job_id, \`row_number\`, operation, match_sku_id, expected_sku_version, normalized_payload,
              status, errors, warnings, created_at, updated_at
         FROM item_import_rows
         ${whereClause}
        ORDER BY \`row_number\` ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      items: rows.map((row) => this.#toRowSummary(row)),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  #toJobSummary(row) {
    return {
      id: Number(row.id),
      fileStoredName: row.file_stored_name,
      resultStoredName: row.result_stored_name,
      fileSha256: row.file_sha256,
      templateVersion: row.template_version,
      mode: row.mode,
      status: row.status,
      totalCount: Number(row.total_count),
      successCount: Number(row.success_count),
      failureCount: Number(row.failure_count),
      skippedCount: Number(row.skipped_count),
      warningCount: Number(row.warning_count),
      errorSummary: row.error_summary,
      createdBy: row.created_by === null ? null : Number(row.created_by),
      confirmedBy: row.confirmed_by === null ? null : Number(row.confirmed_by),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
      completedAt: row.completed_at === null ? null : Number(row.completed_at),
      filesPurgedAt: row.files_purged_at === null ? null : Number(row.files_purged_at),
      version: Number(row.version)
    };
  }

  #toRowSummary(row) {
    return {
      jobId: Number(row.job_id),
      rowNumber: Number(row.row_number),
      operation: row.operation,
      matchSkuId: row.match_sku_id === null ? null : Number(row.match_sku_id),
      expectedSkuVersion: row.expected_sku_version === null ? null : Number(row.expected_sku_version),
      normalizedPayload: row.normalized_payload,
      status: row.status,
      errors: row.errors ?? [],
      warnings: row.warnings ?? [],
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }
}
