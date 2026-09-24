import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerOperationService } from "./CustomerOperationService.js";
import { CustomerService } from "./CustomerService.js";
import { customerExportError } from "./customerErrors.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { customerImportStoredName } from "../../services/customerImport/CustomerImportStorage.js";

const HEADER = Object.freeze([
  "id", "customerCode", "legalName", "displayName", "generalPhone", "generalEmail",
  "defaultCurrencyCode", "defaultPaymentTermId", "accountManagerUserId", "categoryId",
  "industryId", "territoryId", "creditStatus", "status", "version", "updatedAt"
]);
const FILTERS = new Set([
  "q", "sortBy", "sortDirection", "status", "currencyCode", "paymentTermId",
  "accountManagerUserId", "categoryId", "industryId", "territoryId", "creditStatus",
  "missing", "createdFrom", "createdTo", "updatedFrom", "updatedTo", "includeArchived"
]);
const SELECT = `id, idempotency_key, operation_id, filter_snapshot, result_stored_name,
  result_sha256, result_storage_status, status, total_count, expires_at, last_error_code,
  error_summary, created_by, created_at, updated_at, completed_at, version`;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\t\r\n ]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeFilters(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Customer export filters are invalid");
  for (const key of Object.keys(input)) if (!FILTERS.has(key)) throw new TypeError(`Unsupported Customer export filter: ${key}`);
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function snapshot(value) {
  if (typeof value === "string") return JSON.parse(value);
  return value ?? {};
}

function summary(row) {
  return {
    id: Number(row.id), filters: snapshot(row.filter_snapshot), status: row.status,
    resultStorageStatus: row.result_storage_status, totalCount: Number(row.total_count),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    lastErrorCode: row.last_error_code, errorSummary: row.error_summary,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at), version: Number(row.version)
  };
}

export class CustomerExportService {
  constructor({ database, time, storage, customerService, authorize = assertActorFresh,
    audit = new CustomerAuditLogService(), operations = new CustomerOperationService(), maxRows = 10000 } = {}) {
    if (!database || !time || !storage || !Number.isSafeInteger(maxRows) || maxRows < 1) {
      throw new TypeError("CustomerExportService requires database, time, storage and maxRows");
    }
    this.database = database; this.time = time; this.storage = storage; this.authorize = authorize;
    this.customerService = customerService ?? new CustomerService({ database, time });
    this.audit = audit; this.operations = operations; this.maxRows = maxRows;
  }

