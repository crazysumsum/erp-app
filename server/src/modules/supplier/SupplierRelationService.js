import { createHash } from "node:crypto";

import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierChildNotFound, supplierConflict, supplierImportError, supplierNotFound } from "./supplierErrors.js";
import { escapeLikeTerm } from "./supplierNormalization.js";

/** 設計 §5.11：preferred 可以有多個，唔係白名單；stopped 只係呢條供貨關係停咗，唔等於封鎖 Supplier。 */
export const SUPPLIER_SKU_RELATIONSHIP_STATUSES = Object.freeze(["preferred", "alternative", "stopped"]);
const MAX_MOQ = 4_294_967_295;
const MAX_LEAD_TIME_DAYS = 3650;

function controlCharacters(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function optionalText(value, field, maxLength) {
  const text = String(value ?? "").trim();
  if (Array.from(text).length > maxLength || controlCharacters(text)) {
    throw invalidSupplierInput("SUPPLIER_SKU_RELATION_INVALID", "供應商商品資料不正確", { field });
  }
  return text;
}

function optionalInteger(value, field, minimum, maximum) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidSupplierInput("SUPPLIER_SKU_RELATION_INVALID", "供應商商品資料不正確", { field });
  }
  return value;
}

function positiveId(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidSupplierInput("SUPPLIER_SKU_RELATION_INVALID", "供應商商品資料不正確", { field });
  }
  return value;
}

/** API 同 recordSupply 共用：所有可寫欄位，冇價格（FR-SKU-006）。 */
function relationFields(input) {
  const supplierItemCode = optionalText(input.supplierItemCode, "supplierItemCode", 190);
  const status = input.relationshipStatus ?? "alternative";
  if (!SUPPLIER_SKU_RELATIONSHIP_STATUSES.includes(status)) {
    throw invalidSupplierInput("SUPPLIER_SKU_RELATION_INVALID", "供應關係狀態不正確", { field: "relationshipStatus" });
  }
  return {
    supplierItemCode,
    // 同 Supplier Code 一樣嘅正規化；冇代碼就 NULL，唯一約束唔管（設計 §5.11）。
    supplierItemCodeKey: supplierItemCode ? supplierItemCode.normalize("NFKC").toLowerCase() : null,
    supplierItemName: optionalText(input.supplierItemName, "supplierItemName", 190),
    purchaseSkuUomId: input.purchaseSkuUomId === null || input.purchaseSkuUomId === undefined
      ? null : positiveId(input.purchaseSkuUomId, "purchaseSkuUomId"),
    minimumOrderQty: optionalInteger(input.minimumOrderQty, "minimumOrderQty", 1, MAX_MOQ),
    standardLeadTimeDays: optionalInteger(input.standardLeadTimeDays, "standardLeadTimeDays", 0, MAX_LEAD_TIME_DAYS),
    relationshipStatus: status
  };
}

const driverCode = (error) => error?.cause?.code ?? error?.code;
const constraintIn = (error, name) => [error, error?.cause].some((link) => String(link?.message ?? "").includes(name));

/** 撞 unique 或者 FK 就轉做 domain 錯誤；唔帶 SQL 或者 constraint 名。 */
function translateWriteError(error) {
  if (driverCode(error) === "ER_DUP_ENTRY") {
    if (constraintIn(error, "uq_supplier_sku_refs_item_code")) {
      return supplierConflict("SUPPLIER_ITEM_CODE_TAKEN", "這個供應商商品代碼已用於另一個 SKU");
    }
    return supplierConflict("SUPPLIER_SKU_RELATION_EXISTS", "這個供應商已經有這個 SKU 的供貨關係");
  }
  if (driverCode(error) === "ER_NO_REFERENCED_ROW_2" && constraintIn(error, "fk_supplier_sku_refs_purchase_uom")) {
    return invalidSupplierInput("SUPPLIER_SKU_UOM_INVALID", "採購單位不屬於這個 SKU", { field: "purchaseSkuUomId" });
  }
  return error;
}

