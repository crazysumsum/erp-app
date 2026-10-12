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

function optionalText(value, field, maxLength, code = "SUPPLIER_SKU_RELATION_INVALID") {
  const text = String(value ?? "").trim();
  if (Array.from(text).length > maxLength || controlCharacters(text)) {
    throw invalidSupplierInput(code, "供應商商品資料不正確", { field });
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

function positiveId(value, field, code = "SUPPLIER_SKU_RELATION_INVALID") {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidSupplierInput(code, "供應商商品資料不正確", { field });
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
  const supplierItemCodeKey = itemCodeKey(supplierItemCode);
  // NFKC 可以令代碼變長（「ﷺ」一個字變 18 個）：放唔入欄位就係輸入錯，唔係 500（REV-085 L1）。
  if (supplierItemCodeKey !== null && Array.from(supplierItemCodeKey).length > 190) {
    throw invalidSupplierInput("SUPPLIER_SKU_RELATION_INVALID", "供應商商品代碼正規化後過長", { field: "supplierItemCode" });
  }
  return {
    supplierItemCode,
    supplierItemCodeKey,
    supplierItemName: optionalText(input.supplierItemName, "supplierItemName", 190),
    purchaseSkuUomId: input.purchaseSkuUomId === null || input.purchaseSkuUomId === undefined
      ? null : positiveId(input.purchaseSkuUomId, "purchaseSkuUomId"),
    minimumOrderQty: optionalInteger(input.minimumOrderQty, "minimumOrderQty", 1, MAX_MOQ),
    standardLeadTimeDays: optionalInteger(input.standardLeadTimeDays, "standardLeadTimeDays", 0, MAX_LEAD_TIME_DAYS),
    relationshipStatus: status
  };
}

/** 同 Supplier Code 一樣嘅正規化；冇代碼就 NULL，唯一約束唔管（設計 §5.11）。 */
function itemCodeKey(code) {
  return code ? code.normalize("NFKC").toLowerCase() : null;
}

/** Transaction 之前讀嘅 SKU（purpose purchase），喺授權之後先據此報錯（REV-085 H1、L3）。 */
function requirePurchasable(sku) {
  if (!sku) throw invalidSupplierInput("SUPPLIER_SKU_NOT_FOUND", "找不到這個 SKU", { field: "skuId" });
  if (!sku.usable) throw supplierConflict("SUPPLIER_SKU_NOT_PURCHASABLE", "這個 SKU 目前不可作為新的採購對象", { reasons: [...sku.reasons] });
  return sku;
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
 * - Item 嘅資料一律喺 transaction 之前讀：ItemLookupService 用 pool，喺 transaction 入面叫佢會令一個請求同時佔兩條
 *   連線，十個並發請求就可以塞死成個 pool（REV-085 H1）。
 */
export class SupplierRelationService {
  constructor({ database, logger, time, items, authorize = assertActorFresh, audit, verifySource = sourceVerifierUnavailable } = {}) {
    if (!database || !logger || !time || !items) throw new TypeError("SupplierRelationService requires database, logger, time and items");
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.items = items;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
    this.verifySource = verifySource;
  }

  #purchaseView(skuId) {
    return this.items.findById(skuId, { purpose: "purchase", atMs: this.time.nowMs() });
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
    // ponytail: 檢查同寫入之間 SKU 可以啱啱被停用（REV-085 L2）。關係只係參考，Purchasing 落單時會再驗 SKU；
    // 要收緊就要 Item 提供 in-transaction 嘅讀取。
    const view = await this.#purchaseView(skuId);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        const sku = requirePurchasable(view);
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
    // sku_id 建立之後唔會變，所以可以喺 transaction 之前讀關係同 SKU；transaction 入面再鎖住同驗版本。
    const [[ref]] = await this.database.query("SELECT sku_id FROM supplier_sku_refs WHERE id = ? AND supplier_id = ?",
      [input.relationId, input.supplierId]);
    const view = ref ? await this.#purchaseView(Number(ref.sku_id)) : null;
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, input);
        const supplier = await this.#supplierForUpdate(connection, input.supplierId);
        if (supplier.status === "archived") {
          throw supplierConflict("SUPPLIER_SKU_RELATION_NOT_ALLOWED", "已封存供應商不可修改供貨關係", { status: supplier.status });
        }
        const [[current]] = await connection.query(
          "SELECT * FROM supplier_sku_refs WHERE id = ? AND supplier_id = ? FOR UPDATE", [input.relationId, input.supplierId]);
        if (!current) throw supplierChildNotFound("sku_relation");
        if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "供貨關係已被其他人修改，請重新載入");
        const before = rowFields(current);
        // 改綁採購單位或者由 stopped 重新啟用，等於一個新嘅採購對照：SKU 要可以採購（Item §5.14）。清空採購單位唔係
        // 改綁（REV-085 L6）。
        const reactivated = before.relationshipStatus === "stopped" && fields.relationshipStatus !== "stopped";
        const rebound = fields.purchaseSkuUomId !== null && fields.purchaseSkuUomId !== before.purchaseSkuUomId;
        const sku = rebound || reactivated ? requirePurchasable(view) : view;
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
    // SKU 只用嚟做稽核標籤同確認未刪除：transaction 之前讀（REV-085 H1）；寫入時存唔存在由 FK 保證。
    const sku = await this.items.findById(normalized.skuId);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.database.withTransaction((connection) => this.#recordSupply(connection, normalized, payloadHash, sku));
      } catch (error) {
        // 兩個 transaction 同時寫同一個 event：輸咗嗰個 rollback 之後再讀，就會見到贏咗嗰個嘅結果。Deadlock 嘅訊息唔會
        // 寫表名，所以唔睇訊息（REV-085 H2）。
        const code = driverCode(error);
        if (attempt < 2 && (code === "ER_LOCK_DEADLOCK" || (code === "ER_DUP_ENTRY" && constraintIn(error, "supplier_supply_events")))) continue;
        const translated = translateWriteError(error);
        // 投影失敗唔會回滾 Purchasing 已提交嘅 GR：要告警，等 reconciliation 按來源補回（設計 §6.8）。只記 ID 同代碼。
        void this.logger?.error?.("supplier.sku.supply_failed", "Supplier supply projection failed", {
          eventId: normalized.eventId, sourceType: normalized.sourceType, sourceId: normalized.sourceId,
          sourceLineId: normalized.sourceLineId, supplierId: normalized.supplierId, skuId: normalized.skuId,
          code: translated?.publicCode ?? translated?.code ?? code ?? "unknown"
        });
        throw translated;
      }
    }
  }

  async #recordSupply(connection, command, payloadHash, sku) {
    // 先鎖 Supplier（create、update 都係咁），之後全部用普通讀取：read view 喺攞鎖之後先開，睇得到之前揸鎖嗰啲寫入，
    // 而且唔使對未存在嘅行攞 gap lock，兩個投影就唔會互相 deadlock（REV-085 H2）。
    // 歷史投影：任何未刪除嘅 Supplier 都得；SKU 只要求未被物理刪除（Item §5.14），唔套用新採購資格。
    await this.#supplierForUpdate(connection, command.supplierId);
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
    if (!sku) throw invalidSupplierInput("SUPPLIER_SKU_NOT_FOUND", "找不到這個 SKU", { field: "skuId" });
    const nowMs = this.time.nowMs();
    let [[relation]] = await connection.query(
      "SELECT id FROM supplier_sku_refs WHERE supplier_id = ? AND sku_id = ?", [command.supplierId, command.skuId]);
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
      // 新對照：來源 purchasing、狀態 alternative。供應商代碼已經用咗、或者正規化後放唔入欄位，就唔填，唔好令投影
      // 失敗（REV-085 L1）。採購單位唔由投影設定（HD-090 L5 A）：Item 未提供對應行 ID，驗唔到屬唔屬呢個 SKU，
      // 由用戶喺關係度手動揀。
      const candidateKey = itemCodeKey(command.supplierItemCode);
      const codeKey = candidateKey !== null && Array.from(candidateKey).length <= 190 ? candidateKey : null;
      const [[codeTaken]] = codeKey === null ? [[null]] : await connection.query(
        "SELECT id FROM supplier_sku_refs WHERE supplier_id = ? AND supplier_item_code_key = ?", [command.supplierId, codeKey]);
      const keepCode = codeKey !== null && !codeTaken;
      const [result] = await connection.execute(
        `INSERT INTO supplier_sku_refs
           (supplier_id, sku_id, supplier_item_code, supplier_item_code_key, relationship_status, source,
            first_supplied_at, last_supplied_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'alternative', 'purchasing', ?, ?, 1, ?, ?)`,
        [command.supplierId, command.skuId, keepCode ? command.supplierItemCode : "", keepCode ? codeKey : null,
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
        suppliedAt: command.suppliedAt, relationCreated: created, reportedPurchaseSkuUomId: command.purchaseSkuUomId } }
    });
    return { eventId: command.eventId, relationId: Number(relation.id), replayed: false };
  }
}

const SUPPLY_INVALID = "SUPPLIER_SUPPLY_INVALID";

function supplyCommand(command) {
  const eventId = String(command?.eventId ?? "").trim();
  // event_id 係機器鍵，欄位係 ascii_bin（大小寫有分，HD-090 L4）：只收可見 ASCII。
  if (!/^[\x21-\x7e]{1,64}$/u.test(eventId)) {
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
    sourceId: positiveId(command.sourceId, "sourceId", SUPPLY_INVALID), sourceLineId: positiveId(command.sourceLineId, "sourceLineId", SUPPLY_INVALID),
    supplierId: positiveId(command.supplierId, "supplierId", SUPPLY_INVALID), skuId: positiveId(command.skuId, "skuId", SUPPLY_INVALID),
    purchaseSkuUomId: command.purchaseSkuUomId === null || command.purchaseSkuUomId === undefined ? null : positiveId(command.purchaseSkuUomId, "purchaseSkuUomId", SUPPLY_INVALID),
    supplierItemCode: optionalText(command.supplierItemCode, "supplierItemCode", 190, SUPPLY_INVALID),
    suppliedAt
  };
}
