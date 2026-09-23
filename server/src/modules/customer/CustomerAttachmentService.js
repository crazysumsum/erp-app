import path from "node:path";
import { createHash } from "node:crypto";

import { assertActorFresh } from "../authorization/directoryLookups.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerOperationService } from "./CustomerOperationService.js";
import { customerAttachmentError, customerNotFound } from "./customerErrors.js";
import { customerAttachmentStoredName } from "../../services/customerFile/CustomerAttachmentStorage.js";

const DOCUMENT_TYPES = new Set(["business_certificate", "credit_application", "contract", "bank_proof", "other"]);
const SENSITIVITIES = new Set(["general", "bank_sensitive"]);
const ATTACHMENT_ACTIONS = new Set(["attachment.upload", "attachment.view", "attachment.download", "attachment.update", "attachment.deactivate", "attachment.delete"]);

function text(value, field, maxLength, { required = true } = {}) {
  const result = String(value ?? "").trim();
  if ((required && !result) || Array.from(result).length > maxLength || /\p{Cc}/u.test(result)) {
    throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "附件資料無效", { field });
  }
  return result;
}

function normalizeMetadata(input) {
  const documentType = String(input.documentType ?? "").trim();
  const sensitivity = String(input.sensitivity ?? "").trim();
  if (!DOCUMENT_TYPES.has(documentType) || !SENSITIVITIES.has(sensitivity) ||
      (documentType === "bank_proof" && sensitivity !== "bank_sensitive")) {
    throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "附件類型或敏感級別無效");
  }
  const sortOrder = Number(input.sortOrder ?? 0);
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) {
    throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "附件排序無效", { field: "sortOrder" });
  }
  const reason = text(input.reason, "reason", 500);
  if (reason.length < 5) throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "附件操作原因最少需要 5 個字元", { field: "reason" });
  return {
    displayName: text(input.displayName, "displayName", 190), documentType, sensitivity,
    originalFilename: text(path.basename(String(input.originalFilename ?? "")), "originalFilename", 255),
    notes: text(input.notes, "notes", 500, { required: false }), sortOrder, reason
  };
}

function normalizeUpdate(input, sensitivity) {
  const documentType = String(input.documentType ?? "").trim();
  if (!DOCUMENT_TYPES.has(documentType) || (documentType === "bank_proof" && sensitivity !== "bank_sensitive")) {
    throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "附件類型無效", { field: "documentType" });
  }
  const sortOrder = Number(input.sortOrder ?? 0);
  const version = Number(input.version);
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || !Number.isSafeInteger(version) || version < 1) {
    throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "附件版本或排序無效");
  }
  const reason = text(input.reason, "reason", 500);
  if (reason.length < 5) throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "附件操作原因最少需要 5 個字元", { field: "reason" });
  return {
    displayName: text(input.displayName, "displayName", 190), documentType,
    notes: text(input.notes, "notes", 500, { required: false }), sortOrder, version, reason
  };
}

function projection(row) {
  return {
    id: Number(row.id), customerId: Number(row.customer_id), displayName: row.display_name,
    documentType: row.document_type, sensitivity: row.sensitivity, originalFilename: row.original_filename,
    mimeType: row.mime_type, extension: row.extension, sizeBytes: Number(row.size_bytes),
    storageClass: row.storage_class, scanStatus: row.scan_status, status: row.status,
    sortOrder: Number(row.sort_order), notes: row.notes, version: Number(row.version), updatedAt: Number(row.updated_at)
  };
}

async function hasUnregisteredAttachmentReferences(connection) {
  const [rows] = await connection.query(
    `SELECT table_name FROM information_schema.key_column_usage
      WHERE referenced_table_schema = DATABASE() AND referenced_table_name = 'customer_attachments'
        AND referenced_column_name = 'id' LIMIT 1`
  );
  return rows.length > 0;
}

export class CustomerAttachmentService {
  constructor({ database, time, storage, accessTokens = null, isReferenced = hasUnregisteredAttachmentReferences, authorize = assertActorFresh, audit = new CustomerAuditLogService(), operations = new CustomerOperationService() } = {}) {
    if (!database || !time || !storage) throw new TypeError("CustomerAttachmentService requires database, time and storage");
    this.database = database; this.time = time; this.storage = storage; this.accessTokens = accessTokens; this.isReferenced = isReferenced; this.authorize = authorize; this.audit = audit; this.operations = operations;
  }

