import { assertActorFresh, loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { removeSupplierImportFile, writeSupplierImportSource } from "../../services/supplierImport/supplierImportFiles.js";
import { SupplierApprovalService } from "./SupplierApprovalService.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierConflict, supplierImportError } from "./supplierErrors.js";
import { buildSupplierImportResult, SUPPLIER_IMPORT_TEMPLATE_VERSION } from "./import/supplierCsvSchema.js";
import { uploadHeaderError } from "./import/SupplierImportProcessor.js";

/**
 * Supplier import 嘅狀態機同逐列執行 contract（T42；設計 §5.13、§8.8）。
 *
 * T42 定骨架：job 點樣被 worker 用 lease 領取、每一列點樣喺一個 transaction 入面同
 * Supplier 一齊 commit、做完點樣由 rows 重建統計。T43 加上載同 precheck，T44 加 list／get／cancel。confirm 同
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
const SUMMARY_COLUMNS = `id, template_version, mode, activation_mode, status, total_count, valid_count, warning_count,
  invalid_count, applied_count, failed_count, skipped_count, last_error_code, error_summary, created_at, updated_at,
  confirmed_at, completed_at, files_purged_at, version`;
const IMPORT_MODES = Object.freeze(["create_only", "upsert"]);
// Precheck 最多做幾次。上載時 version = 1，之後每次領取 +1（append 唔改 version），所以一個 validating
// job 已經做過 version - 1 次。夠數仍然未完成，就標 failed，唔好無止境重做（REV-064 H-1、H-2）。
export const MAX_PRECHECK_ATTEMPTS = 3;
const MAX_PRECHECK_BATCH = 1000;

const nullableNumber = (value) => (value === null ? null : Number(value));

/**
 * 對外嘅 job 摘要：唔帶檔名、SHA-256、lease 或者任何路徑。`filesPurged` 話俾 client 知來源／結果檔
 * 已經冇咗（預檢失敗、取消或者到期清理）；檔案下載同 410 係 T46 嘅（HD-058 4A）。
 */
export function importJobSummary(row) {
  return {
    id: Number(row.id), templateVersion: row.template_version, mode: row.mode, activationMode: row.activation_mode,
    status: row.status, totalCount: Number(row.total_count), validCount: Number(row.valid_count),
    warningCount: Number(row.warning_count), invalidCount: Number(row.invalid_count), appliedCount: Number(row.applied_count),
    failedCount: Number(row.failed_count), skippedCount: Number(row.skipped_count), lastErrorCode: row.last_error_code,
    errorSummary: row.error_summary, filesPurged: row.files_purged_at !== null, createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at), confirmedAt: nullableNumber(row.confirmed_at), completedAt: nullableNumber(row.completed_at),
    version: Number(row.version)
  };
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export const IMPORT_ROW_STATUSES = Object.freeze(["valid", "warning", "invalid", "applied", "failed", "skipped"]);
// 取消只限未開始預檢或執行嘅 job（HD-058 2A）：validating 要等預檢做完，running 之後已經寫緊 Supplier。
export const CANCELLABLE_JOB_STATUSES = Object.freeze(["uploaded", "ready", "ready_with_errors", "queued"]);
const CONFIRMABLE_JOB_STATUSES = Object.freeze(["ready", "ready_with_errors"]);
// 有結果可以下載嘅 job（HD-063 2A）：做完嘅，加上已經開始執行但收尾失敗嘅（確認人失權、統計對唔上）——
// 佢哋已經寫咗部分 Supplier，用家要知寫咗邊啲。
const RESULT_JOB_STATUSES = new Set(["completed", "completed_with_errors"]);
const ACTIVATION_MODES = Object.freeze(["draft", "activate"]);
// 預檢未完成就冇列俾人睇：validating 嘅列可能係做到一半、之後會被刪嘅批次（REV-068 I-2）。
const ROWS_HIDDEN_STATUSES = new Set(["uploaded", "validating"]);
const MAX_PAGE_SIZE = 100;

function paging(page, pageSize) {
  const offset = (page - 1) * pageSize;
  if (!positiveInteger(page) || !positiveInteger(pageSize) || pageSize > MAX_PAGE_SIZE || !Number.isSafeInteger(offset)) {
    throw new TypeError("Supplier import paging is invalid");
  }
  return { page, pageSize, offset };
}

/**
 * Confirm 嗰陣嘅審批設定（值同 version），`FOR SHARE`：同一個 transaction 入面唔會變，設定寫入要等 confirm 做完。
 * 可以注入：設定係全庫共用嘅 singleton，測試唔可以 commit 改佢（見 supplierSettings 整合測試）。
 */
async function readActivationPolicySnapshot(connection) {
  const [[setting]] = await connection.query("SELECT require_activation_approval, version FROM supplier_settings WHERE id = 1 FOR SHARE");
  if (!setting) throw supplierConflict("SUPPLIER_SETTINGS_MISSING", "供應商設定尚未初始化");
  return { value: Number(setting.require_activation_approval), version: Number(setting.version) };
}

// 唔係自己嘅 job 同唔存在嘅 job 答案一樣，唔洩漏存在性（HD-058 1A）。
const importJobNotFound = () => supplierImportError("SUPPLIER_IMPORT_NOT_FOUND", 404, "找不到指定的匯入工作");

/** 對外嘅列：只係 precheck／執行結果，冇 lease、冇預期版本。 */
export function importRowView(row) {
  return {
    rowNumber: Number(row.row_number), operation: row.operation, status: row.status,
    matchSupplierId: nullableNumber(row.match_supplier_id), appliedSupplierId: nullableNumber(row.applied_supplier_id),
    normalizedPayload: row.normalized_payload, errors: row.errors ?? [], warnings: row.warnings ?? []
  };
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
// 暫時性錯誤（HD-060 4A）：deadlock、等鎖逾時、transaction 或者 query 逾時。嗰列唔重試，用一個分得出嘅
// code 話俾用家知可以重新匯入。錯誤可能包咗幾層，逐層睇 code。
const BUSY_CODES = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "DATABASE_TRANSACTION_TIMEOUT", "DATABASE_QUERY_TIMEOUT"]);
function busy(error) {
  for (let link = error, depth = 0; link && depth < 5; link = link.cause, depth += 1) {
    if (BUSY_CODES.has(link.code)) return true;
  }
  return false;
}
function rowError(error) {
  if (busy(error)) return [{ code: "SUPPLIER_IMPORT_ROW_BUSY", message: "資料暫時被其他操作佔用，請稍後重新匯入此列" }];
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
  constructor({ database, time, logger = null, authorize = assertActorFresh, audit, approvals,
    loadPermissions = loadPermissionNamesForUser, activationPolicy = readActivationPolicySnapshot } = {}) {
    if (!database || !time) throw new TypeError("SupplierImportService requires database and time");
    this.database = database;
    this.time = time;
    this.logger = logger;
    this.authorize = authorize;
    // SupplierAuditLogService.record 唔用 logger；worker 單元測試冇 logger 都要建到。
    this.audit = audit ?? new SupplierAuditLogService({ database, logger: logger ?? {}, time });
    this.approvals = approvals ?? new SupplierApprovalService({ database, logger: logger ?? {}, time, audit: this.audit });
    this.loadPermissions = loadPermissions;
    this.activationPolicy = activationPolicy;
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

  /** 自己上載嘅 job，新嘅先。其他人嘅 job 唔會出現（HD-058 1A）。 */
  async list({ actorId, claimedRoles, claimedPermissions, page = 1, pageSize = 20, status }) {
    const paged = paging(page, pageSize);
    if (status !== undefined && !IMPORT_JOB_STATUSES.includes(status)) throw new TypeError("Supplier import status is invalid");
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const where = status === undefined ? "created_by = ?" : "created_by = ? AND status = ?";
    const params = status === undefined ? [actorId] : [actorId, status];
    const [[[count]], [jobs]] = await Promise.all([
      this.database.query(`SELECT COUNT(*) AS total FROM supplier_import_jobs WHERE ${where}`, params),
      this.database.query(
        `SELECT ${SUMMARY_COLUMNS} FROM supplier_import_jobs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, paged.pageSize, paged.offset])
    ]);
    return { items: jobs.map(importJobSummary), total: Number(count.total), page: paged.page, pageSize: paged.pageSize };
  }

  /** Job 摘要加逐列結果（按行號分頁）。預檢未完成嘅 job 唔回任何列。 */
  async get({ actorId, claimedRoles, claimedPermissions, id, page = 1, pageSize = 20, rowStatus, rowNumber }) {
    if (!positiveInteger(id)) throw new TypeError("Supplier import job ID is invalid");
    const paged = paging(page, pageSize);
    if (rowStatus !== undefined && !IMPORT_ROW_STATUSES.includes(rowStatus)) throw new TypeError("Supplier import row status is invalid");
    if (rowNumber !== undefined && !positiveInteger(rowNumber)) throw new TypeError("Supplier import row number is invalid");
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[job]] = await this.database.query(
      `SELECT ${SUMMARY_COLUMNS} FROM supplier_import_jobs WHERE id = ? AND created_by = ?`, [id, actorId]);
    if (!job) throw importJobNotFound();
    const result = { job: importJobSummary(job), rows: [], total: 0, page: paged.page, pageSize: paged.pageSize };
    // ready 之後列唔會再被重寫（只有 uploaded → validating 會），所以讀完 job 再讀列唔會撈到半套。
    if (ROWS_HIDDEN_STATUSES.has(job.status)) return result;
    // 狀態同行號（T46：UI 按行號跳去嗰列）可以疊埋用。
    const filters = [["status = ?", rowStatus], ["`row_number` = ?", rowNumber]].filter(([, value]) => value !== undefined);
    const where = ["job_id = ?", ...filters.map(([clause]) => clause)].join(" AND ");
    const params = [id, ...filters.map(([, value]) => value)];
    const [[[count]], [rows]] = await Promise.all([
      this.database.query(`SELECT COUNT(*) AS total FROM supplier_import_rows WHERE ${where}`, params),
      this.database.query(
        `SELECT \`row_number\`, operation, status, match_supplier_id, applied_supplier_id, normalized_payload, errors, warnings
           FROM supplier_import_rows WHERE ${where} ORDER BY \`row_number\` LIMIT ? OFFSET ?`,
        [...params, paged.pageSize, paged.offset])
    ]);
    return { ...result, rows: rows.map(importRowView), total: Number(count.total) };
  }

  /**
   * 取消（HD-058 2A、3A）：只限自己、未開始預檢或執行嘅 job。同預檢失敗一樣，來源檔之後唔會再用：
   * 同一個 transaction 記 `files_purged_at`，commit 之後即刻刪；刪唔到就記低，由 T48 清理（HD-044）。
   * 摘要同逐列結果保留。
   *
   * 併發（REV-069）：claim 同 cancel 都鎖 job 行。先用唔鎖嘅讀核對擁有權 —— 唔係自己嘅 job 即刻 404，
   * 唔會等人哋把鎖（等鎖嘅時間會洩漏 job 存在，L-1）。擁有權只會被清走（上載者被刪），唔會轉俾第二個人，
   * 所以之後用 ID `FOR UPDATE` 就得。UPDATE 再帶返讀到嘅狀態做條件：就算將來有人拎走把鎖，一個啱啱
   * 被 claim 嘅 job 都唔會被改做 cancelled（M-1）。
   */
  async cancel({ actorId, claimedRoles, claimedPermissions, id, version, root, requestId = "", ip = "" }) {
    if (!positiveInteger(id) || !positiveInteger(version)) throw new TypeError("Supplier import cancel input is invalid");
    const { summary, sourceStoredName } = await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const [[owned]] = await connection.query("SELECT id FROM supplier_import_jobs WHERE id = ? AND created_by = ?", [id, actorId]);
      if (!owned) throw importJobNotFound();
      const [[job]] = await connection.query(
        "SELECT id, status, source_stored_name, version FROM supplier_import_jobs WHERE id = ? FOR UPDATE", [id]);
      if (!CANCELLABLE_JOB_STATUSES.includes(job.status)) {
        throw supplierConflict("SUPPLIER_IMPORT_NOT_CANCELLABLE", "匯入工作正在預檢、執行或已結束，不可取消");
      }
      if (Number(job.version) !== version) throw supplierConflict("VERSION_CONFLICT", "匯入工作已被其他人修改，請重新載入");
      assertJobTransition(job.status, "cancelled");
      const nowMs = this.time.nowMs();
      const [cancelled] = await connection.execute(
        `UPDATE supplier_import_jobs SET status = 'cancelled', lease_owner = '', lease_until = NULL, files_purged_at = ?,
                completed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND status = ?`,
        [nowMs, nowMs, nowMs, id, job.status]
      );
      if (cancelled.affectedRows !== 1) {
        throw supplierConflict("SUPPLIER_IMPORT_NOT_CANCELLABLE", "匯入工作正在預檢、執行或已結束，不可取消");
      }
      await this.audit.record(connection, {
        actorUserId: actorId, actorUsername: actor.username, action: "import.cancel", targetType: "import",
        targetId: id, targetLabel: `import-${id}`, detail: { before: { status: job.status }, after: { status: "cancelled" } },
        requestId, ip
      });
      const [[updated]] = await connection.query(`SELECT ${SUMMARY_COLUMNS} FROM supplier_import_jobs WHERE id = ?`, [id]);
      return { summary: importJobSummary(updated), sourceStoredName: job.source_stored_name };
    });
    try {
      if (!root) throw Object.assign(new Error("Supplier import root is not prepared"), { code: "SUPPLIER_IMPORT_UNAVAILABLE" });
      await removeSupplierImportFile(root, "source", sourceStoredName);
    } catch (cleanupError) {
      void this.logger?.error?.("supplier.import.source_cleanup_failed", "Supplier import source could not be removed after a cancel",
        { jobId: id, storedName: sourceStoredName, code: cleanupError?.code ?? null });
    }
    return summary;
  }

  /**
   * 逐列結果 CSV（T46；HD-063 1B）：唔存實體檔，每次由 rows 即時生成，所以統計一定同 rows 一致（HD-049）。
   * 只限上載者（HD-058 1A）。未執行完 → 409；保留期過咗（T48 寫 `files_purged_at`）→ 410，摘要同逐列結果照查到。
   * 列數有上限（`import.maxRows`），所以一次過喺記憶體砌。
   */
  async resultCsv({ actorId, claimedRoles, claimedPermissions, id }) {
    if (!positiveInteger(id)) throw new TypeError("Supplier import job ID is invalid");
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[job]] = await this.database.query(
      "SELECT id, status, confirmed_at, files_purged_at FROM supplier_import_jobs WHERE id = ? AND created_by = ?", [id, actorId]);
    if (!job) throw importJobNotFound();
    if (!RESULT_JOB_STATUSES.has(job.status) && !(job.status === "failed" && job.confirmed_at !== null)) {
      throw supplierImportError("SUPPLIER_IMPORT_RESULT_NOT_READY", 409, "匯入尚未執行完成，沒有結果可下載");
    }
    if (job.files_purged_at !== null) {
      throw supplierImportError("IMPORT_FILE_EXPIRED", 410, "匯入結果已過保留期限；工作摘要及逐列結果仍可查閱");
    }
    // Code：已寫入嘅列用 Supplier 儲存嘅 Code（CSV 可能係細楷，REV-074 I-1）；其餘用家喺 CSV 寫嘅 Code 優先（佢認得返嗰列；
    // ID 搵唔到或者 ID 同 Code 對唔上嗰陣都係，REV-073 I-3）；CSV 冇寫 Code（只用 supplierId）先用 Supplier 而家嘅 Code。
    const [rows] = await this.database.query(
      `SELECT r.\`row_number\`, r.operation, r.status, r.applied_supplier_id, r.errors, r.warnings,
              COALESCE(CASE WHEN r.applied_supplier_id IS NOT NULL THEN s.supplier_code END,
                       JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload, '$.root.supplierCode')),
                       JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload, '$.identity.supplierCode')), s.supplier_code) AS supplier_code
         FROM supplier_import_rows r
         LEFT JOIN suppliers s ON s.id = COALESCE(r.applied_supplier_id, r.match_supplier_id)
        WHERE r.job_id = ? ORDER BY r.\`row_number\``, [id]);
    return {
      fileName: `supplier-import-${id}-result.csv`,
      content: buildSupplierImportResult(rows.map((row) => ({
        rowNumber: Number(row.row_number), operation: row.operation, status: row.status, supplierCode: row.supplier_code ?? "",
        appliedSupplierId: nullableNumber(row.applied_supplier_id), errors: row.errors, warnings: row.warnings
      })))
    };
  }

  /**
   * 確認（T45；設計 §6.9、§8.8）：只限上載者（HD-060 1A，同 cancel 一樣先用唔鎖嘅讀核對擁有權）、只限
   * ready／ready_with_errors 而 version 對得上。同一個 transaction 保存模式、當時嘅審批設定值同 version、
   * 審批人同確認人，轉 queued；執行用呢份 snapshot，之後改設定唔追溯（AC-013）。啟用而設定要審批，就要
   * 一位而家仍然有資格、而且唔係確認人嘅審批人（BR-012）。
   */
  async confirm({ actorId, claimedRoles, claimedPermissions, id, version, activationMode, approverUserId = null,
    requestId = "", ip = "" }) {
    if (!positiveInteger(id) || !positiveInteger(version) || !ACTIVATION_MODES.includes(activationMode) ||
        (approverUserId !== null && !positiveInteger(approverUserId))) {
      throw new TypeError("Supplier import confirm input is invalid");
    }
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const [[owned]] = await connection.query("SELECT id FROM supplier_import_jobs WHERE id = ? AND created_by = ?", [id, actorId]);
      if (!owned) throw importJobNotFound();
      const [[job]] = await connection.query("SELECT id, status, version FROM supplier_import_jobs WHERE id = ? FOR UPDATE", [id]);
      if (!CONFIRMABLE_JOB_STATUSES.includes(job.status)) {
        throw supplierConflict("SUPPLIER_IMPORT_NOT_CONFIRMABLE", "匯入工作尚未完成預檢或已確認，不可確認");
      }
      if (Number(job.version) !== version) throw supplierConflict("VERSION_CONFLICT", "匯入工作已被其他人修改，請重新載入");
      const setting = await this.activationPolicy(connection);
      const approvalRequired = activationMode === "activate" && setting.value === 1;
      let approver = null;
      if (approvalRequired) {
        approver = await this.approvals.assertEligibleApprover(connection, { approverUserId, requesterId: actorId });
      } else if (approverUserId !== null) {
        throw invalidSupplierInput("APPROVER_NOT_REQUIRED", "目前設定不需要指定審批人", { field: "approverUserId" });
      }
      assertJobTransition(job.status, "queued");
      const nowMs = this.time.nowMs();
      const [queued] = await connection.execute(
        `UPDATE supplier_import_jobs SET status = 'queued', activation_mode = ?, approver_user_id = ?,
                approval_setting_value = ?, approval_setting_version = ?, confirmed_by = ?, confirmed_at = ?,
                updated_at = ?, version = version + 1
          WHERE id = ? AND status = ? AND version = ?`,
        [activationMode, approver?.id ?? null, setting.value, setting.version, actorId,
          nowMs, nowMs, id, job.status, version]
      );
      if (queued.affectedRows !== 1) throw supplierConflict("SUPPLIER_IMPORT_NOT_CONFIRMABLE", "匯入工作尚未完成預檢或已確認，不可確認");
      await this.audit.record(connection, {
        actorUserId: actorId, actorUsername: actor.username, action: "import.confirm", targetType: "import",
        targetId: id, targetLabel: `import-${id}`, detail: { before: { status: job.status }, after: {
          status: "queued", activationMode, approvalRequired, approverUserId: approver?.id ?? null,
          approvalSettingVersion: setting.version } },
        requestId, ip
      });
      const [[updated]] = await connection.query(`SELECT ${SUMMARY_COLUMNS} FROM supplier_import_jobs WHERE id = ?`, [id]);
      return importJobSummary(updated);
    });
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
        // 每列之前再驗確認人（HD-060 5A）：停用咗或者冇咗 supplier.mgmt，就停晒成個 job。冇列剩就唔驗 ——
        // 全部做完嘅 job 照常收尾，唔會因為收尾前失去權限而報失敗（REV-071 L-1）。
        const actor = await this.#executionActor(connection, job);
        if (!actor) {
          await this.#failRevoked(connection, jobId, nowMs);
          return { rowNumber: null, status: "revoked", appliedSupplierId: null };
        }
        rowNumber = Number(row.row_number);
        const appliedSupplierId = Number(await applyRow(rowConnection(connection), { job, row, actor, nowMs }));
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

  /** 確認人仲係 active 而且有 supplier.mgmt 就回 `{ id, username, permissions }`，否則 null。 */
  async #executionActor(connection, job) {
    if (job.confirmed_by === null) return null;
    const [[user]] = await connection.query("SELECT id, username FROM users WHERE id = ? AND status = 'active'", [job.confirmed_by]);
    if (!user) return null;
    const permissions = await this.loadPermissions(connection, Number(user.id));
    return permissions.includes("supplier.mgmt") ? { id: Number(user.id), username: user.username, permissions } : null;
  }

  /**
   * 確認人失去權限：未處理嘅列全部標 failed（已 applied 嘅保留），job 標 failed，統計由 rows 重建。
   * Caller 已經揸住 job 嘅鎖同 lease。
   */
  async #failRevoked(connection, jobId, nowMs) {
    await connection.execute(
      `UPDATE supplier_import_rows SET status = 'failed', errors = ?, completed_at = ?, updated_at = ?
        WHERE job_id = ? AND status IN ('valid', 'warning')`,
      [JSON.stringify([{ code: "SUPPLIER_IMPORT_AUTHORIZATION_REVOKED", message: "確認人的供應商管理權限已失效" }]), nowMs, nowMs, jobId]
    );
    const counts = countsFromRows((await connection.query(
      "SELECT status, COUNT(*) AS total FROM supplier_import_rows WHERE job_id = ? GROUP BY status", [jobId]))[0]);
    assertJobTransition("running", "failed");
    await connection.execute(
      `UPDATE supplier_import_jobs SET status = 'failed', applied_count = ?, failed_count = ?, skipped_count = ?,
              last_error_code = 'SUPPLIER_IMPORT_AUTHORIZATION_REVOKED', error_summary = '確認人的供應商管理權限已失效',
              lease_owner = '', lease_until = NULL, completed_at = ?, updated_at = ?, version = version + 1
        WHERE id = ?`,
      [counts.applied, counts.failed, counts.skipped, nowMs, nowMs, jobId]
    );
    void this.logger?.error?.("supplier.import.authorization_revoked", "Supplier import confirmer lost access; the job was failed",
      { jobId, applied: counts.applied, failed: counts.failed });
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

  /**
   * T48 保留期（設計 §12.5；HD-071 B）：仲未清檔、而且到期嘅 job。
   * - 已執行（completed、completed_with_errors、確認後失敗）：完成日 ≤ `executedBefore`。
   * - 從未確認（uploaded、ready、ready_with_errors）：上載日 ≤ `unconfirmedBefore`。
   * 失敗嘅預檢同取消咗嘅 job 一早已經清咗檔，唔會出現。
   */
  async purgeCandidates({ executedBefore, unconfirmedBefore, limit = 200 }) {
    const [rows] = await this.database.query(
      `SELECT id, status FROM supplier_import_jobs
        WHERE files_purged_at IS NULL
          AND ((status IN ('completed', 'completed_with_errors') AND COALESCE(completed_at, updated_at) <= ?)
            OR (status = 'failed' AND confirmed_at IS NOT NULL AND COALESCE(completed_at, updated_at) <= ?)
            OR (status IN (?) AND created_at <= ?))
        ORDER BY id LIMIT ?`,
      [executedBefore, executedBefore, UNCONFIRMED_JOB_STATUSES, unconfirmedBefore, limit]
    );
    return rows.map((row) => ({ id: Number(row.id), status: row.status }));
  }

  /**
   * 已執行嘅 job 到期：先記 `files_purged_at`（之後下載結果回 410），再由呼叫方刪檔。刪唔到嘅檔冇 job 指住，
   * 下一輪當冇人用嘅檔再刪（HD-053）。回要刪嘅檔名；另一個實例搶先咗就回 null。
   */
  async markExecutedFilesPurged({ id, nowMs }) {
    return this.database.withTransaction(async (connection) => {
      const [[job]] = await connection.query(
        "SELECT source_stored_name, result_stored_name FROM supplier_import_jobs WHERE id = ? AND files_purged_at IS NULL FOR UPDATE", [id]);
      if (!job) return null;
      const [marked] = await connection.execute(
        `UPDATE supplier_import_jobs SET files_purged_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND files_purged_at IS NULL
            AND (status IN ('completed', 'completed_with_errors') OR (status = 'failed' AND confirmed_at IS NOT NULL))`,
        [nowMs, nowMs, id]
      );
      return marked.affectedRows === 1 ? storedNames(job) : null;
    });
  }

  /**
   * 從未確認、逾期嘅 job（HD-071 B）：同一個 transaction 改做 cancelled、記 `files_purged_at` 同系統稽核，
   * 再由呼叫方刪來源檔。期間被預檢領咗或者被人確認／取消，就回 null、唔郁佢。
   */
  async expireUnconfirmed({ id, nowMs }) {
    return this.database.withTransaction(async (connection) => {
      const [[job]] = await connection.query(
        "SELECT id, status, source_stored_name, result_stored_name FROM supplier_import_jobs WHERE id = ? AND files_purged_at IS NULL FOR UPDATE",
        [id]);
      if (!job || !UNCONFIRMED_JOB_STATUSES.includes(job.status)) return null;
      assertJobTransition(job.status, "cancelled");
      const [expired] = await connection.execute(
        `UPDATE supplier_import_jobs SET status = 'cancelled', last_error_code = 'SUPPLIER_IMPORT_EXPIRED',
                error_summary = '匯入工作逾期未確認，已自動取消並刪除來源檔', lease_owner = '', lease_until = NULL,
                files_purged_at = ?, completed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND status = ? AND files_purged_at IS NULL`,
        [nowMs, nowMs, nowMs, id, job.status]
      );
      if (expired.affectedRows !== 1) return null;
      await this.audit.record(connection, {
        actorUserId: null, actorUsername: "system", action: "import.expire", targetType: "import", targetId: Number(job.id),
        targetLabel: `import-${job.id}`, detail: { before: { status: job.status }, after: { status: "cancelled" }, outcome: "SUPPLIER_IMPORT_EXPIRED" }
      });
      return storedNames(job);
    });
  }

  /** 仲有 job 指住（`files_purged_at` 未記）嘅檔名；其餘嘅檔冇人用（HD-044／HD-053）。 */
  async referencedStoredNames() {
    // ponytail: 一次過讀晒；job 數以千計都只係幾百 KB，大到唔掂先改做逐批比對。
    const [rows] = await this.database.query(
      "SELECT source_stored_name, result_stored_name FROM supplier_import_jobs WHERE files_purged_at IS NULL");
    return new Set(rows.flatMap((row) => storedNames(row).map(({ storedName }) => storedName)));
  }
}

const UNCONFIRMED_JOB_STATUSES = Object.freeze(["uploaded", "ready", "ready_with_errors"]);

function storedNames(job) {
  return [["source", job.source_stored_name], ["result", job.result_stored_name]]
    .filter(([, storedName]) => storedName)
    .map(([kind, storedName]) => ({ kind, storedName }));
}
