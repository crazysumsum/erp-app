import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerOperationService } from "./CustomerOperationService.js";
import { customerImportError } from "./customerErrors.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
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
  source_storage_status, result_storage_status, mode, activation_mode, status, total_count, valid_count,
  warning_count, invalid_count, success_count, failed_count, skipped_count, lease_owner, lease_until,
  last_error_code, error_summary, created_by, confirmed_by, created_at, updated_at, confirmed_at,
  completed_at, version`;

function assertPrecheckLease(job, leaseOwner) {
  if (!job || job.status !== "validating" || job.lease_owner !== leaseOwner) {
    throw customerImportError("CUSTOMER_IMPORT_LEASE_LOST", 409, "匯入預檢工作已由其他程序接手");
  }
}

export class CustomerImportService {
  constructor({ database, time, storage, authorize = assertActorFresh, audit = new CustomerAuditLogService(), operations = new CustomerOperationService() } = {}) {
    if (!database || !time || !storage) throw new TypeError("CustomerImportService requires database, time and storage");
    this.database = database; this.time = time; this.storage = storage; this.authorize = authorize;
    this.audit = audit; this.operations = operations;
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