  async create({ actorId, claimedRoles, claimedPermissions, idempotencyKey, filters: rawFilters, requestId = "", ip = "" }) {
    const filters = safeFilters(rawFilters);
    let operationId; let job;
    await this.database.withTransaction(async (connection) => {
      await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();
      const started = await this.operations.begin(connection, {
        actorId, routeKey: "customer.export.create", idempotencyKey, payload: { filters }, nowMs
      });
      operationId = started.operationId;
      if (started.replay) {
        job = await this.#getByOperation(connection, operationId);
        if (!job) throw customerExportError("CUSTOMER_EXPORT_STATE_CONFLICT", 409, "匯出工作狀態不一致");
        if (job.status === "completed") return;
        if (job.status !== "processing") throw customerExportError("CUSTOMER_EXPORT_STATE_CONFLICT", 409, "匯出工作已失敗，請使用新的冪等鍵重試");
        return;
      }
      const storedName = customerImportStoredName(operationId, "result");
      const [result] = await connection.execute(
        `INSERT INTO customer_export_jobs
           (idempotency_key, operation_id, filter_snapshot, result_stored_name, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [String(idempotencyKey).trim(), operationId, JSON.stringify(filters), storedName, actorId, nowMs, nowMs]
      );
      job = await this.#get(connection, Number(result.insertId));
    });
    if (job.status === "completed") return summary(job);

    let first;
    try {
      first = await this.customerService.list({ actorId, claimedRoles, claimedPermissions, ...filters, page: 1, pageSize: 100 });
      if (first.total > this.maxRows) throw customerExportError(
        "CUSTOMER_EXPORT_TOO_LARGE", 422, `匯出結果超過 ${this.maxRows} 筆上限`, { maxRows: this.maxRows }
      );
    } catch (error) {
      await this.#fail(job.id, operationId, error.publicCode ?? "CUSTOMER_EXPORT_FAILED", "客戶匯出失敗");
      throw error;
    }

    let staged;
    try {
      staged = await this.storage.stageResult({ operationId, source: this.#csv({ first, filters, actorId, claimedRoles, claimedPermissions }) });
      if (staged.storedName !== job.result_stored_name) throw new Error("Customer export result metadata mismatch");
      await this.storage.finalizeResult(staged);
    } catch (error) {
      if (error?.publicCode) {
        await this.#fail(job.id, operationId, error.publicCode, "客戶匯出失敗");
        throw error;
      }
      await this.#fail(job.id, operationId, "RESULT_STORAGE_ERROR", "客戶匯出檔案無法安全保存", { storageError: true });
      throw customerExportError("CUSTOMER_EXPORT_STORAGE_ERROR", 503, "客戶匯出檔案無法安全保存");
    }

    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
        const nowMs = this.time.nowMs();
        const [updated] = await connection.execute(
          `UPDATE customer_export_jobs SET result_sha256 = ?, result_storage_status = 'active',
             status = 'completed', total_count = ?, expires_at = ?, updated_at = ?, completed_at = ?, version = version + 1
           WHERE id = ? AND status = 'processing' AND result_storage_status = 'processing'`,
          [staged.sha256, first.total, nowMs + RETENTION_MS, nowMs, nowMs, job.id]
        );
        const completed = await this.#get(connection, job.id);
        if (updated.affectedRows === 1) {
          await this.audit.record(connection, {
            occurredAt: nowMs, actorUserId: actorId, actorUsername: actor.username, action: "export.create",
            targetType: "export", targetId: Number(job.id), customerId: null, targetLabel: `export-${job.id}`,
            detail: { after: { totalCount: first.total, filterSnapshot: filters } }, requestId, ip
          });
          await this.operations.succeed(connection, {
            operationId, resourceType: "export", resourceId: Number(job.id), resultVersion: Number(completed.version), nowMs
          });
        }
        return summary(completed);
      });
    } catch (error) {
      if ([401, 403].includes(error?.statusCode)) await this.#fail(job.id, operationId, "AUTHORIZATION_REVOKED", "匯出完成前權限已被撤銷");
      throw error;
    }
  }

  async *#csv({ first, filters, actorId, claimedRoles, claimedPermissions }) {
    yield `${HEADER.join(",")}\r\n`;
    const total = first.total;
    let page = 1; let result = first; let emitted = 0;
    while (true) {
      for (const customer of result.items) {
        if (emitted >= total) throw customerExportError("CUSTOMER_EXPORT_STATE_CONFLICT", 409, "匯出期間客戶資料已變更，請重試");
        yield `${HEADER.map((field) => csvCell(customer[field === "customerCode" ? "code" : field])).join(",")}\r\n`;
        emitted += 1;
      }
      if (emitted >= total) return;
      page += 1;
      result = await this.customerService.list({ actorId, claimedRoles, claimedPermissions, ...filters, page, pageSize: 100 });
      if (result.total !== total || result.items.length === 0) throw customerExportError("CUSTOMER_EXPORT_STATE_CONFLICT", 409, "匯出期間客戶資料已變更，請重試");
    }
  }

  async get({ actorId, claimedRoles, claimedPermissions, id }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [rows] = await this.database.query(`SELECT ${SELECT} FROM customer_export_jobs WHERE id = ? AND created_by = ?`, [id, actorId]);
    if (!rows[0] || Number(rows[0].created_by) !== actorId) throw customerExportError("CUSTOMER_EXPORT_NOT_FOUND", 404, "找不到指定的匯出工作");
    return summary(rows[0]);
  }

  async download({ actorId, claimedRoles, claimedPermissions, id, requestId = "", ip = "" }) {
    const metadata = await this.database.withTransaction(async (connection) => {
      await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const job = await this.#owned(connection, id, actorId);
      this.#assertDownloadable(job);
      return { storedName: job.result_stored_name, sha256: Buffer.from(job.result_sha256), version: Number(job.version) };
    });
    let buffer;
    try { buffer = await this.storage.readResult(metadata); }
    catch { throw customerExportError("CUSTOMER_EXPORT_STORAGE_ERROR", 503, "客戶匯出檔案目前不可用"); }
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const job = await this.#owned(connection, id, actorId);
      this.#assertDownloadable(job);
      if (Number(job.version) !== metadata.version || job.result_stored_name !== metadata.storedName || !Buffer.from(job.result_sha256).equals(metadata.sha256)) {
        throw customerExportError("CUSTOMER_EXPORT_STATE_CONFLICT", 409, "匯出檔案狀態已變更，請重試");
      }
      await this.audit.record(connection, {
        occurredAt: this.time.nowMs(), actorUserId: actorId, actorUsername: actor.username, action: "export.download",
        targetType: "export", targetId: Number(id), customerId: null, targetLabel: `export-${id}`, detail: null, requestId, ip
      });
    });
    return { buffer, fileName: `customers-export-${id}.csv` };
  }

  #assertDownloadable(job) {
    if (job.status !== "completed" || job.result_storage_status !== "active" || !job.result_sha256) {
      throw customerExportError("CUSTOMER_EXPORT_NOT_READY", 409, "客戶匯出檔案尚未就緒");
    }
    if (Number(job.expires_at) <= this.time.nowMs()) throw customerExportError("CUSTOMER_EXPORT_EXPIRED", 410, "客戶匯出檔案已過期");
  }

  async #owned(connection, id, actorId) {
    const [[job]] = await connection.query(`SELECT ${SELECT} FROM customer_export_jobs WHERE id = ? AND created_by = ? FOR SHARE`, [id, actorId]);
    if (!job || Number(job.created_by) !== actorId) throw customerExportError("CUSTOMER_EXPORT_NOT_FOUND", 404, "找不到指定的匯出工作");
    return job;
  }

  async #get(connection, id) {
    const [[row]] = await connection.query(`SELECT ${SELECT} FROM customer_export_jobs WHERE id = ?`, [id]);
    return row ?? null;
  }

  async #getByOperation(connection, operationId) {
    const [[row]] = await connection.query(`SELECT ${SELECT} FROM customer_export_jobs WHERE operation_id = ?`, [operationId]);
    return row ?? null;
  }

  async #fail(id, operationId, code, message, { storageError = false } = {}) {
    await this.database.withTransaction(async (connection) => {
      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE customer_export_jobs SET result_storage_status = ${storageError ? "'storage_error'" : "result_storage_status"}, status = 'failed',
           last_error_code = ?, error_summary = ?, updated_at = ?, completed_at = ?, version = version + 1
         WHERE id = ? AND status = 'processing'`,
        [String(code).slice(0, 80), message, nowMs, nowMs, id]
      );
      await this.operations.fail(connection, { operationId, errorCode: code, nowMs });
    });
  }
}
