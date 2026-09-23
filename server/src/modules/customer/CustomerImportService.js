import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerOperationService } from "./CustomerOperationService.js";
import { customerImportError } from "./customerErrors.js";
import { assertActorFresh, loadPermissionNamesForUser } from "../authorization/directoryLookups.js";
import { customerImportStoredName } from "../../services/customerImport/CustomerImportStorage.js";

const JOB_STATUSES = new Set(["uploaded", "validating", "ready", "ready_with_errors", "queued", "running", "completed", "completed_with_errors", "failed", "cancelled"]);
const ROW_STATUSES = new Set(["valid", "warning", "invalid", "applied", "failed", "skipped"]);

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${field} is invalid`);
  return number;
}

function paging(page, pageSize) {
  const safePage = positiveInteger(page ?? 1, "page");
  const safeSize = positiveInteger(pageSize ?? 20, "pageSize");
  if (safeSize > 100) throw new TypeError("pageSize is invalid");
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

function jobSummary(row) {
  return {
    id: Number(row.id), templateVersion: row.template_version, mode: row.mode,
    activationMode: row.activation_mode, sourceStorageStatus: row.source_storage_status,
    resultStorageStatus: row.result_storage_status ?? null, status: row.status,
    totalCount: Number(row.total_count), validCount: Number(row.valid_count), warningCount: Number(row.warning_count),
    invalidCount: Number(row.invalid_count), successCount: Number(row.success_count), failedCount: Number(row.failed_count),
    skippedCount: Number(row.skipped_count), lastErrorCode: row.last_error_code, errorSummary: row.error_summary,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    confirmedBy: row.confirmed_by === null ? null : Number(row.confirmed_by),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at), version: Number(row.version)
  };
}

const JOB_SELECT = `id, idempotency_key, template_version, operation_id, source_stored_name, source_sha256,
  source_storage_status, result_stored_name, result_sha256, result_storage_status, mode, activation_mode,
  approver_user_id, approval_setting_value, approval_setting_version, status, total_count, valid_count,
  warning_count, invalid_count, success_count, failed_count, skipped_count, lease_owner, lease_until,
  last_error_code, error_summary, created_by, confirmed_by, created_at, updated_at, confirmed_at,
  completed_at, version`;

function assertPrecheckLease(job, leaseOwner) {
  if (!job || job.status !== "validating" || job.lease_owner !== leaseOwner) {
    throw customerImportError("CUSTOMER_IMPORT_LEASE_LOST", 409, "匯入預檢工作已由其他程序接手");
  }
}

function assertExecutionLease(job, leaseOwner, nowMs) {
  if (!job || job.status !== "running" || job.lease_owner !== leaseOwner || Number(job.lease_until) < nowMs) {
    throw customerImportError("CUSTOMER_IMPORT_LEASE_LOST", 409, "匯入執行工作已由其他程序接手");
  }
}

function safeRowError(error) {
  return [{ field: "row", code: String(error?.publicCode ?? error?.code ?? "IMPORT_ROW_FAILED").slice(0, 80), message: "此列套用失敗，未寫入客戶資料" }];
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function issueCodes(value) {
  const issues = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(issues) ? issues.map((item) => String(item?.code ?? "")).filter(Boolean).join("|") : "";
}

export class CustomerImportService {
  constructor({ database, time, storage, authorize = assertActorFresh, loadPermissions = loadPermissionNamesForUser, audit = new CustomerAuditLogService(), operations = new CustomerOperationService() } = {}) {
    if (!database || !time || !storage) throw new TypeError("CustomerImportService requires database, time and storage");
    this.database = database; this.time = time; this.storage = storage; this.authorize = authorize;
    this.loadPermissions = loadPermissions; this.audit = audit; this.operations = operations;
  }

  async createFromUpload({ actorId, claimedRoles, claimedPermissions, idempotencyKey, templateVersion, mode, fileSha256, content, requestId = "", ip = "" }) {
    if (!["create_only", "upsert"].includes(mode) || templateVersion !== "v1" || !/^[0-9a-f]{64}$/u.test(String(fileSha256 ?? ""))) {
      throw customerImportError("CUSTOMER_IMPORT_INVALID", 400, "匯入設定或檔案摘要無效");
    }
    let actor; let operationId; let job;
    await this.database.withTransaction(async (connection) => {
      actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();
      const started = await this.operations.begin(connection, {
        actorId, routeKey: "customer.import.upload", idempotencyKey,
        payload: { templateVersion, mode, fileSha256 }, nowMs
      });
      operationId = started.operationId;
      if (started.replay) {
        job = await this.#getByOperation(connection, operationId);
        if (!job) throw customerImportError("CUSTOMER_IMPORT_STATE_CONFLICT", 409, "匯入工作狀態不一致");
        return;
      }
      const storedName = customerImportStoredName(operationId);
      const [result] = await connection.execute(
        `INSERT INTO customer_import_jobs
           (idempotency_key, template_version, operation_id, source_stored_name, source_sha256,
            source_storage_status, mode, activation_mode, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'processing', ?, 'draft', 'uploaded', ?, ?, ?)`,
        [String(idempotencyKey).trim(), templateVersion, operationId, storedName, Buffer.from(fileSha256, "hex"), mode, actorId, nowMs, nowMs]
      );
      job = await this.#get(connection, Number(result.insertId));
    });
    if (job.source_storage_status === "active") return jobSummary(job);
    if (job.source_storage_status !== "processing") throw customerImportError("CUSTOMER_IMPORT_STORAGE_ERROR", 503, "匯入來源檔案目前不可用");
    const metadata = { storedName: job.source_stored_name, sha256: Buffer.from(job.source_sha256) };
    try {
      const staged = await this.storage.stageSource({ operationId, content, expectedSha256: fileSha256 });
      if (staged.storedName !== metadata.storedName || !staged.sha256.equals(metadata.sha256)) throw new Error("Customer import source metadata mismatch");
      await this.storage.finalizeSource(metadata);
      return this.database.withTransaction(async (connection) => {
        const nowMs = this.time.nowMs();
        const [transition] = await connection.execute(
          `UPDATE customer_import_jobs SET source_storage_status = 'active', updated_at = ?, version = version + 1
            WHERE id = ? AND source_storage_status = 'processing'`,
          [nowMs, job.id]
        );
        const activated = await this.#get(connection, job.id);
        if (transition.affectedRows === 1) {
          await this.audit.record(connection, {
            occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: "import.upload",
            targetType: "import", targetId: Number(job.id), customerId: null, targetLabel: `import-${job.id}`,
            detail: { after: { mode, templateVersion } }, requestId, ip
          });
          await this.operations.succeed(connection, { operationId, resourceType: "import", resourceId: Number(job.id), resultVersion: Number(activated.version), nowMs });
        }
        return jobSummary(activated);
      });
    } catch (error) {
      await this.database.withTransaction(async (connection) => {
        const nowMs = this.time.nowMs();
        await connection.execute(
          `UPDATE customer_import_jobs SET source_storage_status = 'storage_error', status = 'failed',
             last_error_code = 'SOURCE_STORAGE_ERROR', error_summary = '匯入來源檔案無法安全保存',
             updated_at = ?, completed_at = ?, version = version + 1 WHERE id = ? AND source_storage_status = 'processing'`,
          [nowMs, nowMs, job.id]
        );
        await this.operations.fail(connection, { operationId, errorCode: "SOURCE_STORAGE_ERROR", nowMs });
      });
      throw customerImportError("CUSTOMER_IMPORT_STORAGE_ERROR", 503, "匯入來源檔案無法安全保存");
    }
  }

  async claimForPrecheck({ leaseOwner, leaseDurationMs }) {
    if (!String(leaseOwner ?? "").trim() || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) throw new TypeError("Customer import lease is invalid");
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[row]] = await connection.query(
        `SELECT ${JOB_SELECT} FROM customer_import_jobs
          WHERE source_storage_status = 'active'
            AND (status = 'uploaded' OR (status = 'validating' AND lease_until < ?))
          ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE`, [nowMs]
      );
      if (!row) return null;
      const leaseUntil = nowMs + leaseDurationMs;
      const [result] = await connection.execute(
        `UPDATE customer_import_jobs SET status = 'validating', lease_owner = ?, lease_until = ?,
           updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
        [String(leaseOwner), leaseUntil, nowMs, row.id, row.version]
      );
      if (result.affectedRows !== 1) return null;
      return {
        id: Number(row.id), mode: row.mode, sourceStoredName: row.source_stored_name,
        sourceSha256: Buffer.from(row.source_sha256), createdBy: row.created_by === null ? null : Number(row.created_by)
      };
    });
  }

  async readSource(job) {
    return this.storage.streamSource({ storedName: job.sourceStoredName, sha256: job.sourceSha256 });
  }

  async preparePrecheck({ jobId, leaseOwner }) {
    return this.database.withTransaction(async (connection) => {
      const [[job]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      assertPrecheckLease(job, leaseOwner);
      await connection.execute("DELETE FROM customer_import_rows WHERE job_id = ?", [jobId]);
    });
  }

  async appendPrecheckRows({ jobId, leaseOwner, leaseDurationMs, rows }) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new TypeError("Customer import precheck batch is invalid");
    }
    return this.database.withTransaction(async (connection) => {
      const [[job]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      assertPrecheckLease(job, leaseOwner);
      const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const params = rows.flatMap((row) => [
        jobId, row.rowNumber, row.operation, row.matchCustomerId, row.expectedCustomerVersion,
        JSON.stringify(row.normalizedPayload), row.status, JSON.stringify(row.errors), JSON.stringify(row.warnings)
      ]);
      await connection.execute(
        `INSERT INTO customer_import_rows
           (job_id,\`row_number\`,operation,match_customer_id,expected_customer_version,normalized_payload,status,errors,warnings)
         VALUES ${placeholders}`, params
      );
      const nowMs = this.time.nowMs();
      await connection.execute(
        "UPDATE customer_import_jobs SET lease_until = ?, updated_at = ?, version = version + 1 WHERE id = ?",
        [nowMs + leaseDurationMs, nowMs, jobId]
      );
    });
  }

  async recordPrecheck({ jobId, leaseOwner, counts, jobLevelError }) {
    return this.database.withTransaction(async (connection) => {
      const [[job]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      assertPrecheckLease(job, leaseOwner);
      const nowMs = this.time.nowMs();
      if (jobLevelError) {
        await connection.execute("DELETE FROM customer_import_rows WHERE job_id = ?", [jobId]);
        await connection.execute(
          `UPDATE customer_import_jobs SET status = 'failed', total_count = 0, valid_count = 0,
             warning_count = 0, invalid_count = 0, lease_owner = '', lease_until = NULL,
             last_error_code = ?, error_summary = ?, updated_at = ?, completed_at = ?, version = version + 1
           WHERE id = ?`,
          [String(jobLevelError.code).slice(0, 80), String(jobLevelError.message).slice(0, 500), nowMs, nowMs, jobId]
        );
      } else {
        const status = counts.invalid > 0 ? "ready_with_errors" : "ready";
        await connection.execute(
          `UPDATE customer_import_jobs SET status = ?, total_count = ?, valid_count = ?, warning_count = ?,
             invalid_count = ?, lease_owner = '', lease_until = NULL, last_error_code = '', error_summary = '',
             updated_at = ?, version = version + 1 WHERE id = ?`,
          [status, counts.total, counts.valid, counts.warning, counts.invalid, nowMs, jobId]
        );
      }
      const user = job.created_by === null
        ? null
        : (await connection.query("SELECT username FROM users WHERE id = ?", [job.created_by]))[0][0];
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: job.created_by, actorUsername: user?.username ?? "", action: "import.precheck",
        targetType: "import", targetId: Number(jobId), customerId: null, targetLabel: `import-${jobId}`,
        detail: { after: jobLevelError ? { errorCode: jobLevelError.code } : {
          totalCount: counts.total, validCount: counts.valid, warningCount: counts.warning, invalidCount: counts.invalid
        } }
      });
      return jobSummary(await this.#get(connection, jobId));
    });
  }

  async confirm({ actorId, claimedRoles, claimedPermissions, id, version, activationMode, approverUserId, requestId = "", ip = "" }) {
    if (!["draft", "activate"].includes(activationMode) || !Number.isSafeInteger(version) || version < 1) {
      throw customerImportError("CUSTOMER_IMPORT_INVALID", 400, "匯入確認資料無效");
    }
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const [[job]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [id]);
      if (!job) throw customerImportError("CUSTOMER_IMPORT_NOT_FOUND", 404, "找不到指定的匯入工作");
      if (["queued", "running", "completed", "completed_with_errors"].includes(job.status) &&
          Number(job.confirmed_by) === actorId && job.activation_mode === activationMode &&
          (job.approver_user_id === null ? null : Number(job.approver_user_id)) === (approverUserId ?? null)) {
        return jobSummary(job);
      }
      if (!["ready", "ready_with_errors"].includes(job.status) || Number(job.version) !== version) {
        throw customerImportError("CUSTOMER_IMPORT_STATE_CONFLICT", 409, "匯入工作狀態或版本已變更");
      }
      const [[setting]] = await connection.query("SELECT require_activation_approval, version FROM customer_settings WHERE id = 1 FOR SHARE");
      if (!setting) throw customerImportError("CUSTOMER_IMPORT_STATE_CONFLICT", 409, "客戶設定尚未初始化");
      let approverId = null;
      if (activationMode === "activate" && Number(setting.require_activation_approval) === 1) {
        if (!Number.isSafeInteger(approverUserId) || approverUserId < 1 || approverUserId === actorId) {
          throw customerImportError("CUSTOMER_IMPORT_APPROVER_INVALID", 422, "必須指定不同且有效的審批人");
        }
        const [[approver]] = await connection.query("SELECT id FROM users WHERE id = ? AND status = 'active'", [approverUserId]);
        if (!approver || !(await this.loadPermissions(connection, approverUserId)).includes("customer.approval")) {
          throw customerImportError("CUSTOMER_IMPORT_APPROVER_INVALID", 422, "必須指定不同且有效的審批人");
        }
        approverId = Number(approver.id);
      } else if (approverUserId !== undefined && approverUserId !== null) {
        throw customerImportError("CUSTOMER_IMPORT_APPROVER_INVALID", 422, "目前匯入模式不需要審批人");
      }
      const nowMs = this.time.nowMs();
      const [updated] = await connection.execute(
        `UPDATE customer_import_jobs SET activation_mode = ?, approver_user_id = ?, approval_setting_value = ?,
           approval_setting_version = ?, status = 'queued', confirmed_by = ?, confirmed_at = ?, updated_at = ?,
           lease_owner = '', lease_until = NULL, version = version + 1
         WHERE id = ? AND status IN ('ready','ready_with_errors') AND version = ?`,
        [activationMode, approverId, Number(setting.require_activation_approval), Number(setting.version), actorId, nowMs, nowMs, id, version]
      );
      if (updated.affectedRows !== 1) throw customerImportError("CUSTOMER_IMPORT_STATE_CONFLICT", 409, "匯入工作狀態或版本已變更");
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: "import.confirm",
        targetType: "import", targetId: Number(id), customerId: null, targetLabel: `import-${id}`,
        detail: { after: { activationMode, totalCount: Number(job.total_count), invalidCount: Number(job.invalid_count) } }, requestId, ip
      });
      return jobSummary(await this.#get(connection, id));
    });
  }

  async cancel({ actorId, claimedRoles, claimedPermissions, id, version, requestId = "", ip = "" }) {
    if (!Number.isSafeInteger(version) || version < 1) throw customerImportError("CUSTOMER_IMPORT_INVALID", 400, "匯入版本無效");
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const [[job]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [id]);
      if (!job) throw customerImportError("CUSTOMER_IMPORT_NOT_FOUND", 404, "找不到指定的匯入工作");
      if (!["uploaded", "validating", "ready", "ready_with_errors", "queued"].includes(job.status) || Number(job.version) !== version) {
        throw customerImportError("CUSTOMER_IMPORT_STATE_CONFLICT", 409, "執行中的匯入工作不可取消");
      }
      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE customer_import_jobs SET status = 'cancelled', lease_owner = '', lease_until = NULL,
           updated_at = ?, completed_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
        [nowMs, nowMs, id, version]
      );
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: "import.cancel",
        targetType: "import", targetId: Number(id), customerId: null, targetLabel: `import-${id}`,
        detail: { after: { status: "cancelled" } }, requestId, ip
      });
      return jobSummary(await this.#get(connection, id));
    });
  }

  async claimForExecution({ leaseOwner, leaseDurationMs }) {
    if (!String(leaseOwner ?? "").trim() || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1) throw new TypeError("Customer import lease is invalid");
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[job]] = await connection.query(
        `SELECT ${JOB_SELECT} FROM customer_import_jobs
          WHERE status = 'queued' OR (status = 'running' AND lease_until < ?)
          ORDER BY confirmed_at ASC, id ASC LIMIT 1 FOR UPDATE`, [nowMs]
      );
      if (!job) return null;
      const [[actor]] = await connection.query("SELECT id, username FROM users WHERE id = ? AND status = 'active'", [job.confirmed_by]);
      const permissions = actor ? await this.loadPermissions(connection, Number(job.confirmed_by)) : [];
      if (!actor || !permissions.includes("customer.view") || !permissions.includes("customer.mgmt")) {
        await connection.execute(
          `UPDATE customer_import_jobs SET status = 'failed', lease_owner = '', lease_until = NULL,
             last_error_code = 'AUTHORIZATION_REVOKED', error_summary = '確認人的客戶管理權限已失效',
             updated_at = ?, completed_at = ?, version = version + 1 WHERE id = ?`,
          [nowMs, nowMs, job.id]
        );
        return null;
      }
      await connection.execute(
        `UPDATE customer_import_rows SET status = 'skipped', completed_at = ?, version = version + 1
          WHERE job_id = ? AND status = 'invalid'`, [nowMs, job.id]
      );
      const [claimed] = await connection.execute(
        `UPDATE customer_import_jobs SET status = 'running', lease_owner = ?, lease_until = ?,
           updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
        [String(leaseOwner), nowMs + leaseDurationMs, nowMs, job.id, job.version]
      );
      if (claimed.affectedRows !== 1) return null;
      return { id: Number(job.id) };
    });
  }

  async processNextRow({ jobId, leaseOwner, leaseDurationMs, applyRow }) {
    if (!Number.isSafeInteger(jobId) || jobId < 1 || !String(leaseOwner ?? "").trim() ||
        !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1 || typeof applyRow !== "function") {
      throw new TypeError("Customer import execution input is invalid");
    }
    let rowNumber = null;
    try {
      return await this.database.withTransaction(async (connection) => {
        const nowMs = this.time.nowMs();
        const [[job]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
        assertExecutionLease(job, leaseOwner, nowMs);
        const [[actor]] = await connection.query("SELECT id, username FROM users WHERE id = ? AND status = 'active'", [job.confirmed_by]);
        const permissions = actor ? await this.loadPermissions(connection, Number(job.confirmed_by)) : [];
        if (!actor || !permissions.includes("customer.view") || !permissions.includes("customer.mgmt")) {
          throw customerImportError("CUSTOMER_IMPORT_AUTHORIZATION_REVOKED", 403, "確認人的客戶管理權限已失效");
        }
        const [[row]] = await connection.query(
          `SELECT job_id, \`row_number\`, operation, match_customer_id, expected_customer_version,
                  normalized_payload, status, errors, warnings, version
             FROM customer_import_rows
            WHERE job_id = ? AND status IN ('valid','warning')
            ORDER BY \`row_number\` ASC LIMIT 1 FOR UPDATE`, [jobId]
        );
        if (!row) return null;
        rowNumber = Number(row.row_number);
        const appliedCustomerId = await applyRow(connection, { job, row, actor: { id: Number(actor.id), username: actor.username, permissions }, nowMs });
        const [marked] = await connection.execute(
          `UPDATE customer_import_rows SET status = 'applied', applied_customer_id = ?, started_at = COALESCE(started_at, ?),
             completed_at = ?, version = version + 1
           WHERE job_id = ? AND \`row_number\` = ? AND status IN ('valid','warning')`,
          [appliedCustomerId, nowMs, nowMs, jobId, rowNumber]
        );
        if (marked.affectedRows !== 1) throw customerImportError("CUSTOMER_IMPORT_ROW_STATE_CONFLICT", 409, "匯入資料列狀態已變更");
        await connection.execute(
          "UPDATE customer_import_jobs SET lease_until = ?, updated_at = ?, version = version + 1 WHERE id = ? AND lease_owner = ?",
          [nowMs + leaseDurationMs, nowMs, jobId, leaseOwner]
        );
        return { rowNumber, status: "applied", appliedCustomerId: Number(appliedCustomerId) };
      });
    } catch (error) {
      if (rowNumber === null) throw error;
      return this.database.withTransaction(async (connection) => {
        const [[current]] = await connection.query(
          "SELECT status, applied_customer_id FROM customer_import_rows WHERE job_id = ? AND `row_number` = ? FOR UPDATE",
          [jobId, rowNumber]
        );
        if (!current) throw error;
        if (["applied", "failed", "skipped"].includes(current.status)) {
          return { rowNumber, status: current.status, appliedCustomerId: current.applied_customer_id === null ? null : Number(current.applied_customer_id) };
        }
        const nowMs = this.time.nowMs();
        await connection.execute(
          `UPDATE customer_import_rows SET status = 'failed', errors = ?, started_at = COALESCE(started_at, ?),
             completed_at = ?, version = version + 1
           WHERE job_id = ? AND \`row_number\` = ? AND status IN ('valid','warning')`,
          [JSON.stringify(safeRowError(error)), nowMs, nowMs, jobId, rowNumber]
        );
        await connection.execute(
          "UPDATE customer_import_jobs SET lease_until = ?, updated_at = ?, version = version + 1 WHERE id = ? AND lease_owner = ?",
          [nowMs + leaseDurationMs, nowMs, jobId, leaseOwner]
        );
        return { rowNumber, status: "failed", appliedCustomerId: null };
      });
    }
  }

  async finalizeExecution({ jobId, leaseOwner }) {
    if (!Number.isSafeInteger(jobId) || jobId < 1 || !String(leaseOwner ?? "").trim()) throw new TypeError("Customer import finalization input is invalid");
    const job = await this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[locked]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      if (locked?.status === "completed" || locked?.status === "completed_with_errors") return locked;
      assertExecutionLease(locked, leaseOwner, nowMs);
      const [[remaining]] = await connection.query(
        "SELECT COUNT(*) AS total FROM customer_import_rows WHERE job_id = ? AND status IN ('valid','warning','invalid')", [jobId]
      );
      if (Number(remaining.total) !== 0) throw customerImportError("CUSTOMER_IMPORT_ROWS_PENDING", 409, "匯入仍有資料列尚未處理");
      return locked;
    });
    if (["completed", "completed_with_errors"].includes(job.status)) return jobSummary(job);

    const staged = await this.storage.stageResult({ operationId: job.operation_id, source: this.#resultCsv(jobId) });
    await this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[locked]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      if (["completed", "completed_with_errors"].includes(locked?.status)) return;
      assertExecutionLease(locked, leaseOwner, nowMs);
      if (locked.result_storage_status === "processing" &&
          (locked.result_stored_name !== staged.storedName || !Buffer.from(locked.result_sha256).equals(staged.sha256))) {
        throw customerImportError("CUSTOMER_IMPORT_RESULT_CONFLICT", 409, "匯入結果檔案狀態不一致");
      }
      if (!locked.result_storage_status) {
        await connection.execute(
          `UPDATE customer_import_jobs SET result_stored_name = ?, result_sha256 = ?, result_storage_status = 'processing',
             updated_at = ?, version = version + 1 WHERE id = ? AND result_storage_status IS NULL`,
          [staged.storedName, staged.sha256, nowMs, jobId]
        );
      }
    });
    await this.storage.finalizeResult(staged);
    return this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      const [[locked]] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ? FOR UPDATE`, [jobId]);
      if (["completed", "completed_with_errors"].includes(locked?.status) && locked.result_storage_status === "active") return jobSummary(locked);
      assertExecutionLease(locked, leaseOwner, nowMs);
      const [counts] = await connection.query(
        `SELECT COUNT(*) AS total,
                SUM(status = 'applied') AS success_count,
                SUM(status = 'failed') AS failed_count,
                SUM(status = 'skipped') AS skipped_count
           FROM customer_import_rows WHERE job_id = ?`, [jobId]
      );
      const count = counts[0];
      const failedCount = Number(count.failed_count ?? 0); const skippedCount = Number(count.skipped_count ?? 0);
      const status = failedCount || skippedCount ? "completed_with_errors" : "completed";
      await connection.execute(
        `UPDATE customer_import_jobs SET result_storage_status = 'active', status = ?, total_count = ?,
           success_count = ?, failed_count = ?, skipped_count = ?, lease_owner = '', lease_until = NULL,
           last_error_code = '', error_summary = '', updated_at = ?, completed_at = ?, version = version + 1
         WHERE id = ? AND result_storage_status = 'processing'`,
        [status, Number(count.total), Number(count.success_count ?? 0), failedCount, skippedCount, nowMs, nowMs, jobId]
      );
      const [[user]] = await connection.query("SELECT username FROM users WHERE id = ?", [locked.confirmed_by]);
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: locked.confirmed_by, actorUsername: user?.username ?? "", action: "import.complete",
        targetType: "import", targetId: jobId, customerId: null, targetLabel: `import-${jobId}`,
        detail: { after: { totalCount: Number(count.total), successCount: Number(count.success_count ?? 0), failedCount, skippedCount } }
      });
      return jobSummary(await this.#get(connection, jobId));
    });
  }

  async downloadResult({ actorId, claimedRoles, claimedPermissions, id, requestId = "", ip = "" }) {
    const jobId = positiveInteger(id, "id");
    const metadata = await this.database.withTransaction(async (connection) => {
      await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const job = await this.#get(connection, jobId);
      if (!job) throw customerImportError("CUSTOMER_IMPORT_NOT_FOUND", 404, "找不到指定的匯入工作");
      if (job.result_storage_status === "purged") throw customerImportError("CUSTOMER_IMPORT_RESULT_EXPIRED", 410, "匯入結果檔案已過期");
      if (job.result_storage_status !== "active" || !job.result_stored_name || !job.result_sha256) {
        throw customerImportError("CUSTOMER_IMPORT_RESULT_NOT_READY", 409, "匯入結果檔案尚未可用");
      }
      return { storedName: job.result_stored_name, sha256: Buffer.from(job.result_sha256) };
    });
    const buffer = await this.storage.readResult(metadata);
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const job = await this.#get(connection, jobId);
      if (job?.result_storage_status !== "active" || job.result_stored_name !== metadata.storedName || !job.result_sha256 || !Buffer.from(job.result_sha256).equals(metadata.sha256)) {
        throw customerImportError("CUSTOMER_IMPORT_RESULT_EXPIRED", 410, "匯入結果檔案已過期");
      }
      const nowMs = this.time.nowMs();
      await this.audit.record(connection, {
        occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: "import.result_download",
        targetType: "import", targetId: jobId, customerId: null, targetLabel: `import-${jobId}`, requestId, ip
      });
    });
    return { buffer, fileName: `customer-import-${jobId}-result.csv` };
  }

  async recoverFiles({ staleBefore, limit = 10 }) {
    if (!Number.isSafeInteger(staleBefore) || staleBefore < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("Customer import recovery input is invalid");
    }
    const [sources] = await this.database.query(
      `SELECT id, source_stored_name, source_sha256 FROM customer_import_jobs
        WHERE source_storage_status = 'processing' AND updated_at < ? ORDER BY updated_at ASC, id ASC LIMIT ?`,
      [staleBefore, limit]
    );
    const [results] = await this.database.query(
      `SELECT id, result_stored_name, result_sha256 FROM customer_import_jobs
        WHERE result_storage_status = 'processing' AND updated_at < ? ORDER BY updated_at ASC, id ASC LIMIT ?`,
      [staleBefore, limit]
    );
    let recovered = 0; let failed = 0;
    for (const item of sources) {
      try {
        await this.storage.finalizeSource({ storedName: item.source_stored_name, sha256: Buffer.from(item.source_sha256) });
        await this.database.execute(
          `UPDATE customer_import_jobs SET source_storage_status = 'active', updated_at = ?, version = version + 1
            WHERE id = ? AND source_storage_status = 'processing'`, [this.time.nowMs(), item.id]
        );
        recovered += 1;
      } catch {
        const nowMs = this.time.nowMs();
        await this.database.execute(
          `UPDATE customer_import_jobs SET source_storage_status = 'storage_error', status = 'failed',
             last_error_code = 'SOURCE_STORAGE_ERROR', error_summary = '匯入來源檔案無法恢復',
             updated_at = ?, completed_at = ?, version = version + 1
           WHERE id = ? AND source_storage_status = 'processing'`, [nowMs, nowMs, item.id]
        );
        failed += 1;
      }
    }
    for (const item of results) {
      try {
        await this.storage.finalizeResult({ storedName: item.result_stored_name, sha256: Buffer.from(item.result_sha256) });
        await this.database.execute(
          "UPDATE customer_import_jobs SET updated_at = ?, version = version + 1 WHERE id = ? AND result_storage_status = 'processing'",
          [this.time.nowMs(), item.id]
        );
        recovered += 1;
      } catch {
        const nowMs = this.time.nowMs();
        await this.database.execute(
          `UPDATE customer_import_jobs SET result_storage_status = 'storage_error', status = 'failed',
             lease_owner = '', lease_until = NULL, last_error_code = 'RESULT_STORAGE_ERROR',
             error_summary = '匯入結果檔案無法恢復', updated_at = ?, completed_at = ?, version = version + 1
           WHERE id = ? AND result_storage_status = 'processing'`, [nowMs, nowMs, item.id]
        );
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  async *#resultCsv(jobId) {
    yield "rowNumber,operation,status,appliedCustomerId,errorCodes,warningCodes\r\n";
    let after = 0;
    while (true) {
      const [rows] = await this.database.query(
        `SELECT \`row_number\`, operation, status, applied_customer_id, errors, warnings
           FROM customer_import_rows WHERE job_id = ? AND \`row_number\` > ?
          ORDER BY \`row_number\` ASC LIMIT 500`, [jobId, after]
      );
      if (rows.length === 0) return;
      for (const row of rows) {
        yield [row.row_number, row.operation, row.status, row.applied_customer_id, issueCodes(row.errors), issueCodes(row.warnings)].map(csvCell).join(",") + "\r\n";
      }
      after = Number(rows.at(-1).row_number);
    }
  }

  async list({ actorId, claimedRoles, claimedPermissions, page = 1, pageSize = 20, status }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    if (status !== undefined && !JOB_STATUSES.has(status)) throw new TypeError("Customer import status is invalid");
    const values = paging(page, pageSize); const where = status ? "WHERE status = ?" : ""; const params = status ? [status] : [];
    const [[count], [rows]] = await Promise.all([
      this.database.query(`SELECT COUNT(*) AS total FROM customer_import_jobs ${where}`, params),
      this.database.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...params, values.pageSize, values.offset])
    ]);
    return { items: rows.map(jobSummary), total: Number(count[0].total), page: values.page, pageSize: values.pageSize };
  }

  async get({ actorId, claimedRoles, claimedPermissions, id, page = 1, pageSize = 20, rowStatus }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const job = await this.#get(this.database, positiveInteger(id, "id"));
    if (!job) throw customerImportError("CUSTOMER_IMPORT_NOT_FOUND", 404, "找不到指定的匯入工作");
    if (rowStatus !== undefined && !ROW_STATUSES.has(rowStatus)) throw new TypeError("Customer import row status is invalid");
    const values = paging(page, pageSize); const where = rowStatus ? "AND status = ?" : ""; const params = rowStatus ? [id, rowStatus] : [id];
    const [[count], [rows]] = await Promise.all([
      this.database.query(`SELECT COUNT(*) AS total FROM customer_import_rows WHERE job_id = ? ${where}`, params),
      this.database.query(
        `SELECT \`row_number\`, operation, match_customer_id, expected_customer_version, normalized_payload,
                status, applied_customer_id, errors, warnings, started_at, completed_at, version
           FROM customer_import_rows WHERE job_id = ? ${where} ORDER BY \`row_number\` ASC LIMIT ? OFFSET ?`,
        [...params, values.pageSize, values.offset]
      )
    ]);
    return {
      job: jobSummary(job),
      rows: rows.map((row) => ({
        rowNumber: Number(row.row_number), operation: row.operation,
        matchCustomerId: row.match_customer_id === null ? null : Number(row.match_customer_id),
        expectedCustomerVersion: row.expected_customer_version === null ? null : Number(row.expected_customer_version),
        normalizedPayload: row.normalized_payload, status: row.status,
        appliedCustomerId: row.applied_customer_id === null ? null : Number(row.applied_customer_id),
        errors: row.errors ?? [], warnings: row.warnings ?? [],
        startedAt: row.started_at === null ? null : Number(row.started_at),
        completedAt: row.completed_at === null ? null : Number(row.completed_at), version: Number(row.version)
      })),
      total: Number(count[0].total), page: values.page, pageSize: values.pageSize
    };
  }

  async #get(connection, id) {
    const [rows] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async #getByOperation(connection, operationId) {
    const [rows] = await connection.query(`SELECT ${JOB_SELECT} FROM customer_import_jobs WHERE operation_id = ?`, [operationId]);
    return rows[0] ?? null;
  }
}
