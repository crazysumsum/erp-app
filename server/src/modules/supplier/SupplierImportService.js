import { supplierConflict } from "./supplierErrors.js";

/**
 * Supplier import 嘅狀態機同逐列執行 contract（T42；設計 §5.13、§8.8）。
 *
 * T42 只定骨架：job 點樣被 worker 用 lease 領取、每一列點樣喺一個 transaction 入面同
 * Supplier 一齊 commit、做完點樣由 rows 重建統計。上載同 precheck（T43）、confirm 同
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
  validating: Object.freeze(["ready", "ready_with_errors", "failed"]),
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
  status, lease_owner, lease_until, confirmed_by, confirmed_at, version`;

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function assertLease(job, leaseOwner, nowMs) {
  if (!job || job.status !== "running" || job.lease_owner !== leaseOwner || Number(job.lease_until) < nowMs) {
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
  constructor({ database, time, logger = null } = {}) {
    if (!database || !time) throw new TypeError("SupplierImportService requires database and time");
    this.database = database;
    this.time = time;
    this.logger = logger;
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
