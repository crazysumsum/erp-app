import { assertActorFresh } from "../authorization/directoryLookups.js";
import { removeSupplierImportFile, writeSupplierImportSource } from "../../services/supplierImport/supplierImportFiles.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierConflict, supplierImportError } from "./supplierErrors.js";
import { SUPPLIER_IMPORT_TEMPLATE_VERSION } from "./import/supplierCsvSchema.js";
import { uploadHeaderError } from "./import/SupplierImportProcessor.js";

/**
 * Supplier import 嘅狀態機同逐列執行 contract（T42；設計 §5.13、§8.8）。
 *
 * T42 定骨架：job 點樣被 worker 用 lease 領取、每一列點樣喺一個 transaction 入面同
 * Supplier 一齊 commit、做完點樣由 rows 重建統計。T43 加上載同 precheck。confirm 同
 * 真正寫 Supplier 嘅 applyRow（T45）、結果檔（T46）都唔喺度。
 *
 * 逐列 contract（設計 §8.8，唔可以拆）：
 *   1. 同一個 connection／transaction 先 `FOR UPDATE` 鎖 job 同下一列，確認 lease 仲喺自己手
 *      同該列仲未 terminal；
 *   2. `applyRow(connection, …)` 喺**同一個 transaction** 寫 Supplier aggregate 同 audit，回
 *      Supplier ID；
 *   3. 同一個 transaction 將該列改做 `applied` 同寫 `applied_supplier_id`，一次 commit。
 *   失敗就成個 transaction rollback（Supplier、audit、marker 全部冇），再用另一個短交易將仍然
 *   未 terminal 嘅列標 `failed`。所以 crash 之後重跑：commit 咗嘅列見到 applied 會跳過，未
 *   commit 嘅列乜都冇留低，可以安全重做。唔准「先 commit Supplier、之後先標 applied」。
 */
export const IMPORT_JOB_STATUSES = Object.freeze([
  "uploaded", "validating", "ready", "ready_with_errors", "queued",
  "running", "completed", "completed_with_errors", "failed", "cancelled"
]);

export const IMPORT_JOB_TRANSITIONS = Object.freeze({
  uploaded: Object.freeze(["validating", "failed", "cancelled"]),
  // validating → validating：precheck lease 過期之後由另一個 worker 重新做。
  validating: Object.freeze(["validating", "ready", "ready_with_errors", "failed"]),
  ready: Object.freeze(["queued", "cancelled"]),
  ready_with_errors: Object.freeze(["queued", "cancelled"]),
  queued: Object.freeze(["running", "failed", "cancelled"]),
  // running → running：lease 過期之後由另一個 worker 接手。
  running: Object.freeze(["running", "completed", "completed_with_errors", "failed"]),
  completed: Object.freeze([]),
  completed_with_errors: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([])
});

export const PENDING_ROW_STATUSES = Object.freeze(["valid", "warning"]);
export const TERMINAL_ROW_STATUSES = Object.freeze(["applied", "failed", "skipped"]);

export function assertJobTransition(from, to) {
  if (!IMPORT_JOB_TRANSITIONS[from]?.includes(to)) {
    throw new TypeError(`Supplier import job cannot move from ${from} to ${to}`);
  }
}

/**
 * 由 rows 計 job 統計。唯一真相係 rows：job 上面嘅 count 只係佢嘅快照，隨時可以由呢度重建。
 * `invalid` 喺執行時會變 `skipped`，所以 skipped 計埋 invalid；完成嘅 job 冇 invalid 剩。
 */
export function countsFromRows(rows) {
  const by = Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
  const n = (status) => by[status] ?? 0;
  return {
    total: Object.values(by).reduce((sum, count) => sum + count, 0),
    applied: n("applied"),
    failed: n("failed"),
    skipped: n("skipped"),
    pending: n("valid") + n("warning") + n("invalid")
  };
}

const JOB_COLUMNS = `id, mode, activation_mode, approver_user_id, approval_setting_value, approval_setting_version,
  status, total_count, lease_owner, lease_until, confirmed_by, confirmed_at, version`;
const SUMMARY_COLUMNS = `id, template_version, mode, status, total_count, valid_count, warning_count, invalid_count,
  last_error_code, error_summary, created_at, updated_at, version`;