function toRelationResponse(row, sku = null) {
  return {
    id: Number(row.id),
    supplierId: Number(row.supplier_id),
    skuId: Number(row.sku_id),
    skuCode: sku?.skuCode ?? null,
    skuName: sku?.skuName ?? null,
    skuStatus: sku?.skuStatus ?? null,
    itemStatus: sku?.itemStatus ?? null,
    supplierItemCode: row.supplier_item_code,
    supplierItemName: row.supplier_item_name,
    purchaseSkuUomId: row.purchase_sku_uom_id === null ? null : Number(row.purchase_sku_uom_id),
    minimumOrderQty: row.minimum_order_qty === null ? null : Number(row.minimum_order_qty),
    standardLeadTimeDays: row.standard_lead_time_days === null ? null : Number(row.standard_lead_time_days),
    relationshipStatus: row.relationship_status,
    firstSuppliedAt: row.first_supplied_at === null ? null : Number(row.first_supplied_at),
    lastSuppliedAt: row.last_supplied_at === null ? null : Number(row.last_supplied_at),
    source: row.source,
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}

const auditSnapshot = (fields) => ({
  supplierItemCode: fields.supplierItemCode, supplierItemName: fields.supplierItemName, purchaseSkuUomId: fields.purchaseSkuUomId,
  minimumOrderQty: fields.minimumOrderQty, standardLeadTimeDays: fields.standardLeadTimeDays, relationshipStatus: fields.relationshipStatus
});

const rowFields = (row) => ({
  supplierItemCode: row.supplier_item_code, supplierItemName: row.supplier_item_name,
  purchaseSkuUomId: row.purchase_sku_uom_id === null ? null : Number(row.purchase_sku_uom_id),
  minimumOrderQty: row.minimum_order_qty === null ? null : Number(row.minimum_order_qty),
  standardLeadTimeDays: row.standard_lead_time_days === null ? null : Number(row.standard_lead_time_days),
  relationshipStatus: row.relationship_status
});

/** 冇 Purchasing 模組之前，冇人可以證明一張 GR 已完成：fail closed（設計 §6.8；Item §5.14）。 */
async function sourceVerifierUnavailable() {
  throw supplierImportError("SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE", 503, "目前無法核實供貨來源，請稍後再試");
}

/**
 * Supplier–SKU 軟性供貨關係（TASK-038；設計 §5.11、§5.11.1、§6.8；Item §5.14；HD-086）。
 *
 * - 關係只係對照同排序依據，唔係採購白名單（BR-023、BR-024）；寫入唔會改 Supplier 或 SKU 狀態。
 * - 手動新增、改採購單位或者由 stopped 重新啟用，SKU 一定要可以採購（Item §5.14：Item 同 SKU 都 Active、
 *   purchasable、喺有效期內）；改成 stopped 或者改 MOQ、交期唔使。
 * - 採購單位屬唔屬呢個 SKU 由 composite FK 保證，撞到就回 `SUPPLIER_SKU_UOM_INVALID`。
 * - `recordSupply` 係 Purchasing 完成 GR 之後嘅歷史投影：event_id 做 durable fence，重送回原結果，唔套用新採購
 *   資格，唔會自動改成 preferred（設計 §6.8）。
 */
export class SupplierRelationService {
  constructor({ database, logger, time, items, authorize = assertActorFresh, audit, verifySource = sourceVerifierUnavailable } = {}) {
    if (!database || !logger || !time || !items) throw new TypeError("SupplierRelationService requires database, logger, time and items");
    this.database = database;
    this.time = time;
    this.items = items;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
    this.verifySource = verifySource;
  }

  async #assertPurchasable(skuId) {
    const sku = await this.items.findById(skuId, { purpose: "purchase", atMs: this.time.nowMs() });
    if (!sku) throw invalidSupplierInput("SUPPLIER_SKU_NOT_FOUND", "找不到這個 SKU", { field: "skuId" });
    if (!sku.usable) {
      throw supplierConflict("SUPPLIER_SKU_NOT_PURCHASABLE", "這個 SKU 目前不可作為新的採購對象", { reasons: [...sku.reasons] });
    }
    return sku;
  }

  async #supplierForUpdate(connection, supplierId) {
    const [[supplier]] = await connection.query("SELECT id, supplier_code, status FROM suppliers WHERE id = ? FOR UPDATE", [supplierId]);
    if (!supplier) throw supplierNotFound(supplierId);
    return supplier;
  }

  async list({ actorId, claimedRoles, claimedPermissions, supplierId, q = "", page = 1, pageSize = 20 }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[supplier]] = await this.database.query("SELECT id FROM suppliers WHERE id = ?", [supplierId]);
    if (!supplier) throw supplierNotFound(supplierId);
    const conditions = ["r.supplier_id = ?"];
    const params = [supplierId];
    const search = String(q ?? "").normalize("NFKC").trim();
    if (search) {
      const escaped = escapeLikeTerm(search);
      // SKU Code 經 Item 查（唔直接讀 Item 表）；精確 Code 先算。
      const sku = await this.items.findByCode(search);
      conditions.push(`(r.supplier_item_code_key LIKE ? ESCAPE '\\\\' OR r.supplier_item_name LIKE ? ESCAPE '\\\\'${sku ? " OR r.sku_id = ?" : ""})`);
      params.push(`${escaped.toLowerCase()}%`, `%${escaped}%`, ...(sku ? [sku.skuId] : []));
    }
    const where = conditions.join(" AND ");
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM supplier_sku_refs r WHERE ${where}`, params);
    const [rows] = await this.database.query(
      `SELECT r.* FROM supplier_sku_refs r WHERE ${where}
        ORDER BY FIELD(r.relationship_status, 'preferred', 'alternative', 'stopped'), r.last_supplied_at IS NULL, r.last_supplied_at DESC, r.id
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    const skus = await this.items.findManyByIds(rows.map((row) => Number(row.sku_id)));
    return { items: rows.map((row) => toRelationResponse(row, skus.get(Number(row.sku_id)))), total: Number(total), page, pageSize };
  }

  async create(input) {
    const fields = relationFields(input);
    const skuId = positiveId(input.skuId, "skuId");
    const sku = await this.#assertPurchasable(skuId);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        const supplier = await this.#supplierForUpdate(connection, input.supplierId);
        if (supplier.status === "archived") {
          throw supplierConflict("SUPPLIER_SKU_RELATION_NOT_ALLOWED", "已封存供應商不可新增供貨關係", { status: supplier.status });
        }
        const nowMs = this.time.nowMs();
        const [result] = await connection.execute(
          `INSERT INTO supplier_sku_refs
             (supplier_id, sku_id, supplier_item_code, supplier_item_code_key, supplier_item_name, purchase_sku_uom_id,
              minimum_order_qty, standard_lead_time_days, relationship_status, source, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?, ?, ?)`,
          [input.supplierId, skuId, fields.supplierItemCode, fields.supplierItemCodeKey, fields.supplierItemName, fields.purchaseSkuUomId,
            fields.minimumOrderQty, fields.standardLeadTimeDays, fields.relationshipStatus, nowMs, nowMs, input.actorId, input.actorId]
        );
        const id = Number(result.insertId);
        await this.audit.record(connection, {
          actorUserId: input.actorId, actorUsername: actor.username, action: "supplier_sku.create", targetType: "supplier_sku",
          targetId: id, supplierId: input.supplierId, targetLabel: sku.skuCode,
          detail: { after: { skuId, ...auditSnapshot(fields) } }, requestId: input.requestId, ip: input.ip
        });
        const [[row]] = await connection.query("SELECT * FROM supplier_sku_refs WHERE id = ?", [id]);
        return toRelationResponse(row, sku);
      });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async update(input) {
    const fields = relationFields(input);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        const supplier = await this.#supplierForUpdate(connection, input.supplierId);
        if (supplier.status === "archived") {
          throw supplierConflict("SUPPLIER_SKU_RELATION_NOT_ALLOWED", "已封存供應商不可修改供貨關係", { status: supplier.status });
        }
        const [[current]] = await connection.query(
          "SELECT * FROM supplier_sku_refs WHERE id = ? AND supplier_id = ? FOR UPDATE", [input.relationId, input.supplierId]);
        if (!current) throw supplierChildNotFound("skuRelation");
        if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "供貨關係已被其他人修改，請重新載入");
        const before = rowFields(current);
        // 改採購單位或者由 stopped 重新啟用，等於一個新嘅採購對照：SKU 要可以採購（Item §5.14）。
        const reactivated = before.relationshipStatus === "stopped" && fields.relationshipStatus !== "stopped";
        const sku = before.purchaseSkuUomId !== fields.purchaseSkuUomId || reactivated
          ? await this.#assertPurchasable(Number(current.sku_id))
          : await this.items.findById(Number(current.sku_id));
        const nowMs = this.time.nowMs();
        await connection.execute(
          `UPDATE supplier_sku_refs
              SET supplier_item_code = ?, supplier_item_code_key = ?, supplier_item_name = ?, purchase_sku_uom_id = ?,
                  minimum_order_qty = ?, standard_lead_time_days = ?, relationship_status = ?,
                  version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND version = ?`,
          [fields.supplierItemCode, fields.supplierItemCodeKey, fields.supplierItemName, fields.purchaseSkuUomId, fields.minimumOrderQty,
            fields.standardLeadTimeDays, fields.relationshipStatus, nowMs, input.actorId, input.relationId, input.version]
        );
        await this.audit.record(connection, {
          actorUserId: input.actorId, actorUsername: actor.username, action: "supplier_sku.update", targetType: "supplier_sku",
          targetId: Number(input.relationId), supplierId: input.supplierId, targetLabel: sku?.skuCode ?? String(current.sku_id),
          detail: { before: auditSnapshot(before), after: auditSnapshot(fields) }, requestId: input.requestId, ip: input.ip
        });
        const [[row]] = await connection.query("SELECT * FROM supplier_sku_refs WHERE id = ?", [input.relationId]);
        return toRelationResponse(row, sku);
      });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  /**
   * Purchasing 完成 GR 之後嘅投影（設計 §6.8）。同一個 event 重送回原結果；同一個 event 或者同一張來源單據行
   * 內容唔同就 `IDEMPOTENCY_CONFLICT`。來源由 `verifySource(connection, command)` 證明（Purchasing 提供）。
   * 回 `{ eventId, relationId, replayed }`。
   */
  async recordSupply(command) {
    const normalized = supplyCommand(command);
    const payloadHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.database.withTransaction((connection) => this.#recordSupply(connection, normalized, payloadHash));
      } catch (error) {
        // 兩個 transaction 同時寫同一個 event：輸咗嗰個 rollback 之後再讀一次，就會見到贏咗嗰個嘅結果。
        if (attempt === 0 && ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK"].includes(driverCode(error)) && constraintIn(error, "supplier_supply_events")) continue;
        throw translateWriteError(error);
      }
    }
    throw new Error("unreachable");
  }

  async #recordSupply(connection, command, payloadHash) {
    const [[existing]] = await connection.query(
      `SELECT event_id, relation_id, payload_hash FROM supplier_supply_events
        WHERE event_id = ? OR (source_type = ? AND source_id = ? AND source_line_id = ?) LIMIT 1`,
      [command.eventId, command.sourceType, command.sourceId, command.sourceLineId]
    );
    if (existing) {
      if (existing.event_id !== command.eventId || existing.payload_hash !== payloadHash) {
        throw supplierConflict("IDEMPOTENCY_CONFLICT", "同一個來源已用不同內容記錄供貨");
      }
      return { eventId: command.eventId, relationId: Number(existing.relation_id), replayed: true };
    }
    await this.verifySource(connection, command);
    // 歷史投影：任何未刪除嘅 Supplier 都得；SKU 只要求未被物理刪除（Item §5.14），唔套用新採購資格。
    await this.#supplierForUpdate(connection, command.supplierId);
    const sku = await this.items.findById(command.skuId);
    if (!sku) throw invalidSupplierInput("SUPPLIER_SKU_NOT_FOUND", "找不到這個 SKU", { field: "skuId" });
    const nowMs = this.time.nowMs();
    let [[relation]] = await connection.query(
      "SELECT id FROM supplier_sku_refs WHERE supplier_id = ? AND sku_id = ? FOR UPDATE", [command.supplierId, command.skuId]);
    let created = false;
    if (relation) {
      await connection.execute(
        `UPDATE supplier_sku_refs
            SET first_supplied_at = LEAST(COALESCE(first_supplied_at, ?), ?), last_supplied_at = GREATEST(COALESCE(last_supplied_at, ?), ?),
                version = version + 1, updated_at = ?
          WHERE id = ?`,
        [command.suppliedAt, command.suppliedAt, command.suppliedAt, command.suppliedAt, nowMs, relation.id]
      );
    } else {
      // 新對照：來源 purchasing、狀態 alternative。供應商代碼已經用咗就唔填，唔好令投影失敗。
      const codeKey = command.supplierItemCode ? command.supplierItemCode.normalize("NFKC").toLowerCase() : null;
      const [[codeTaken]] = codeKey === null ? [[null]] : await connection.query(
        "SELECT id FROM supplier_sku_refs WHERE supplier_id = ? AND supplier_item_code_key = ? FOR UPDATE", [command.supplierId, codeKey]);
      const [result] = await connection.execute(
        `INSERT INTO supplier_sku_refs
           (supplier_id, sku_id, supplier_item_code, supplier_item_code_key, purchase_sku_uom_id, relationship_status, source,
            first_supplied_at, last_supplied_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'alternative', 'purchasing', ?, ?, 1, ?, ?)`,
        [command.supplierId, command.skuId, codeTaken ? "" : command.supplierItemCode, codeTaken ? null : codeKey, command.purchaseSkuUomId,
          command.suppliedAt, command.suppliedAt, nowMs, nowMs]
      );
      relation = { id: Number(result.insertId) };
      created = true;
    }
    await connection.execute(
      `INSERT INTO supplier_supply_events
         (event_id, source_type, source_id, source_line_id, supplier_id, sku_id, relation_id, supplied_at, payload_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [command.eventId, command.sourceType, command.sourceId, command.sourceLineId, command.supplierId, command.skuId, relation.id,
        command.suppliedAt, payloadHash, nowMs]
    );
    await this.audit.record(connection, {
      actorUserId: null, actorUsername: "system", action: "supplier_sku.supply", targetType: "supplier_sku",
      targetId: Number(relation.id), supplierId: command.supplierId, targetLabel: sku.skuCode,
      detail: { after: { sourceType: command.sourceType, sourceId: command.sourceId, sourceLineId: command.sourceLineId,
        suppliedAt: command.suppliedAt, relationCreated: created } }
    });
    return { eventId: command.eventId, relationId: Number(relation.id), replayed: false };
  }
}

function supplyCommand(command) {
  const eventId = String(command?.eventId ?? "").trim();
  if (!eventId || eventId.length > 64 || controlCharacters(eventId)) {
    throw invalidSupplierInput("SUPPLIER_SUPPLY_INVALID", "供貨記錄不正確", { field: "eventId" });
  }
  if (command.sourceType !== "goods_receipt") {
    throw invalidSupplierInput("SUPPLIER_SUPPLY_INVALID", "供貨記錄不正確", { field: "sourceType" });
  }
  const suppliedAt = command.suppliedAt;
  if (!Number.isSafeInteger(suppliedAt) || suppliedAt < 0) {
    throw invalidSupplierInput("SUPPLIER_SUPPLY_INVALID", "供貨記錄不正確", { field: "suppliedAt" });
  }
  // 固定次序：payload hash 由呢個 object 計，所以同一個 command 一定計出同一個 hash。
  return {
    eventId, sourceType: command.sourceType,
    sourceId: positiveId(command.sourceId, "sourceId"), sourceLineId: positiveId(command.sourceLineId, "sourceLineId"),
    supplierId: positiveId(command.supplierId, "supplierId"), skuId: positiveId(command.skuId, "skuId"),
    purchaseSkuUomId: command.purchaseSkuUomId === null || command.purchaseSkuUomId === undefined ? null : positiveId(command.purchaseSkuUomId, "purchaseSkuUomId"),
    supplierItemCode: optionalText(command.supplierItemCode, "supplierItemCode", 190),
    suppliedAt
  };
}