  #assertManage(actor, sensitivity) {
    const required = sensitivity === "bank_sensitive"
      ? ["customer.view", "customer.bank.view", "customer.bank.mgmt"]
      : ["customer.view", "customer.mgmt"];
    if (!required.every((permission) => actor?.permissions?.includes(permission))) {
      throw customerAttachmentError("CUSTOMER_ATTACHMENT_PERMISSION_LOST", 403, "你目前沒有維護這項附件的權限");
    }
  }

  #assertView(actor, sensitivity) {
    const required = sensitivity === "bank_sensitive"
      ? ["customer.view", "customer.bank.view"]
      : ["customer.view"];
    if (!required.every((permission) => actor?.permissions?.includes(permission))) {
      throw customerAttachmentError("CUSTOMER_ATTACHMENT_PERMISSION_LOST", 403, "你目前沒有查看這項附件的權限");
    }
  }

  async #row(connection, input, { lock = false } = {}) {
    const [[row]] = await connection.query(
      `SELECT * FROM customer_attachments WHERE id = ? AND customer_id = ?${lock ? " FOR UPDATE" : ""}`,
      [input.attachmentId, input.customerId]
    );
    if (!row) throw customerAttachmentError("CUSTOMER_ATTACHMENT_NOT_FOUND", 404, "找不到指定的附件");
    return row;
  }

  async list(input) {
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assertView(actor, "general");
      const [[customer]] = await connection.query("SELECT id,customer_code FROM customers WHERE id = ?", [input.customerId]);
      if (!customer) throw customerNotFound(input.customerId);
      const [rows] = await connection.query(
        "SELECT * FROM customer_attachments WHERE customer_id = ? AND status IN ('active','inactive') ORDER BY sort_order,id",
        [input.customerId]
      );
      const canViewSensitive = actor.permissions.includes("customer.bank.view");
      const items = rows.filter((row) => row.sensitivity !== "bank_sensitive" || canViewSensitive).map(projection);
      const restrictedCount = rows.length - items.length;
      await this.audit.record(connection, {
        occurredAt: this.time.nowMs(), actorUserId: input.actorId, actorUsername: actor.username,
        action: "attachment.view", targetType: "customer", targetId: Number(input.customerId),
        customerId: Number(input.customerId), targetLabel: customer.customer_code, reason: "view customer attachments",
        detail: { after: { status: "listed", count: items.length, restrictedCount } }, requestId: input.requestId, ip: input.ip
      });
      return { items, restrictedCount };
    });
  }

  async auditFailure(input) {
    if (!ATTACHMENT_ACTIONS.has(input.action)) throw new TypeError("Unsupported Customer attachment failure audit action");
    const customerId = Number(input.customerId); const attachmentId = Number(input.attachmentId);
    const validCustomerId = Number.isSafeInteger(customerId) && customerId > 0;
    const validAttachmentId = Number.isSafeInteger(attachmentId) && attachmentId > 0;
    const requestedSensitivity = SENSITIVITIES.has(input.sensitivity) ? input.sensitivity : "unknown";
    const errorCode = /^[A-Z0-9_]{1,80}$/u.test(String(input.errorCode ?? "")) ? String(input.errorCode) : "REQUEST_FAILED";
    await this.database.withTransaction(async (connection) => {
      const [[customer]] = validCustomerId
        ? await connection.query("SELECT id FROM customers WHERE id = ?", [customerId])
        : [[]];
      const [[attachment]] = customer && validAttachmentId
        ? await connection.query("SELECT id,sensitivity FROM customer_attachments WHERE id = ? AND customer_id = ?", [attachmentId, customerId])
        : [[]];
      await this.audit.record(connection, {
        occurredAt: this.time.nowMs(), actorUserId: input.actorId, actorUsername: "", action: input.action,
        targetType: validAttachmentId ? "attachment" : "customer", targetId: validAttachmentId ? attachmentId : (customer?.id ?? null),
        customerId: customer?.id ?? null, targetLabel: "", reason: `${input.action} attempt failed`,
        detail: { after: { sensitivity: attachment?.sensitivity ?? requestedSensitivity, status: "failed", errorCode } },
        requestId: input.requestId, ip: input.ip
      });
    });
  }

  async issueUploadSession(input) {
    if (!this.accessTokens || !/^[0-9a-f]{64}$/u.test(String(input.contentSha256 ?? ""))) {
      throw customerAttachmentError("CUSTOMER_ATTACHMENT_SESSION_INVALID", 400, "附件上傳授權資料無效");
    }
    const value = normalizeMetadata(input);
    if (value.sensitivity !== "bank_sensitive") throw customerAttachmentError("CUSTOMER_ATTACHMENT_SESSION_INVALID", 400, "一般附件不需要敏感上傳授權");
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assertManage(actor, value.sensitivity);
      const [[customer]] = await connection.query("SELECT id FROM customers WHERE id = ?", [input.customerId]);
      if (!customer) throw customerNotFound(input.customerId);
    });
    return this.accessTokens.issue({ purpose: "upload", actorId: Number(input.actorId), customerId: Number(input.customerId), binding: input.binding });
  }

  async create(input) {
    const value = normalizeMetadata(input);
    if (!Buffer.isBuffer(input.content)) throw customerAttachmentError("CUSTOMER_ATTACHMENT_REJECTED", 422, "附件未通過檔案安全檢查");
    const payload = {
      customerId: Number(input.customerId), displayName: value.displayName, documentType: value.documentType,
      sensitivity: value.sensitivity, originalFilename: value.originalFilename, mimeType: String(input.mimeType ?? ""),
      notes: value.notes, sortOrder: value.sortOrder, reason: value.reason,
      contentSha256: createHash("sha256").update(input.content).digest("hex")
    };
    let reserved;
    try {
      reserved = await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        this.#assertManage(actor, value.sensitivity);
        if (value.sensitivity === "bank_sensitive") {
          if (!this.accessTokens) throw customerAttachmentError("CUSTOMER_ATTACHMENT_SESSION_INVALID", 503, "敏感附件功能目前無法使用");
          this.accessTokens.verify(input.sessionToken, {
            purpose: "upload", actorId: Number(input.actorId), customerId: Number(input.customerId), binding: input.binding
          });
        }
        const operation = await this.operations.begin(connection, {
          actorId: input.actorId, routeKey: "customer.attachment.upload", idempotencyKey: input.idempotencyKey,
          payload, nowMs: this.time.nowMs()
        });
        return { actor, operation };
      });
    } catch (error) {
      await this.#auditAttempt(input, value, "denied").catch(() => {});
      throw error;
    }
    const operationId = reserved.operation.operationId;
    if (reserved.operation.replay) {
      const [rows] = await this.database.query("SELECT * FROM customer_attachments WHERE operation_id = ? AND customer_id = ?", [operationId, input.customerId]);
      if (rows[0]?.status === "active") return projection(rows[0]);
      if (reserved.operation.replay.status === "failed") {
        throw customerAttachmentError("CUSTOMER_ATTACHMENT_OPERATION_CONFLICT", 409, "附件操作已失敗，請使用新的請求識別碼");
      }
      if (rows[0]) throw customerAttachmentError("CUSTOMER_ATTACHMENT_IN_PROGRESS", 409, "附件仍在處理或等待復原");
      throw customerAttachmentError(
        reserved.operation.replay.status === "processing" ? "CUSTOMER_ATTACHMENT_IN_PROGRESS" : "CUSTOMER_ATTACHMENT_OPERATION_CONFLICT",
        409, "附件操作仍在處理或狀態不一致，請稍後查詢或使用新的請求識別碼"
      );
    }
    const stagedName = customerAttachmentStoredName(operationId);
    await this.database.withTransaction(async (connection) => {
      const [[operation]] = await connection.query("SELECT status FROM customer_operation_requests WHERE id = ? FOR UPDATE", [operationId]);
      if (operation?.status !== "processing") {
        throw customerAttachmentError("CUSTOMER_ATTACHMENT_OPERATION_CONFLICT", 409, "附件操作狀態不一致，請使用新的請求識別碼");
      }
      const now = this.time.nowMs();
      await connection.execute(
        "INSERT INTO customer_attachment_stages (operation_id,stored_name,created_at,updated_at) VALUES (?,?,?,?)",
        [operationId, stagedName, now, now]
      );
    });
    let stored;
    try {
      stored = await this.storage.stage({
        operationId, customerId: input.customerId, sensitivity: value.sensitivity,
        content: input.content, mimeType: input.mimeType, originalFilename: value.originalFilename
      });
    } catch (error) {
      const errorCode = error?.code === "CUSTOMER_ATTACHMENT_REJECTED" ? "CUSTOMER_ATTACHMENT_REJECTED" : "CUSTOMER_ATTACHMENT_STORAGE_UNAVAILABLE";
      await this.#abortStage(operationId, stagedName, errorCode);
      await this.#auditAttempt(input, value, errorCode === "CUSTOMER_ATTACHMENT_REJECTED" ? "rejected" : "storage_error");
      if (error?.code === "CUSTOMER_ATTACHMENT_REJECTED") {
        throw customerAttachmentError("CUSTOMER_ATTACHMENT_REJECTED", 422, "附件未通過檔案安全檢查");
      }
      throw customerAttachmentError("CUSTOMER_ATTACHMENT_STORAGE_UNAVAILABLE", 503, "附件安全掃描或儲存服務暫時無法使用");
    }

    let created;
    try {
      created = await this.database.withTransaction(async (connection) => {
        const freshActor = await this.authorize(connection, input);
        this.#assertManage(freshActor, value.sensitivity);
        const [[operation]] = await connection.query("SELECT status FROM customer_operation_requests WHERE id = ? FOR UPDATE", [operationId]);
        if (operation?.status !== "processing") {
          throw customerAttachmentError("CUSTOMER_ATTACHMENT_OPERATION_CONFLICT", 409, "附件操作狀態不一致，請使用新的請求識別碼");
        }
        const [[customer]] = await connection.query("SELECT id, customer_code FROM customers WHERE id = ? FOR UPDATE", [input.customerId]);
        if (!customer) throw customerNotFound(input.customerId);
        const now = this.time.nowMs();
        const [result] = await connection.execute(
        `INSERT INTO customer_attachments
          (customer_id,display_name,document_type,sensitivity,original_filename,operation_id,stored_name,
           mime_type,extension,size_bytes,sha256,storage_class,scan_status,status,sort_order,notes,
           version,created_at,updated_at,created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'processing',?,?,1,?,?,?,?)`,
        [input.customerId, value.displayName, value.documentType, value.sensitivity, value.originalFilename,
          operationId, stored.storedName, stored.mimeType, stored.extension, stored.sizeBytes, stored.sha256,
          stored.storageClass, stored.scanStatus, value.sortOrder, value.notes, now, now, input.actorId, input.actorId]
      );
        await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: freshActor.username,
        action: "attachment.upload", targetType: "attachment", targetId: Number(result.insertId),
        customerId: Number(input.customerId), targetLabel: customer.customer_code, reason: value.reason,
        detail: { after: { displayName: value.displayName, documentType: value.documentType, sensitivity: value.sensitivity,
          mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, storageClass: stored.storageClass,
          scanStatus: stored.scanStatus, status: "processing" } }, requestId: input.requestId, ip: input.ip
      });
        await connection.execute("DELETE FROM customer_attachment_stages WHERE operation_id = ? AND stored_name = ?", [operationId, stagedName]);
        return { id: Number(result.insertId), version: 1 };
      });
    } catch (error) {
      await this.#abortStage(operationId, stagedName, error?.publicCode ?? "CUSTOMER_ATTACHMENT_METADATA_FAILED");
      await this.#auditAttempt(input, value, "rejected").catch(() => {});
      throw error;
    }

    const finalizeInput = { ...stored, operationId, customerId: input.customerId, sensitivity: value.sensitivity };
    try { await this.storage.finalize(finalizeInput); }
    catch {
      await this.#finish({ ...input, ...created, operationId, status: "storage_error", actorUsername: reserved.actor.username, value, stored });
      throw customerAttachmentError("CUSTOMER_ATTACHMENT_STORAGE_FAILED", 503, "附件儲存未完成，請稍後重試");
    }
    try {
      return await this.#finish({ ...input, ...created, operationId, status: "active", actorUsername: reserved.actor.username, value, stored, reauthorize: true });
    } catch (error) {
      if (!["PERMISSION_STALE", "CUSTOMER_ATTACHMENT_PERMISSION_LOST"].includes(error?.publicCode)) throw error;
      await this.#finish({ ...input, ...created, operationId, status: "inactive", actorUsername: reserved.actor.username, value, stored });
      throw error;
    }
  }

  async update(input) {
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const row = await this.#row(connection, input, { lock: true });
      this.#assertManage(actor, row.sensitivity);
      if (row.status !== "active") throw customerAttachmentError("CUSTOMER_ATTACHMENT_INACTIVE", 409, "已停用的附件不能修改");
      const value = normalizeUpdate(input, row.sensitivity);
      if (Number(row.version) !== value.version) throw customerAttachmentError("VERSION_CONFLICT", 409, "資料已被修改，請重新載入後再試", { currentVersion: Number(row.version) });
      const now = this.time.nowMs();
      const [result] = await connection.execute(
        "UPDATE customer_attachments SET display_name=?,document_type=?,sort_order=?,notes=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND customer_id=? AND status='active' AND version=?",
        [value.displayName, value.documentType, value.sortOrder, value.notes, now, input.actorId, input.attachmentId, input.customerId, value.version]
      );
      if (Number(result.affectedRows) !== 1) throw customerAttachmentError("VERSION_CONFLICT", 409, "資料已被修改，請重新載入後再試");
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: actor.username, action: "attachment.update",
        targetType: "attachment", targetId: Number(row.id), customerId: Number(input.customerId), targetLabel: "",
        reason: value.reason, detail: { before: { displayName: row.display_name, documentType: row.document_type, sortOrder: Number(row.sort_order), notes: row.notes }, after: { displayName: value.displayName, documentType: value.documentType, sortOrder: value.sortOrder, notes: value.notes } }, requestId: input.requestId, ip: input.ip
      });
      return projection({ ...row, display_name: value.displayName, document_type: value.documentType, sort_order: value.sortOrder, notes: value.notes, version: value.version + 1, updated_at: now });
    });
  }

  async deactivate(input) {
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const row = await this.#row(connection, input, { lock: true });
      this.#assertManage(actor, row.sensitivity);
      const version = Number(input.version); const reason = text(input.reason, "reason", 500);
      if (reason.length < 5 || version !== Number(row.version) || row.status !== "active") {
        throw customerAttachmentError("VERSION_CONFLICT", 409, "附件狀態已變更，請重新載入後再試", { currentVersion: Number(row.version) });
      }
      const now = this.time.nowMs();
      const [result] = await connection.execute(
        "UPDATE customer_attachments SET status='inactive',version=version+1,updated_at=?,updated_by=? WHERE id=? AND customer_id=? AND status='active' AND version=?",
        [now, input.actorId, input.attachmentId, input.customerId, version]
      );
      if (Number(result.affectedRows) !== 1) throw customerAttachmentError("VERSION_CONFLICT", 409, "附件狀態已變更，請重新載入後再試");
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: actor.username, action: "attachment.deactivate",
        targetType: "attachment", targetId: Number(row.id), customerId: Number(input.customerId), targetLabel: "",
        reason, detail: { before: { status: row.status }, after: { status: "inactive" } }, requestId: input.requestId, ip: input.ip
      });
      return projection({ ...row, status: "inactive", version: version + 1, updated_at: now });
    });
  }

  async issueDownloadSession(input) {
    if (!this.accessTokens) throw customerAttachmentError("CUSTOMER_ATTACHMENT_SESSION_INVALID", 503, "敏感附件功能目前無法使用");
    const mode = input.mode === "preview" ? "preview" : "download";
    const reason = text(input.reason, "reason", 500);
    if (reason.length < 5) throw customerAttachmentError("CUSTOMER_ATTACHMENT_INVALID", 400, "查看原因最少需要 5 個字元");
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const row = await this.#row(connection, input);
      if (row.sensitivity !== "bank_sensitive" || !["active", "inactive"].includes(row.status)) {
        throw customerAttachmentError("CUSTOMER_ATTACHMENT_NOT_FOUND", 404, "找不到指定的附件");
      }
      this.#assertView(actor, row.sensitivity);
      await this.audit.record(connection, {
        occurredAt: this.time.nowMs(), actorUserId: input.actorId, actorUsername: actor.username,
        action: mode === "preview" ? "attachment.view" : "attachment.download", targetType: "attachment",
        targetId: Number(row.id), customerId: Number(input.customerId), targetLabel: "", reason,
        detail: { after: { sensitivity: row.sensitivity, status: "authorized" } }, requestId: input.requestId, ip: input.ip
      });
      return this.accessTokens.issue({ purpose: "download", mode, actorId: Number(input.actorId), customerId: Number(input.customerId), attachmentId: Number(row.id) });
    });
  }

  async read(input) {
    const mode = input.mode === "preview" ? "preview" : "download";
    const row = await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const found = await this.#row(connection, input);
      if (!["active", "inactive"].includes(found.status)) throw customerAttachmentError("CUSTOMER_ATTACHMENT_NOT_FOUND", 404, "找不到指定的附件");
      this.#assertView(actor, found.sensitivity);
      if (found.sensitivity === "bank_sensitive") {
        if (!this.accessTokens) throw customerAttachmentError("CUSTOMER_ATTACHMENT_SESSION_INVALID", 503, "敏感附件功能目前無法使用");
        this.accessTokens.verify(input.sessionToken, { purpose: "download", mode, actorId: Number(input.actorId), customerId: Number(input.customerId), attachmentId: Number(found.id) });
      } else {
        await this.audit.record(connection, {
          occurredAt: this.time.nowMs(), actorUserId: input.actorId, actorUsername: actor.username,
          action: mode === "preview" ? "attachment.view" : "attachment.download", targetType: "attachment",
          targetId: Number(found.id), customerId: Number(input.customerId), targetLabel: "", reason: `${mode} general attachment`,
          detail: { after: { sensitivity: found.sensitivity, status: "authorized" } }, requestId: input.requestId, ip: input.ip
        });
      }
      return found;
    });
    if (mode === "preview" && !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(row.mime_type)) {
      throw customerAttachmentError("CUSTOMER_ATTACHMENT_PREVIEW_UNSUPPORTED", 415, "此附件格式不支援預覽");
    }
    return { attachment: projection(row), content: await this.storage.read({
      operationId: row.operation_id, customerId: row.customer_id, storedName: row.stored_name,
      sensitivity: row.sensitivity, sizeBytes: row.size_bytes, sha256: row.sha256
    }) };
  }

  async delete(input) {
    let row;
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      const [[customer]] = await connection.query("SELECT id,status,ever_activated_at FROM customers WHERE id = ? FOR UPDATE", [input.customerId]);
      if (!customer) throw customerNotFound(input.customerId);
      row = await this.#row(connection, input, { lock: true });
      this.#assertManage(actor, row.sensitivity);
      const reason = text(input.reason, "reason", 500);
      if (reason.length < 5 || Number(input.version) !== Number(row.version) || customer.status !== "draft" || customer.ever_activated_at !== null || row.status === "processing" || await this.isReferenced(connection, Number(row.id))) {
        throw customerAttachmentError("CUSTOMER_ATTACHMENT_DELETE_NOT_ALLOWED", 409, "此附件仍須保留，不能永久刪除");
      }
      const now = this.time.nowMs();
      const [result] = await connection.execute(
        "UPDATE customer_attachments SET status='deleting',version=version+1,updated_at=?,updated_by=? WHERE id=? AND customer_id=? AND version=? AND status<>'processing'",
        [now, input.actorId, input.attachmentId, input.customerId, input.version]
      );
      if (Number(result.affectedRows) !== 1) throw customerAttachmentError("VERSION_CONFLICT", 409, "附件狀態已變更，請重新載入後再試");
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: actor.username, action: "attachment.delete",
        targetType: "attachment", targetId: Number(row.id), customerId: Number(input.customerId), targetLabel: "", reason,
        detail: { before: { status: row.status, sensitivity: row.sensitivity }, after: { status: "deleting" } }, requestId: input.requestId, ip: input.ip
      });
    });
    try { await this.storage.delete({ storedName: row.stored_name, sensitivity: row.sensitivity }); }
    catch {
      await this.database.withTransaction((connection) => connection.execute(
        "UPDATE customer_attachments SET status='delete_failed',updated_at=? WHERE id=? AND customer_id=? AND status='deleting'",
        [this.time.nowMs(), input.attachmentId, input.customerId]
      ));
      throw customerAttachmentError("CUSTOMER_ATTACHMENT_DELETE_FAILED", 503, "附件刪除尚未完成，系統會自動重試");
    }
    await this.database.withTransaction((connection) => connection.execute(
      "DELETE FROM customer_attachments WHERE id=? AND customer_id=? AND status='deleting'",
      [input.attachmentId, input.customerId]
    ));
    return { deleted: true };
  }

  async #abortStage(operationId, storedName, errorCode) {
    let discarded = false;
    try { await this.storage.discardTemp({ storedName }); discarded = true; }
    catch { /* durable stage row keeps cleanup recoverable */ }
    await this.database.withTransaction(async (connection) => {
      await this.operations.fail(connection, { operationId, errorCode, nowMs: this.time.nowMs() });
      if (discarded) {
        await connection.execute("DELETE FROM customer_attachment_stages WHERE operation_id = ? AND stored_name = ?", [operationId, storedName]);
      }
    });
  }

  async #auditAttempt(input, value, status) {
    await this.database.withTransaction((connection) => this.audit.record(connection, {
      occurredAt: this.time.nowMs(), actorUserId: input.actorId, actorUsername: "",
      action: "attachment.upload", targetType: "attachment", targetId: null,
      customerId: Number(input.customerId), targetLabel: "", reason: value.reason,
      detail: { after: { sensitivity: value.sensitivity, status } }, requestId: input.requestId, ip: input.ip
    }));
  }

  async #finish(input) {
    return this.database.withTransaction(async (connection) => {
      if (input.reauthorize) {
        const freshActor = await this.authorize(connection, input);
        this.#assertManage(freshActor, input.value.sensitivity);
        input.actorUsername = freshActor.username;
      }
      const now = this.time.nowMs();
      const [result] = await connection.execute(
        "UPDATE customer_attachments SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND customer_id = ? AND status = 'processing' AND version = ?",
        [input.status, now, input.actorId, input.id, input.customerId, input.version]
      );
      if (Number(result.affectedRows) !== 1) {
        throw customerAttachmentError("CUSTOMER_ATTACHMENT_FINALIZE_CONFLICT", 409, "附件狀態已變更");
      }
      const [[row]] = await connection.query("SELECT * FROM customer_attachments WHERE id = ? AND customer_id = ?", [input.id, input.customerId]);
      if (input.status === "active") {
        await this.operations.succeed(connection, {
          operationId: input.operationId, resourceType: "customer_attachment", resourceId: input.id,
          resultVersion: Number(row.version), nowMs: now
        });
      } else {
        await this.operations.fail(connection, {
          operationId: input.operationId,
          errorCode: input.status === "inactive" ? "CUSTOMER_ATTACHMENT_PERMISSION_LOST" : "CUSTOMER_ATTACHMENT_STORAGE_FAILED",
          nowMs: now
        });
      }
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: input.actorUsername,
        action: "attachment.upload", targetType: "attachment", targetId: input.id,
        customerId: Number(input.customerId), targetLabel: "", reason: input.value.reason,
        detail: { after: { displayName: input.value.displayName, documentType: input.value.documentType,
          sensitivity: input.value.sensitivity, mimeType: input.stored.mimeType, sizeBytes: input.stored.sizeBytes,
          storageClass: input.stored.storageClass, scanStatus: input.stored.scanStatus, status: input.status } },
        requestId: input.requestId, ip: input.ip
      });
      return projection(row);
    });
  }
}