const IMPORT_MODES = Object.freeze(["create_only", "upsert"]);
// Precheck 最多做幾次。上載時 version = 1，之後每次領取 +1（append 唔改 version），所以一個 validating
// job 已經做過 version - 1 次。夠數仍然未完成，就標 failed，唔好無止境重做（REV-064 H-1、H-2）。
export const MAX_PRECHECK_ATTEMPTS = 3;
const MAX_PRECHECK_BATCH = 1000;

/** 對外嘅 job 摘要：唔帶檔名、SHA-256、lease 或者任何路徑（T44 會加欄位）。 */
export function importJobSummary(row) {
  return {
    id: Number(row.id), templateVersion: row.template_version, mode: row.mode, status: row.status,
    totalCount: Number(row.total_count), validCount: Number(row.valid_count), warningCount: Number(row.warning_count),
    invalidCount: Number(row.invalid_count), lastErrorCode: row.last_error_code, errorSummary: row.error_summary,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), version: Number(row.version)
  };
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function assertLease(job, leaseOwner, nowMs, status = "running") {
  if (!job || job.status !== status || job.lease_owner !== leaseOwner || job.lease_until === null ||
      Number(job.lease_until) < nowMs) {
    throw supplierConflict("SUPPLIER_IMPORT_LEASE_LOST", "匯入工作已由其他處理程序接手");
  }
}

/**
 * 列嘅錯誤：domain 錯誤（Supplier 驗證、衝突）留佢嘅公開 code 同訊息，其餘一律係固定嘅一對。
 * `withTransaction` 會將 SQL 錯誤、TypeError 等包成 `INTERNAL_SERVER_ERROR`，嗰個英文訊息同
 * 內部 message（可能帶 CSV 或 SQL 值）都唔可以落入結果（REV-061 M-1）。
 */
const GENERIC_PUBLIC_CODES = new Set(["INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE"]);
function rowError(error) {
  const code = error?.publicCode;
  return !code || GENERIC_PUBLIC_CODES.has(code)
    ? [{ code: "SUPPLIER_IMPORT_ROW_FAILED", message: "匯入資料列處理失敗" }]
    : [{ code: String(code), message: String(error.publicMessage) }];
}

/**
 * 交俾 applyRow 嘅 connection 只准資料語句（REV-061 M-3，REV-062 M-4）。
 *
 * 白名單，唔係黑名單：黑名單版本俾註解（`/* x *\/ COMMIT`）、`/*!COMMIT*\/`、`CALL`、
 * `PREPARE`/`EXECUTE`、`ANALYZE` 等等繞過咗，而 `SET @@autocommit = 0`、`SET foreign_key_checks`
 * 仲會留喺 pool 嘅 connection 上面害到之後嘅 transaction。所以：剝走開頭嘅註解，第一個字一定要係
 * SELECT／INSERT／UPDATE／DELETE／REPLACE／WITH；任何 `/*!`（MySQL 會執行嘅註解）同
 * `INTO OUTFILE／DUMPFILE` 一律拒絕。
 *
 * 呢個擋唔到 applyRow 另外開 `database.withTransaction`（第二條 connection）：現有嘅 Supplier
 * service method 全部都係咁，T45 一定要用收 connection 嘅 helper，見 carry-forward。
 */
