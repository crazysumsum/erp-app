import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierApprovalService } from "./SupplierApprovalService.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierChildNotFound, supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { normalizeIdentifier } from "./supplierNormalization.js";
import { toIdentifierResponse } from "./supplierProjections.js";

function duplicateEntry(error) {
  return (error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY";
}

function referencedRow(error) {
  return ["ER_ROW_IS_REFERENCED", "ER_ROW_IS_REFERENCED_2"].includes(error?.cause?.code ?? error?.code);
}

function requiredReason(value) {
  const reason = String(value ?? "").trim();
  if (!reason || Array.from(reason).length > 500) {
    throw invalidSupplierInput("SUPPLIER_IDENTIFIER_REASON_REQUIRED", "修改或刪除識別資料必須填寫原因", { field: "reason" });
  }
  return reason;
}

function containsControl(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function normalizedInput(input) {
  const identifier = normalizeIdentifier({
    type: input.identifierType,
    issuerCountryCode: input.issuerCountryCode,
    value: input.identifierValue
  });
  const notes = String(input.notes ?? "").trim();
  if (Array.from(notes).length > 500 || containsControl(notes)) {
    throw invalidSupplierInput("IDENTIFIER_INVALID", "識別資料備註不正確", { field: "notes" });
  }
  return { ...identifier, notes };
}

function taken(identifier) {
  return supplierConflict("SUPPLIER_IDENTIFIER_TAKEN", "這項供應商識別資料已被使用", {
    identifierType: identifier.type,
    issuerCountryCode: identifier.issuerCountryCode
  });
}

export class SupplierIdentifierService {
  constructor({ database, logger, time, authorize = assertActorFresh, audit, countReferences = async () => 0, approvals } = {}) {
    if (!database || !logger || !time) throw new TypeError("SupplierIdentifierService requires database, logger and time");
    if (typeof countReferences !== "function") throw new TypeError("SupplierIdentifierService countReferences must be a function");
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
    this.countReferences = countReferences;
    this.approvals = approvals ?? new SupplierApprovalService({ database, logger, time, audit: this.audit });
  }

  async #supplierForUpdate(connection, supplierId) {
    const [[supplier]] = await connection.query("SELECT id, supplier_code, status FROM suppliers WHERE id = ? FOR UPDATE", [supplierId]);
    if (!supplier) throw supplierNotFound(supplierId);
    return supplier;
  }

  /**
   * 設計 4.5 將「Identifier 集合」列為 approval-significant，BR-013 要求關鍵資料
   * 改動之後原申請唔可以再批。冇呢個，提交人可以喺提交之後加一個審批人從來冇睇過
   * 嘅識別資料，而個申請照樣批得到 —— snapshot 係提交嗰刻影低嘅。
   *
   * 三條寫入路徑都經過 #supplierForUpdate，而佢已經揸住 suppliers 嘅鎖，所以喺呢度
   * 做啱晒設計 2.6 嘅鎖序：suppliers -> requests -> audit。
   */
  async #invalidateApprovalIfPending(connection, supplier, input, changedField) {
    if (supplier.status !== "pending_approval") return false;
    await this.approvals.invalidateOpenRequest(connection, {
      supplierId: supplier.id,
      actorId: input.actorId,
      actorUsername: input.actorUsername,
      supplierCode: supplier.supplier_code,
      changedFields: [changedField],
      reason: input.reason ?? "識別資料變更",
      requestId: input.requestId,
      ip: input.ip
    });
    await connection.execute(
      "UPDATE suppliers SET status = 'draft' WHERE id = ? AND status = 'pending_approval'",
      [supplier.id]
    );
    return true;
  }

  async #identifierForUpdate(connection, supplierId, identifierId) {
    const [[identifier]] = await connection.query(
      "SELECT * FROM supplier_identifiers WHERE id = ? AND supplier_id = ? FOR UPDATE",
      [identifierId, supplierId]
    );
    if (!identifier) throw supplierChildNotFound("identifier");
    return identifier;
  }

  async #project(connection, supplierId, identifierId) {
    const [[row]] = await connection.query(
      "SELECT i.* FROM supplier_identifiers i WHERE i.id = ? AND i.supplier_id = ?",
      [identifierId, supplierId]
    );
    return toIdentifierResponse(row);
  }

  async create(input) {
    const identifier = normalizedInput(input);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        const supplier = await this.#supplierForUpdate(connection, input.supplierId);
        await this.#invalidateApprovalIfPending(connection, supplier, { ...input, actorUsername: actor.username }, "identifiers");
        const nowMs = this.time.nowMs();
        const [result] = await connection.execute(
          `INSERT INTO supplier_identifiers
            (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, notes,
             version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [input.supplierId, identifier.type, identifier.issuerCountryCode, identifier.value, identifier.key,
            identifier.notes, nowMs, nowMs, input.actorId, input.actorId]
        );
        const identifierId = Number(result.insertId);
        const projected = await this.#project(connection, input.supplierId, identifierId);
        await this.audit.record(connection, {
          actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.identifier.create",
          targetType: "identifier", targetId: identifierId, supplierId: input.supplierId,
          targetLabel: `${identifier.type}:${identifier.issuerCountryCode}`,
          detail: { after: { identifierType: identifier.type, issuerCountryCode: identifier.issuerCountryCode, identifierValue: identifier.value } },
          requestId: input.requestId, ip: input.ip
        });
        return projected;
      });
    } catch (error) {
      if (duplicateEntry(error)) throw taken(identifier);
      throw error;
    }
  }

  async update(input) {
    const identifier = normalizedInput(input);
    const reason = requiredReason(input.reason);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        const supplier = await this.#supplierForUpdate(connection, input.supplierId);
        await this.#invalidateApprovalIfPending(connection, supplier, { ...input, actorUsername: actor.username }, "identifiers");
        const current = await this.#identifierForUpdate(connection, input.supplierId, input.identifierId);
        if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "識別資料已被其他人修改，請重新載入");
        const nowMs = this.time.nowMs();
        await connection.execute(
          `UPDATE supplier_identifiers SET identifier_type = ?, issuer_country_code = ?, identifier_value = ?,
            identifier_value_key = ?, notes = ?, version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND supplier_id = ? AND version = ?`,
          [identifier.type, identifier.issuerCountryCode, identifier.value, identifier.key, identifier.notes,
            nowMs, input.actorId, input.identifierId, input.supplierId, input.version]
        );
        const projected = await this.#project(connection, input.supplierId, input.identifierId);
        await this.audit.record(connection, {
          actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.identifier.update",
          targetType: "identifier", targetId: input.identifierId, supplierId: input.supplierId,
          targetLabel: `${identifier.type}:${identifier.issuerCountryCode}`,
          reason,
          detail: {
            before: { identifierType: current.identifier_type, issuerCountryCode: current.issuer_country_code, identifierValue: current.identifier_value },
            after: { identifierType: identifier.type, issuerCountryCode: identifier.issuerCountryCode, identifierValue: identifier.value }
          },
          requestId: input.requestId, ip: input.ip
        });
        return projected;
      });
    } catch (error) {
      if (duplicateEntry(error)) throw taken(identifier);
      throw error;
    }
  }

  async delete(input) {
    const reason = requiredReason(input.reason);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        const supplier = await this.#supplierForUpdate(connection, input.supplierId);
        await this.#invalidateApprovalIfPending(connection, supplier, { ...input, actorUsername: actor.username }, "identifiers");
        const current = await this.#identifierForUpdate(connection, input.supplierId, input.identifierId);
        if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "識別資料已被其他人修改，請重新載入");
        const referenceCount = Number(await this.countReferences(connection, {
          supplierId: input.supplierId,
          identifierId: input.identifierId
        }));
        if (!Number.isInteger(referenceCount) || referenceCount < 0) {
          throw new TypeError("Supplier Identifier reference count must be a non-negative integer");
        }
        if (referenceCount > 0) {
          throw supplierConflict("SUPPLIER_IDENTIFIER_REFERENCED", "這項識別資料已有引用，只可保留歷史", { referenceCount });
        }
        await connection.execute(
          "DELETE FROM supplier_identifiers WHERE id = ? AND supplier_id = ? AND version = ?",
          [input.identifierId, input.supplierId, input.version]
        );
        await this.audit.record(connection, {
          actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.identifier.delete",
          targetType: "identifier", targetId: input.identifierId, supplierId: input.supplierId,
          targetLabel: `${current.identifier_type}:${current.issuer_country_code}`,
          reason,
          detail: {
            before: {
              identifierType: current.identifier_type,
              issuerCountryCode: current.issuer_country_code,
              identifierValue: current.identifier_value
            }
          },
          requestId: input.requestId, ip: input.ip
        });
        return { id: Number(input.identifierId), deleted: true };
      });
    } catch (error) {
      if (referencedRow(error)) {
        throw supplierConflict("SUPPLIER_IDENTIFIER_REFERENCED", "這項識別資料已有引用，只可保留歷史");
      }
      throw error;
    }
  }
}
