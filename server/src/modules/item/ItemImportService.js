/**
 * Import Job／Row 的持久層操作：upload 建 job、claim job 做 validation／
 * execution、confirm／cancel、寫入結果、產生結果 CSV、查詢 job／row。設計
 * 說明見 docs/items_management/design_spec.md §5.13、§6.9、§8.6。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——同 ItemAdminService／
 * ItemCatalogService 一路以嚟嘅慣例一致。
 */
import { stringify } from "csv-stringify/sync";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  importFileExpired,
  importJobNotFound,
  importNotReady,
  importStateConflict
} from "./itemErrors.js";
import { sanitizeCsvCell } from "./csvSafety.js";
import { ItemAuditLogService } from "./ItemAuditLogService.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";

const CANCELLABLE_STATUSES = Object.freeze(["uploaded", "ready", "queued"]);
const RESULT_CSV_COLUMNS = Object.freeze(["rowNumber", "skuCode", "operation", "status", "errors", "warnings"]);

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

/** `{field,code,message}` 陣列壓成一個人讀得嘅單行字串，俾結果 CSV 用。 */
function issuesToText(issues) {
  return issues.map((issue) => `${issue.field}:${issue.code}:${issue.message}`).join(" | ");
}

export class ItemImportService {
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("ItemImportService requires database, logger and time");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
    this.auditLog = new ItemAuditLogService({ database, logger, time });
  }

  /** 對應 `POST /api/v1/item-imports/upload`（T29）：upload middleware 已經
   * 完成 content-signature 驗證並落盤，呢度純粹寫一筆 `uploaded` 狀態嘅
   * job row。 */
  async createJobFromUpload({ actorId, claimedRoles, claimedPermissions, fileStoredName, fileSha256, templateVersion, mode }) {
    return this.database.withTransaction(async (connection) => {
      await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `INSERT INTO item_import_jobs
           (file_stored_name, file_sha256, template_version, mode, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?)`,
        [fileStoredName, fileSha256, templateVersion, mode, actorId, nowMs, nowMs]
      );

      return this.#requireJob(connection, result.insertId);
    });
  }

  async listJobs({ actorId, claimedRoles, claimedPermissions, page = 1, pageSize = 20, status }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * pageSize;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total FROM item_import_jobs ${whereClause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT id, file_stored_name, result_stored_name, file_sha256, template_version, mode, status,
              total_count, success_count, failure_count, skipped_count, warning_count, error_summary,
              created_by, confirmed_by, created_at, updated_at, confirmed_at, completed_at,
              files_purged_at, version
         FROM item_import_jobs
         ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      items: rows.map((row) => this.#toJobSummary(row)),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  /**
   * 對應 `POST /api/v1/item-imports/:id/confirm`：只有 `ready` job 先可以
   * confirm，`version` compare-and-set 防止喺使用者睇緊個 preflight 結果嗰陣
   * 俾第三者搶先改咗（例如另一個管理員取消咗個 job）。轉 `queued`，寫低
   * `confirmed_by／confirmed_at`，audit 記一筆 `item.import`——design_spec
   * §8.7 淨係得呢一個 action 代表成個匯入流程，confirm 係使用者真正觸發嘅
   * 決定性動作，寫喺呢一步而唔係 upload（upload 只係準備資料，仲未決定要
   * 真係套用）。
   */
  async confirmJob({ actorId, claimedRoles, claimedPermissions, id, version, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireJob(connection, id);

      if (current.status !== "ready") {
        throw importNotReady();
      }
      if (current.version !== version) {
        throw importStateConflict();
      }

      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `UPDATE item_import_jobs
            SET status = 'queued', confirmed_by = ?, confirmed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND status = 'ready'`,
        [actorId, nowMs, nowMs, id, version]
      );

      if (result.affectedRows === 0) {
        // 兩條 WHERE 條件（status／version）之間嘅競態窗口：上面已經讀過一次
        // 現況，呢度用 UPDATE 本身嘅 affectedRows 做最終防線，唔信之前嗰次讀。
        throw importStateConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "item.import",
        targetType: "import",
        targetId: id,
        targetLabel: current.fileStoredName,
        detail: { mode: current.mode, totalCount: current.totalCount, fileSha256: current.fileSha256 },
        reason,
        requestId,
        ip
      });

      return this.#requireJob(connection, id);
    });
  }

  /** 對應 `POST /api/v1/item-imports/:id/cancel`：只有 `uploaded／ready／
   * queued` 可以取消——`validating／running` 代表 worker 正在處理緊，冇安全
   * 嘅方式喺中途打斷；已完結嘅狀態（`completed／failed／cancelled`）冚唔
   * 使再取消。 */
  async cancelJob({ actorId, claimedRoles, claimedPermissions, id }) {
    return this.database.withTransaction(async (connection) => {
      await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireJob(connection, id);

      if (!CANCELLABLE_STATUSES.includes(current.status)) {
        throw importNotReady();
      }

      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE item_import_jobs
            SET status = 'cancelled', updated_at = ?, version = version + 1
          WHERE id = ? AND status = ?`,
        [nowMs, id, current.status]
      );

      return this.#requireJob(connection, id);
    });
  }

  /**
   * 原子攞一個 `queued` job 嚟做 execution：同
   * `claimNextUploadedJobForValidation()` 同一個 compare-and-set＋lease
   * 手法，理由一致。
   */
  async claimNextQueuedJobForExecution({ leaseOwner, leaseDurationMs }) {
    return this.database.withTransaction(async (connection) => {
      const [[job]] = await connection.query(
        `SELECT id, mode, created_by, version
           FROM item_import_jobs
          WHERE status = 'queued'
          ORDER BY confirmed_at ASC
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
            SET status = 'running', lease_owner = ?, lease_until = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ?`,
        [leaseOwner, leaseUntil, nowMs, job.id, job.version]
      );

      return {
        id: job.id,
        mode: job.mode,
        createdBy: job.created_by === null ? null : Number(job.created_by)
      };
    });
  }

  /** 攞返呢個 job 要套用嘅 row（`valid`／`warning`，`invalid` 唔會出現——
   * job 淨係喺全部列都冇 invalid 先會轉 `ready`，先至有得 confirm）。 */
  async listValidRowsForExecution({ jobId }) {
    const [rows] = await this.database.query(
      `SELECT \`row_number\`, operation, match_sku_id, expected_sku_version, normalized_payload
         FROM item_import_rows
        WHERE job_id = ? AND status IN ('valid', 'warning')
        ORDER BY \`row_number\` ASC`,
      [jobId]
    );

    return rows.map((row) => ({
      rowNumber: Number(row.row_number),
      operation: row.operation,
      matchSkuId: row.match_sku_id === null ? null : Number(row.match_sku_id),
      expectedSkuVersion: row.expected_sku_version === null ? null : Number(row.expected_sku_version),
      normalizedPayload: row.normalized_payload
    }));
  }

  /**
   * Execution 完成之後、用一個獨立嘅短交易更新 job 狀態——同套用商品變更嗰個
   * transaction 分開，確保「商品變更 rollback 咗」同「job 狀態更新成功」呢
   * 兩件事唔會綁死喺同一個 all-or-nothing 單位入面（design_spec §5.13：
   * 「Worker 捕捉失敗後，另開短交易把 Job 記為 failed，確保狀態更新不會跟
   * 商品交易一起 rollback」）。 */
  /**
   * `appliedRowNumbers`／`failedRow` 同 job 狀態一齊喺呢個短交易更新
   * `item_import_rows.status`：preflight 得出嘅 valid／warning 只代表「執行
   * 之前睇落冇問題」，執行完成之後一定要覆寫做 applied／failed，等 row 逐列
   * 結果（詳情頁、結果 CSV）反映返真正套用咗嘅結果，唔係停留喺過時嘅
   * preflight 判斷（design_spec §5.13 row status 定義含 applied／failed）。
   * 全有全無：失敗淨係嗰一 row 標 failed 並帶失敗原因，其餘 row 保持原本
   * preflight 狀態——佢哋本身冇問題，令成批 rollback 嘅係另一 row。
   */
  async recordExecutionResult({ jobId, status, successCount, failureCount, errorSummary, appliedRowNumbers = [], failedRow = null }) {
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE item_import_jobs
            SET status = ?, success_count = ?, failure_count = ?, error_summary = ?,
                lease_owner = NULL, lease_until = NULL, completed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ?`,
        [status, successCount, failureCount, errorSummary ? String(errorSummary).slice(0, 1000) : null, nowMs, nowMs, jobId]
      );

      if (appliedRowNumbers.length > 0) {
        await connection.query(
          "UPDATE item_import_rows SET status = 'applied', updated_at = ? WHERE job_id = ? AND `row_number` IN (?)",
          [nowMs, jobId, appliedRowNumbers]
        );
      }

      if (failedRow) {
        const [[current]] = await connection.query(
          "SELECT errors FROM item_import_rows WHERE job_id = ? AND `row_number` = ?",
          [jobId, failedRow.rowNumber]
        );
        const errors = [...(current?.errors ?? []), { field: null, code: "EXECUTION_FAILED", message: failedRow.message }];
        await connection.execute(
          "UPDATE item_import_rows SET status = 'failed', errors = ?, updated_at = ? WHERE job_id = ? AND `row_number` = ?",
          [JSON.stringify(errors), nowMs, jobId, failedRow.rowNumber]
        );
      }
    });
  }

  /**
   * 產生結果 CSV：喺 validation／execution 完成之後都會叫一次，等使用者隨時
   * 都下載到最新狀態（preflight 錯誤，或者 execution 完成之後嘅最終結果）。
   * 檔名同 media／來源 CSV 一樣係伺服器生成，`result_stored_name` 有
   * UNIQUE key，重新產生時直接覆蓋返個 job 現時指住嗰個名（唔留舊檔案喺度
   * 靠人手清）。
   */
  async writeResultFile({ jobId, importDirectory }) {
    const [rows] = await this.database.query(
      "SELECT `row_number`, operation, status, normalized_payload, errors, warnings FROM item_import_rows WHERE job_id = ? ORDER BY `row_number` ASC",
      [jobId]
    );

    // skuCode 係使用者上傳嗰份 CSV 入面嘅原始內容，寫返出去之前一定要用
    // sanitizeCsvCell()——理由見 csvSafety.js（CSV／formula injection）。
    const records = rows.map((row) => ({
      rowNumber: row.row_number,
      skuCode: sanitizeCsvCell(row.normalized_payload?.skuCode ?? ""),
      operation: row.operation,
      status: row.status,
      errors: issuesToText(row.errors ?? []),
      warnings: issuesToText(row.warnings ?? [])
    }));

    const csvText = stringify(records, { header: true, columns: [...RESULT_CSV_COLUMNS] });
    const storedName = `${randomUUID()}.csv`;
    await writeFile(path.join(importDirectory, storedName), csvText, "utf8");

    const nowMs = this.time.nowMs();
    await this.database.execute(
      "UPDATE item_import_jobs SET result_stored_name = ?, updated_at = ? WHERE id = ?",
      [storedName, nowMs, jobId]
    );

    return { storedName, sha256: createHash("sha256").update(csvText).digest("hex") };
  }

  /**
   * 對應 `GET /api/v1/item-imports/:id/result`：檔案已經按 1 年保留期限被
   * `ItemImportFileCleanupJob`（未編號嘅後續 task）清走就回 410
   * `IMPORT_FILE_EXPIRED`，但 Job summary 本身唔受影響、仍然查得到——見
   * design_spec §6.11 對呢個狀態碼嘅定義。
   */
  async resolveResultDownload({ id }) {
    const job = await this.getJob({ id });
    if (!job) {
      throw importJobNotFound(id);
    }
    if (job.filesPurgedAt !== null) {
      throw importFileExpired();
    }
    if (!job.resultStoredName) {
      throw importJobNotFound(id);
    }
    return { storedName: job.resultStoredName };
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

  async #requireJob(queryable, id) {
    const [[row]] = await queryable.query(
      `SELECT id, file_stored_name, result_stored_name, file_sha256, template_version, mode, status,
              total_count, success_count, failure_count, skipped_count, warning_count, error_summary,
              created_by, confirmed_by, created_at, updated_at, confirmed_at, completed_at,
              files_purged_at, version
         FROM item_import_jobs
        WHERE id = ?`,
      [id]
    );

    if (!row) {
      throw importJobNotFound(id);
    }

    return this.#toJobSummary(row);
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