const LEADING_COMMENTS = /^(?:\s+|\/\*(?!!)[\s\S]*?\*\/|--(?:[ \t][^\n]*)?(?:\n|$)|#[^\n]*(?:\n|$))*/u;
const ROW_STATEMENT = /^(?:select|insert|update|delete|replace|with)\b/iu;
export function assertRowStatement(sql) {
  const text = typeof sql === "string" ? sql : "";
  if (!ROW_STATEMENT.test(text.replace(LEADING_COMMENTS, "")) || text.includes("/*!") ||
      // 註解可以夾喺 INTO 同 OUTFILE 中間（`INTO/**/OUTFILE`，REV-063 I-22），所以先剷走註解再睇。
      /\binto\s+(?:outfile|dumpfile)\b/iu.test(text.replace(/\/\*[\s\S]*?\*\//gu, " "))) {
    // code 令 log 分得出「守衛拒絕」同其他 TypeError（REV-063 L-9）。
    throw Object.assign(new TypeError("applyRow may only run SELECT, INSERT, UPDATE, DELETE, REPLACE or WITH on its connection"),
      { code: "SUPPLIER_IMPORT_STATEMENT_REFUSED" });
  }
}
function rowConnection(connection) {
  const guard = (method) => (sql, ...rest) => {
    assertRowStatement(sql);
    return connection[method](sql, ...rest);
  };
  return { query: guard("query"), execute: guard("execute") };
}

export class SupplierImportService {
  constructor({ database, time, logger = null, authorize = assertActorFresh, audit } = {}) {
    if (!database || !time) throw new TypeError("SupplierImportService requires database and time");
    this.database = database;
    this.time = time;
    this.logger = logger;
    this.authorize = authorize;
    // SupplierAuditLogService.record 唔用 logger；worker 單元測試冇 logger 都要建到。
    this.audit = audit ?? new SupplierAuditLogService({ database, logger: logger ?? {}, time });
  }

  /**
   * 上載（T43）：先將檔寫入 `<root>/source`（名由 server 產生），再喺一個 transaction 入面驗
   * actor、插 job（uploaded）同寫 audit。插唔到就刪返個檔。兩步之間 crash 會留低一個冇 job
   * 指住嘅檔 —— T48 嘅清理要一併刪（HD-050、HD-044）。重送由 route idempotency 處理。
   */
  async createFromUpload({ actorId, claimedRoles, claimedPermissions, root, mode, content, maxFileBytes, requestId = "", ip = "" }) {
    if (!root) throw supplierImportError("SUPPLIER_IMPORT_UNAVAILABLE", 503, "供應商匯入功能目前未啟用");
    if (!IMPORT_MODES.includes(mode)) throw invalidSupplierInput("SUPPLIER_IMPORT_MODE_INVALID", "匯入模式必須是 create_only 或 upsert");
    if (!Buffer.isBuffer(content) || content.length === 0) {
      throw invalidSupplierInput("SUPPLIER_IMPORT_FILE_REQUIRED", "請選擇一個非空白的 CSV 檔案");
    }
    if (content.length > maxFileBytes) throw supplierImportError("SUPPLIER_IMPORT_FILE_TOO_LARGE", 413, "CSV 檔案超過大小上限");
    // Header 有問題（包括 Bank 欄）嘅檔一個 byte 都唔落磁碟（HD-053 A、HD-054 A；REV-064 M-1、REV-065 M-1）。
    const headerProblem = uploadHeaderError(content);
    if (headerProblem) throw invalidSupplierInput(headerProblem.code, headerProblem.message);
    const stored = await writeSupplierImportSource(root, content);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
        const nowMs = this.time.nowMs();
        const [inserted] = await connection.execute(
          `INSERT INTO supplier_import_jobs
             (template_version, source_stored_name, source_sha256, mode, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?)`,
          [SUPPLIER_IMPORT_TEMPLATE_VERSION, stored.storedName, stored.sha256, mode, actorId, nowMs, nowMs]
        );
        const jobId = Number(inserted.insertId);
        await this.audit.record(connection, {
          actorUserId: actorId, actorUsername: actor.username, action: "import.upload", targetType: "import",
          targetId: jobId, targetLabel: `import-${jobId}`,
          detail: { after: { mode, templateVersion: SUPPLIER_IMPORT_TEMPLATE_VERSION } }, requestId, ip
        });
        const [[job]] = await connection.query(`SELECT ${SUMMARY_COLUMNS} FROM supplier_import_jobs WHERE id = ?`, [jobId]);
        return importJobSummary(job);
      });
    } catch (error) {
      // 刪唔到就記低（冇內容），等人或者 T48 清理（REV-064 L-1）。
      await removeSupplierImportFile(root, "source", stored.storedName).catch((cleanupError) => {
        void this.logger?.error?.("supplier.import.source_cleanup_failed", "Supplier import source could not be removed after a failed upload",
          { storedName: stored.storedName, code: cleanupError?.code ?? null });
      });
      throw error;
    }
  }

  /**
   * 領取一個要 precheck 嘅 job：`uploaded`，或者 `validating` 但 lease 過期。上一次做到一半
   * 寫低嘅 rows 喺同一個 transaction 刪走，所以重做一定由頭開始。
   */
  async claimForPrecheck({ leaseOwner, leaseDurationMs }) {
    if (!String(leaseOwner ?? "").trim() || !positiveInteger(leaseDurationMs)) {
      throw new TypeError("Supplier import lease is invalid");
    }
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[job]] = await connection.query(
        `SELECT id, mode, status, source_stored_name, source_sha256, created_by, version FROM supplier_import_jobs
          WHERE status = 'uploaded' OR (status = 'validating' AND (lease_until IS NULL OR lease_until < ?))
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [nowMs]
      );
      if (!job) return null;
      if (job.status === "validating" && Number(job.version) - 1 >= MAX_PRECHECK_ATTEMPTS) {
        assertJobTransition(job.status, "failed");
        await connection.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [job.id]);
        await connection.execute(
          `UPDATE supplier_import_jobs SET status = 'failed', last_error_code = 'SUPPLIER_IMPORT_PRECHECK_FAILED',
                  error_summary = '預檢多次未能完成，請檢查檔案後重新上載或聯絡系統管理員', lease_owner = '', lease_until = NULL,
                  files_purged_at = ?, completed_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?`,
          [nowMs, nowMs, nowMs, job.id]
        );
        await this.#recordPrecheckAudit(connection, job, { after: { status: "failed", errorCode: "SUPPLIER_IMPORT_PRECHECK_FAILED" } });
        void this.logger?.error?.("supplier.import.precheck_abandoned", "Supplier import precheck failed too often and was abandoned",
          { jobId: Number(job.id), attempts: Number(job.version) - 1 });
        // 失敗嘅 job 冇結果可以下載：來源檔即刻刪（HD-053 A）。呢度冇 root，交返 worker 刪。
        return { id: Number(job.id), abandoned: true, sourceStoredName: job.source_stored_name };
      }
      assertJobTransition(job.status, "validating");
      await connection.execute(
        `UPDATE supplier_import_jobs SET status = 'validating', lease_owner = ?, lease_until = ?,
                updated_at = ?, version = version + 1
          WHERE id = ?`,
        [leaseOwner, nowMs + leaseDurationMs, nowMs, job.id]
      );
      await connection.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [job.id]);
      return {
        id: Number(job.id), mode: job.mode, sourceStoredName: job.source_stored_name,
        sourceSha256: Buffer.from(job.source_sha256), resumed: job.status === "validating"
      };
    });
  }

  /** Precheck 嘅 audit 記喺上載者名下（precheck 冇 request actor）。 */
  async #recordPrecheckAudit(connection, job, detail) {
    const [[user]] = job.created_by === null
      ? [[null]]
      : await connection.query("SELECT username FROM users WHERE id = ?", [job.created_by]);
    await this.audit.record(connection, {
      actorUserId: job.created_by, actorUsername: user?.username ?? "", action: "import.precheck",
      targetType: "import", targetId: Number(job.id), targetLabel: `import-${job.id}`, detail
    });
  }

  /** 寫一批 precheck 結果，順手續 lease。 */
  async appendPrecheckRows({ jobId, leaseOwner, leaseDurationMs, rows }) {
    if (!positiveInteger(jobId) || !positiveInteger(leaseDurationMs) || !Array.isArray(rows) ||
        rows.length < 1 || rows.length > MAX_PRECHECK_BATCH) {
      throw new TypeError("Supplier import precheck batch is invalid");
    }
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[job]] = await connection.query(`SELECT ${JOB_COLUMNS} FROM supplier_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      assertLease(job, leaseOwner, nowMs, "validating");
      await connection.query(
        `INSERT INTO supplier_import_rows
           (job_id, \`row_number\`, operation, match_supplier_id, expected_supplier_version, normalized_payload,
            status, errors, warnings, created_at, updated_at)
         VALUES ?`,
        [rows.map((row) => [
          jobId, row.rowNumber, row.operation, row.matchSupplierId, row.expectedSupplierVersion,
          JSON.stringify(row.normalizedPayload), row.status, JSON.stringify(row.errors), JSON.stringify(row.warnings), nowMs, nowMs
        ])]
      );
      await connection.execute(
        "UPDATE supplier_import_jobs SET lease_until = ?, updated_at = ? WHERE id = ?",
        [nowMs + leaseDurationMs, nowMs, jobId]
      );
    });
  }

  /**
   * 收尾：成個檔有問題就刪走 rows、標 failed、記原因同 `files_purged_at`（來源檔由 worker 即刻刪，HD-053 A）；
   * 否則由 rows 計統計（唯一真相係 rows），
   * 有 invalid 就 ready_with_errors。`total_count` 喺呢度定，T45 finalize 會用佢對數（HD-049）。
   */
  async completePrecheck({ jobId, leaseOwner, jobLevelError = null }) {
    if (!positiveInteger(jobId)) throw new TypeError("Supplier import precheck completion input is invalid");
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[job]] = await connection.query(
        `SELECT ${JOB_COLUMNS}, created_by FROM supplier_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      assertLease(job, leaseOwner, nowMs, "validating");
      let detail;
      if (jobLevelError) {
        assertJobTransition(job.status, "failed");
        await connection.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [jobId]);
        await connection.execute(
          `UPDATE supplier_import_jobs SET status = 'failed', total_count = 0, valid_count = 0, warning_count = 0,
                  invalid_count = 0, last_error_code = ?, error_summary = ?, lease_owner = '', lease_until = NULL,
                  files_purged_at = ?, completed_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?`,
          [String(jobLevelError.code).slice(0, 80), String(jobLevelError.message).slice(0, 500), nowMs, nowMs, nowMs, jobId]
        );
        detail = { after: { status: "failed", errorCode: String(jobLevelError.code) } };
      } else {
        const [grouped] = await connection.query(
          "SELECT status, COUNT(*) AS total FROM supplier_import_rows WHERE job_id = ? GROUP BY status", [jobId]);
        const by = Object.fromEntries(grouped.map((row) => [row.status, Number(row.total)]));
        const counts = { valid: by.valid ?? 0, warning: by.warning ?? 0, invalid: by.invalid ?? 0 };
        const total = counts.valid + counts.warning + counts.invalid;
        if (total === 0 || total !== grouped.reduce((sum, row) => sum + Number(row.total), 0)) {
          throw new TypeError("Supplier import precheck rows are missing or in an unexpected status");
        }
        const status = counts.invalid > 0 ? "ready_with_errors" : "ready";
        assertJobTransition(job.status, status);
        await connection.execute(
          `UPDATE supplier_import_jobs SET status = ?, total_count = ?, valid_count = ?, warning_count = ?,
                  invalid_count = ?, last_error_code = '', error_summary = '', lease_owner = '', lease_until = NULL,
                  updated_at = ?, version = version + 1
            WHERE id = ?`,
          [status, total, counts.valid, counts.warning, counts.invalid, nowMs, jobId]
        );
        detail = { after: { status, totalCount: total, validCount: counts.valid, warningCount: counts.warning, invalidCount: counts.invalid } };
      }
      await this.#recordPrecheckAudit(connection, job, detail);
      const [[summary]] = await connection.query(`SELECT ${SUMMARY_COLUMNS} FROM supplier_import_jobs WHERE id = ?`, [jobId]);
      return importJobSummary(summary);
    });
  }

  /**
   * 領取一個 job：`queued`，或者 `running` 但 lease 已經過期（上一個 worker 死咗）。最早
   * confirm 嘅先做。領取嗰陣順手將 `invalid` 列標做 `skipped` —— 佢哋唔會執行，但要計入結果。
   */
  async claimForExecution({ leaseOwner, leaseDurationMs }) {
    if (!String(leaseOwner ?? "").trim() || !positiveInteger(leaseDurationMs)) {
      throw new TypeError("Supplier import lease is invalid");
    }
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[job]] = await connection.query(
        `SELECT ${JOB_COLUMNS} FROM supplier_import_jobs
          WHERE status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until < ?))
          ORDER BY confirmed_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [nowMs]
      );
      if (!job) return null;
      // 冇確認人或確認時間嘅 queued job 唔應該存在（T45 要用確認人再驗權限），亦唔可以因為
      // NULL 排最前而插隊（REV-061 L-3）：直接標 failed，唔好靜靜雞卡住。
      if (job.status === "queued" && (job.confirmed_by === null || job.confirmed_at === null)) {
        assertJobTransition(job.status, "failed");
        await connection.execute(
          `UPDATE supplier_import_jobs SET status = 'failed', last_error_code = 'SUPPLIER_IMPORT_NOT_CONFIRMED',
                  error_summary = '匯入工作缺少確認資料', completed_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?`,
          [nowMs, nowMs, job.id]
        );
        // 最常見嘅原因係確認人個 user 俾人刪咗（confirmed_by 係 ON DELETE SET NULL）。留低記錄（REV-062 I-17）。
        void this.logger?.error?.("supplier.import.not_confirmed", "Supplier import job has no confirmer and was failed",
          { jobId: Number(job.id) });
        return null;
      }
      assertJobTransition(job.status, "running");
      await connection.execute(
        `UPDATE supplier_import_rows SET status = 'skipped', completed_at = ?, updated_at = ?
          WHERE job_id = ? AND status = 'invalid'`,
        [nowMs, nowMs, job.id]
      );
      await connection.execute(
        `UPDATE supplier_import_jobs SET status = 'running', lease_owner = ?, lease_until = ?,
                updated_at = ?, version = version + 1
          WHERE id = ?`,
        [leaseOwner, nowMs + leaseDurationMs, nowMs, job.id]
      );
      return { id: Number(job.id), resumed: job.status === "running" };
    });
  }

  /**
   * 處理下一列（按 row_number）。回 `null` 即係冇未處理嘅列。`applyRow` 一定要喺收到嘅
   * connection 上面寫 Supplier 同 audit，並回 Supplier ID。
   */
  async processNextRow({ jobId, leaseOwner, leaseDurationMs, applyRow }) {
    if (!positiveInteger(jobId) || !String(leaseOwner ?? "").trim() || !positiveInteger(leaseDurationMs) ||
        typeof applyRow !== "function") {
      throw new TypeError("Supplier import execution input is invalid");
    }
    let rowNumber = null;
    try {
      return await this.database.withTransaction(async (connection) => {
        const nowMs = this.time.nowMs();
        const [[job]] = await connection.query(
          `SELECT ${JOB_COLUMNS} FROM supplier_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
        assertLease(job, leaseOwner, nowMs);
        const [[row]] = await connection.query(
          `SELECT job_id, \`row_number\`, operation, match_supplier_id, expected_supplier_version,
                  normalized_payload, status, warnings
             FROM supplier_import_rows
            WHERE job_id = ? AND status IN ('valid', 'warning')
            ORDER BY \`row_number\` LIMIT 1 FOR UPDATE`,
          [jobId]
        );
        if (!row) return null;
        rowNumber = Number(row.row_number);
        const appliedSupplierId = Number(await applyRow(rowConnection(connection), { job, row, nowMs }));
        if (!positiveInteger(appliedSupplierId)) {
          throw Object.assign(new TypeError("applyRow must return the Supplier ID it wrote"),
            { code: "SUPPLIER_IMPORT_NO_SUPPLIER_ID" });
        }
        const [marked] = await connection.execute(
          `UPDATE supplier_import_rows SET status = 'applied', applied_supplier_id = ?,
                  started_at = COALESCE(started_at, ?), completed_at = ?, updated_at = ?
            WHERE job_id = ? AND \`row_number\` = ? AND status IN ('valid', 'warning')`,
          [appliedSupplierId, nowMs, nowMs, nowMs, jobId, rowNumber]
        );
        if (marked.affectedRows !== 1) {
          throw supplierConflict("SUPPLIER_IMPORT_ROW_STATE_CONFLICT", "匯入資料列狀態已變更");
        }
        await connection.execute(
          "UPDATE supplier_import_jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND lease_owner = ?",
          [nowMs + leaseDurationMs, nowMs, jobId, leaseOwner]
        );
        return { rowNumber, status: "applied", appliedSupplierId };
      });
    } catch (error) {
      // 未揀到列（lease 冇咗、job 唔見咗）就唔係「呢一列失敗」，照拋。
      if (rowNumber === null) throw error;
      return this.database.withTransaction(async (connection) => {
        const nowMs = this.time.nowMs();
        const [[job]] = await connection.query(
          `SELECT ${JOB_COLUMNS} FROM supplier_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
        assertLease(job, leaseOwner, nowMs);
        const [marked] = await connection.execute(
          `UPDATE supplier_import_rows SET status = 'failed', errors = ?, started_at = COALESCE(started_at, ?),
                  completed_at = ?, updated_at = ?
            WHERE job_id = ? AND \`row_number\` = ? AND status IN ('valid', 'warning')`,
          [JSON.stringify(rowError(error)), nowMs, nowMs, nowMs, jobId, rowNumber]
        );
        await connection.execute(
          "UPDATE supplier_import_jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND lease_owner = ?",
          [nowMs + leaseDurationMs, nowMs, jobId, leaseOwner]
        );
        // 真係標咗先記：lease 冇咗嘅話上面已經拋出，嗰列留俾新 owner（REV-062 I-18）。記原因但唔帶
        // message —— 佢可能有 CSV 或 SQL 值（REV-061 M-1）；causeName 分得出 TypeError 同守衛拒絕（L-6）。
        if (marked.affectedRows === 1) {
          void this.logger?.error?.("supplier.import.failed", "Supplier import row failed", {
            jobId, rowNumber, name: error?.name ?? "Error", code: error?.code ?? null,
            causeCode: error?.cause?.code ?? null, causeName: error?.cause?.name ?? null, publicCode: error?.publicCode ?? null
          });
        }
        return { rowNumber, status: marked.affectedRows === 1 ? "failed" : "unchanged", appliedSupplierId: null };
      });
    }
  }

  /** 所有列都 terminal 之後，由 rows 重建統計，收尾做 completed 或 completed_with_errors。 */
  async finalizeExecution({ jobId, leaseOwner }) {
    if (!positiveInteger(jobId) || !String(leaseOwner ?? "").trim()) {
      throw new TypeError("Supplier import finalization input is invalid");
    }
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[job]] = await connection.query(
        `SELECT ${JOB_COLUMNS} FROM supplier_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      assertLease(job, leaseOwner, nowMs);
      const counts = countsFromRows((await connection.query(
        "SELECT status, COUNT(*) AS total FROM supplier_import_rows WHERE job_id = ? GROUP BY status", [jobId]))[0]);
      if (counts.pending > 0) {
        throw supplierConflict("SUPPLIER_IMPORT_ROWS_PENDING", "匯入仍有資料列尚未處理");
      }
      // precheck 定咗 total_count；rows 對唔上即係有列喺 precheck 之後被加或者刪咗（HD-049，
      // REV-061 I-13）。唔可以報 completed：標 failed 同記錄，等人查。
      if (counts.total !== Number(job.total_count)) {
        assertJobTransition(job.status, "failed");
        await connection.execute(
          `UPDATE supplier_import_jobs SET status = 'failed', applied_count = ?, failed_count = ?, skipped_count = ?,
                  last_error_code = 'SUPPLIER_IMPORT_COUNT_MISMATCH', error_summary = '匯入資料列數目與預檢不一致',
                  lease_owner = '', lease_until = NULL, completed_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?`,
          [counts.applied, counts.failed, counts.skipped, nowMs, nowMs, jobId]
        );
        void this.logger?.error?.("supplier.import.count_mismatch", "Supplier import rows do not match the precheck total",
          { jobId, expected: Number(job.total_count), actual: counts.total });
        return { id: jobId, status: "failed", ...counts };
      }
      const status = counts.failed > 0 ? "completed_with_errors" : "completed";
      assertJobTransition(job.status, status);
      await connection.execute(
        `UPDATE supplier_import_jobs SET status = ?, applied_count = ?, failed_count = ?, skipped_count = ?,
                lease_owner = '', lease_until = NULL, completed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ?`,
        [status, counts.applied, counts.failed, counts.skipped, nowMs, nowMs, jobId]
      );
      return { id: jobId, status, ...counts };
    });
  }
}