export class CustomerAttachmentRecoveryService {
  constructor({ database, time, storage, audit = new CustomerAuditLogService(), operations = new CustomerOperationService() } = {}) {
    if (!database || !time || !storage) throw new TypeError("CustomerAttachmentRecoveryService requires database, time and storage");
    this.database = database; this.time = time; this.storage = storage; this.audit = audit; this.operations = operations;
  }

  async recoverBatch({ afterId = 0, batchSize = 100, staleBeforeMs }) {
    const cursor = Number(afterId); const limit = Number(batchSize); const before = Number(staleBeforeMs);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
        !Number.isSafeInteger(before) || before < 0) {
      throw new TypeError("Customer attachment recovery cursor, batch size or cutoff is invalid");
    }
    const [rows] = await this.database.query(
      `SELECT id,customer_id,operation_id,stored_name,sensitivity,size_bytes,sha256,scan_status,version
         FROM customer_attachments WHERE id > ? AND status = 'processing' AND updated_at <= ? ORDER BY id LIMIT ?`,
      [cursor, before, limit]
    );
    let activated = 0; let failed = 0; let lastId = cursor;
    for (const row of rows) {
      const status = row.scan_status === "clean" ? await this.storage.recover({
        operationId: row.operation_id, customerId: row.customer_id, storedName: row.stored_name,
        sensitivity: row.sensitivity, sizeBytes: row.size_bytes, sha256: row.sha256
      }) : "storage_error";
      await this.database.withTransaction(async (connection) => {
        const now = this.time.nowMs();
        const [result] = await connection.execute(
          "UPDATE customer_attachments SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'processing' AND scan_status = ? AND version = ?",
          [status, now, row.id, row.scan_status, row.version]
        );
        if (Number(result.affectedRows) !== 1) return;
        if (status === "active") {
          await this.operations.succeed(connection, {
            operationId: row.operation_id, resourceType: "customer_attachment", resourceId: Number(row.id),
            resultVersion: Number(row.version) + 1, nowMs: now
          });
        } else {
          await this.operations.fail(connection, {
            operationId: row.operation_id, errorCode: "CUSTOMER_ATTACHMENT_RECOVERY_FAILED", nowMs: now
          });
        }
        await this.audit.record(connection, {
          occurredAt: now, actorUserId: null, actorUsername: "customer-file-recovery",
          action: "attachment.upload", targetType: "attachment", targetId: Number(row.id),
          customerId: Number(row.customer_id), targetLabel: "", reason: "stale attachment finalize recovery",
          detail: { after: { status } }, requestId: "", ip: ""
        });
        if (status === "active") activated += 1; else failed += 1;
      });
      lastId = Number(row.id);
    }
    return { processed: rows.length, activated, failed, lastId };
  }

  async cleanupStaleStages({ cutoffMs, batchSize = 100 }) {
    const before = Number(cutoffMs); const limit = Number(batchSize);
    if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new TypeError("Customer attachment stage cleanup cutoff or batch size is invalid");
    }
    const [rows] = await this.database.query(
      `SELECT operation_id,stored_name FROM customer_attachment_stages
        WHERE updated_at <= ? ORDER BY updated_at,operation_id LIMIT ?`,
      [before, limit]
    );
    let cleaned = 0; let failed = 0;
    for (const row of rows) {
      let candidate = null;
      await this.database.withTransaction(async (connection) => {
        const [[operation]] = await connection.query(
          "SELECT status FROM customer_operation_requests WHERE id = ? FOR UPDATE", [row.operation_id]
        );
        if (!operation) return;
        const [[stage]] = await connection.query(
          "SELECT stored_name,updated_at FROM customer_attachment_stages WHERE operation_id = ? FOR UPDATE", [row.operation_id]
        );
        if (!stage || Number(stage.updated_at) > before) return;
        const [[attachment]] = await connection.query("SELECT id FROM customer_attachments WHERE operation_id = ?", [row.operation_id]);
        if (attachment) {
          await connection.execute("DELETE FROM customer_attachment_stages WHERE operation_id = ?", [row.operation_id]);
          cleaned += 1;
          return;
        }
        if (operation.status === "processing") {
          await this.operations.fail(connection, {
            operationId: row.operation_id, errorCode: "CUSTOMER_ATTACHMENT_ABANDONED", nowMs: this.time.nowMs()
          });
        }
        candidate = { operationId: row.operation_id, storedName: stage.stored_name };
      });
      if (!candidate) continue;
      try { await this.storage.discardTemp({ storedName: candidate.storedName }); }
      catch { failed += 1; continue; }
      await this.database.withTransaction((connection) => connection.execute(
        "DELETE FROM customer_attachment_stages WHERE operation_id = ? AND stored_name = ?",
        [candidate.operationId, candidate.storedName]
      ));
      cleaned += 1;
    }
    return { processed: rows.length, cleaned, failed };
  }

  async failAbandonedOperations({ cutoffMs, batchSize = 100 }) {
    const [rows] = await this.database.query(
      `SELECT operation.id
         FROM customer_operation_requests operation
         LEFT JOIN customer_attachments attachment ON attachment.operation_id = operation.id
         LEFT JOIN customer_attachment_stages stage ON stage.operation_id = operation.id
        WHERE operation.route_key = 'customer.attachment.upload' AND operation.status = 'processing'
          AND operation.updated_at <= ? AND attachment.id IS NULL AND stage.operation_id IS NULL
        ORDER BY operation.id LIMIT ?`,
      [cutoffMs, batchSize]
    );
    let failed = 0;
    for (const row of rows) {
      await this.database.withTransaction(async (connection) => {
        const [[eligible]] = await connection.query(
          `SELECT id FROM customer_operation_requests
            WHERE id = ? AND route_key = 'customer.attachment.upload'
              AND status = 'processing' AND updated_at <= ? FOR UPDATE`,
          [row.id, cutoffMs]
        );
        if (!eligible) return;
        const [[attachment]] = await connection.query("SELECT id FROM customer_attachments WHERE operation_id = ?", [row.id]);
        if (attachment) return;
        const [[stage]] = await connection.query("SELECT operation_id FROM customer_attachment_stages WHERE operation_id = ?", [row.id]);
        if (stage) return;
        await this.operations.fail(connection, {
          operationId: row.id, errorCode: "CUSTOMER_ATTACHMENT_ABANDONED", nowMs: this.time.nowMs()
        });
        failed += 1;
      });
    }
    return { failed };
  }

  async retryDeletes({ cutoffMs = 0, batchSize = 100 } = {}) {
    const limit = Number(batchSize); const cutoff = Number(cutoffMs);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(cutoff) || cutoff < 0) throw new TypeError("Customer attachment delete retry cutoff or batch size is invalid");
    const [rows] = await this.database.query(
      "SELECT id,customer_id,stored_name,sensitivity,status,version FROM customer_attachments WHERE status='delete_failed' OR (status='deleting' AND updated_at<=?) ORDER BY updated_at,id LIMIT ?",
      [cutoff, limit]
    );
    let deleted = 0; let failed = 0;
    for (const row of rows) {
      try { await this.storage.delete({ storedName: row.stored_name, sensitivity: row.sensitivity }); }
      catch { failed += 1; continue; }
      await this.database.withTransaction(async (connection) => {
        const [result] = await connection.execute(
          "DELETE FROM customer_attachments WHERE id=? AND customer_id=? AND status=? AND version=?",
          [row.id, row.customer_id, row.status, row.version]
        );
        deleted += Number(result.affectedRows) === 1 ? 1 : 0;
      });
    }
    return { processed: rows.length, deleted, failed };
  }
}
