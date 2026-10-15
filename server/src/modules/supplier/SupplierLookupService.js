import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { supplierSearchCondition } from "./SupplierAdminService.js";
import { normalizeSupplierCode } from "./supplierNormalization.js";
import { supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { toAddressResponse } from "./supplierProjections.js";

const PURPOSES = Object.freeze(["purchase", "history"]);
const MAX_BATCH_SIZE = 100;
const READ_TRANSACTION_OPTIONS = Object.freeze({ isolationLevel: "READ COMMITTED", timeoutMs: 5_000 });
const SUPPLIER_SELECT = `SELECT id, supplier_code, supplier_name, display_name,
       default_currency_code, default_payment_term_id, status, version
  FROM suppliers`;

function requireConnection(connection) {
  if (!connection || typeof connection.query !== "function") {
    throw new TypeError("A caller-owned transaction connection is required");
  }
}

function requireSupplierId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("Supplier ID must be a positive safe integer");
  return id;
}

function lookupOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Supplier lookup options must be an object");
  }
  if (!PURPOSES.includes(options.purpose)) {
    throw new TypeError(`Unknown SupplierLookupService purpose: "${options.purpose}"`);
  }
  const atMs = options.atMs ?? null;
  if (atMs !== null && (!Number.isSafeInteger(atMs) || atMs < 0)) {
    throw new TypeError("Supplier lookup atMs must be a non-negative epoch millisecond integer");
  }
  return { purpose: options.purpose, atMs };
}

// 排得前嘅 relation：首選，或者唔係 stopped 而有供貨紀錄（HD-094 2A）。
const ranked = (alias) => `${alias}.relationship_status = 'preferred' OR (${alias}.relationship_status <> 'stopped' AND ${alias}.last_supplied_at IS NOT NULL)`;
const FOR_SKU_COLUMNS = `s.id, s.supplier_code, s.supplier_name, s.display_name, s.default_currency_code, s.default_payment_term_id,
  s.status, s.version, r.id AS relation_id, r.relationship_status, r.supplier_item_code, r.last_supplied_at`;

function forSkuQuery(options = {}) {
  const { q = "", page = 1, pageSize = 20 } = options ?? {};
  if (typeof q !== "string" || [...q].length > 190 || /\p{Cc}/u.test(q) || !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)) {
    throw new TypeError("Supplier for-SKU query is invalid");
  }
  return { search: q.normalize("NFKC").trim(), page, pageSize };
}

/** 設計 §8.7 嘅排序：exact → preferred → 最近供貨 → 名稱、ID。stopped 唔排前（HD-094 2A）。 */
function rankReason(row) {
  if (Number(row.exact_rank) === 0) return "exact_match";
  if (row.relationship_status === "preferred") return "preferred";
  if (row.relationship_status !== "stopped" && row.last_supplied_at !== null) return "recently_supplied";
  return null;
}

function providerNotReady() {
  return new ApplicationError("Business Master provider is unavailable for Supplier purchase defaults", {
    code: "BUSINESS_MASTER_NOT_READY",
    publicCode: "BUSINESS_MASTER_NOT_READY",
    statusCode: 503,
    publicMessage: "貨幣及付款條件資料暫時不可用"
  });
}

function toProjection(row, { purpose }) {
  if (!row) return null;
  const reasons = purpose === "purchase" && row.status !== "active" ? ["STATUS_NOT_ACTIVE"] : [];
  return {
    supplierId: Number(row.id),
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    displayName: row.display_name,
    defaultCurrencyCode: row.default_currency_code,
    defaultPaymentTermId: row.default_payment_term_id === null ? null : Number(row.default_payment_term_id),
    status: row.status,
    version: Number(row.version),
    usable: reasons.length === 0,
    reasons
  };
}

/**
 * Internal Supplier provider for Purchasing and historical document readers.
 * Callers authorize their own workflow before invoking this service; no Supplier
 * management permission is implied, and the projection never contains Bank data.
 */
export class SupplierLookupService {
  static contract = "supplier-core-provider/v1";

  constructor({ database, logger, time, businessMaster = null, items = null } = {}) {
    if (!database || typeof database.withTransaction !== "function") {
      throw new TypeError("SupplierLookupService requires a transactional database");
    }
    if (!logger || !time) throw new TypeError("SupplierLookupService requires logger and time services");
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.businessMaster = businessMaster;
    this.items = items;
  }

  async findById(supplierId, options) {
    const id = requireSupplierId(supplierId);
    const normalized = lookupOptions(options);
    return this.#read((connection) => this.#findById(connection, id, normalized));
  }

  async findByCode(supplierCode, options) {
    const code = normalizeSupplierCode(supplierCode);
    const normalized = lookupOptions(options);
    return this.#read(async (connection) => {
      const [rows] = await connection.query(`${SUPPLIER_SELECT} WHERE supplier_code_key = ? LIMIT 1`, [code.key]);
      return toProjection(rows[0], normalized);
    });
  }

  async findManyByIds(supplierIds, options) {
    if (!Array.isArray(supplierIds)) throw new TypeError("Supplier IDs must be an array");
    const normalized = lookupOptions(options);
    if (supplierIds.length > MAX_BATCH_SIZE) throw new TypeError(`Supplier lookup accepts at most ${MAX_BATCH_SIZE} IDs`);
    const ids = [...new Set(supplierIds.map(requireSupplierId))];
    if (ids.length === 0) return new Map();
    return this.#read(async (connection) => {
      const placeholders = ids.map(() => "?").join(",");
      const [rows] = await connection.query(`${SUPPLIER_SELECT} WHERE id IN (${placeholders})`, ids);
      return new Map(rows.map((row) => [Number(row.id), toProjection(row, normalized)]));
    });
  }

  async assertUsable(supplierId, options) {
    const id = requireSupplierId(supplierId);
    const normalized = lookupOptions(options);
    return this.#read((connection) => this.#assertUsable(connection, id, normalized, false));
  }

  async assertUsableInTransaction(connection, supplierId, options) {
    requireConnection(connection);
    const id = requireSupplierId(supplierId);
    const normalized = lookupOptions(options);
    return this.#assertUsable(connection, id, normalized, true);
  }

  async getPurchaseDefaults(supplierId, { atMs } = {}) {
    const id = requireSupplierId(supplierId);
    return this.#read((connection) => this.getPurchaseDefaultsInTransaction(connection, id, { atMs }));
  }

  async getPurchaseDefaultsInTransaction(connection, supplierId, { atMs } = {}) {
    requireConnection(connection);
    const options = lookupOptions({ purpose: "purchase", atMs });
    const supplier = await this.#assertUsable(connection, requireSupplierId(supplierId), options, true);
    if (!this.businessMaster || typeof this.businessMaster.assertSupplierDefaultsInTransaction !== "function") {
      throw providerNotReady();
    }
    const references = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
      currencyCode: supplier.defaultCurrencyCode,
      paymentTermId: supplier.defaultPaymentTermId,
      purpose: "new_assignment"
    });
    const [addressRows] = await connection.query(
      `SELECT a.*
         FROM supplier_address_purposes p
         JOIN supplier_addresses a ON a.id = p.address_id AND a.supplier_id = p.supplier_id
        WHERE p.supplier_id = ? AND p.purpose_code = 'ordering' AND p.is_primary = 1
          AND a.status = 'active'
        LIMIT 1`,
      [supplier.supplierId]
    );
    const orderingAddress = addressRows[0]
      ? toAddressResponse(addressRows[0], [{ purpose_code: "ordering", is_primary: 1 }])
      : null;
    return {
      supplier,
      currency: references.currency,
      paymentTerm: references.paymentTerm,
      orderingAddress
    };
  }

  /**
   * 採購揀 Supplier 用：全部 Active Supplier（冇 relation 都照出），relation 只影響排序同 `rankReason`。
   * SKU 唔可以採購就 fail closed（HD-094 3A）。呢度唔授權，呼叫方要先授權；提交時仍要
   * `assertUsableInTransaction()` 重驗（BR-032）。
   *
   * 兩段讀（HD-095 B）：head 係有排序理由（exact、首選、最近供貨）嘅 Supplier，由 relation index 同 code key 帶出再排序；
   * rest 係其餘 Active Supplier，沿 `idx_suppliers_name_id` 按名稱讀。兩段互不重疊，合埋就係設計 §8.7 嘅次序。
   * 一次過 JOIN 全部 Active Supplier 再排序，每次要排 8 萬行，50 人並發 p95 4 秒。
   */
  async listForSku(skuId, options = {}) {
    const id = Number(skuId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("SKU ID must be a positive safe integer");
    const { search, page, pageSize } = forSkuQuery(options);
    if (!this.items) throw new TypeError("SupplierLookupService.listForSku requires an Item lookup service");
    await this.items.assertUsable(id, { purpose: "purchase", atMs: options?.atMs ?? this.time.nowMs() });

    const key = search.toLowerCase();
    let match = "s.status = 'active'";
    const matchParams = [];
    if (search) {
      // 同供應商列表一樣嘅文字搜尋，或者呢隻 SKU 嘅 Supplier Item Code 完全相同（HD-094 4A）。
      // Item Code 相同嘅 Supplier 先查出嚟（好少），唔好喺全表掃描入面每行行一條子查詢。
      const [byItemCode] = await this.database.query(
        "SELECT supplier_id FROM supplier_sku_refs WHERE sku_id = ? AND supplier_item_code_key = ?", [id, key]);
      const condition = supplierSearchCondition(search, { identifiers: false });
      match += ` AND (${condition.sql}${byItemCode.length ? ` OR s.id IN (${byItemCode.map(() => "?").join(",")})` : ""})`;
      matchParams.push(...condition.params, ...byItemCode.map((row) => Number(row.supplier_id)));
    }
    const itemCodeExact = (alias) => (search ? ` OR ${alias}.supplier_item_code_key = ?` : "");
    const headIds = `SELECT y.supplier_id AS id FROM supplier_sku_refs y WHERE y.sku_id = ? AND (${ranked("y")}${itemCodeExact("y")})${
      search ? " UNION SELECT id FROM suppliers WHERE supplier_code_key = ?" : ""}`;
    // 由 head（呢隻 SKU 有排序理由嘅 relation）開始 join：唔固定次序，MySQL 會揀由 8 萬個 Active Supplier 做 LIKE 篩選
    // 再逐個探 h，熱門 SKU 每次掃 8 萬行（TASK-050 for-SKU 負載；EXPLAIN ANALYZE 66→28 ms、搜尋 91→27 ms）。
    const headFrom = `FROM (${headIds}) h STRAIGHT_JOIN suppliers s ON s.id = h.id
      LEFT JOIN supplier_sku_refs r ON r.supplier_id = s.id AND r.sku_id = ? WHERE ${match}`;
    const headParams = [id, ...(search ? [key, key] : []), id, ...matchParams];
    // rest 用已經 JOIN 咗嘅 r（每個 Supplier 最多一行）排除 head；寫成 NOT EXISTS 嘅話，optimizer 會將成張 relation 表掃一次再物化。
    const restFrom = `FROM suppliers s LEFT JOIN supplier_sku_refs r ON r.supplier_id = s.id AND r.sku_id = ? WHERE ${match}
      AND NOT COALESCE((${ranked("r")}${itemCodeExact("r")}), FALSE)${search ? " AND s.supplier_code_key <> ?" : ""}`;
    const restParams = [id, ...matchParams, ...(search ? [key, key] : [])];

    const offset = (page - 1) * pageSize;
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM suppliers s WHERE ${match}`, matchParams);
    const [[{ headTotal }]] = await this.database.query(`SELECT COUNT(*) AS headTotal ${headFrom}`, headParams);
    const exact = search ? "CASE WHEN s.supplier_code_key = ? OR r.supplier_item_code_key = ? THEN 0 ELSE 1 END" : "1";
    const [head] = offset < Number(headTotal)
      ? await this.database.query(
        `SELECT ${FOR_SKU_COLUMNS}, ${exact} AS exact_rank ${headFrom}
          ORDER BY exact_rank, (r.relationship_status <=> 'preferred') DESC,
                   CASE WHEN r.relationship_status <> 'stopped' THEN r.last_supplied_at END DESC, s.supplier_name, s.id
          LIMIT ? OFFSET ?`,
        [...(search ? [key, key] : []), ...headParams, pageSize, offset])
      : [[]];
    const restOffset = Math.max(0, offset - Number(headTotal));
    // 其餘嗰段冇嘢可以攞就唔讀：搜完整代碼通常淨係中 head，咁可以慳一次全表掃描。
    const [rest] = head.length < pageSize && Number(total) - Number(headTotal) > restOffset
      ? await this.database.query(`SELECT ${FOR_SKU_COLUMNS}, 1 AS exact_rank ${restFrom} ORDER BY s.supplier_name, s.id LIMIT ? OFFSET ?`,
        [...restParams, pageSize - head.length, restOffset])
      : [[]];
    // head 同 rest 係兩次讀；中間 relation 改咗嘅話同一個 Supplier 可能兩段都出。去重；呢個只係建議清單，
    // 提交時 BR-032 會再驗（REV-087 L-3）。反方向（兩段都冇讀到）就會喺呢一頁漏咗，下次查詢會返嚟。
    const seen = new Set();
    const rows = [...head, ...rest].filter((row) => !seen.has(Number(row.id)) && seen.add(Number(row.id)));
    const items = rows.map((row) => ({
      ...toProjection(row, { purpose: "purchase" }),
      rankReason: rankReason(row),
      relation: row.relation_id === null ? null : {
        relationId: Number(row.relation_id),
        relationshipStatus: row.relationship_status,
        supplierItemCode: row.supplier_item_code,
        lastSuppliedAt: row.last_supplied_at === null ? null : Number(row.last_supplied_at)
      }
    }));
    // 設計 §12.4：for-SKU 結果入面幾多個係因為歷史／首選排前。只記數字，唔記 Supplier（延遲睇 request log）。
    const reasonCounts = { exact_match: 0, preferred: 0, recently_supplied: 0, none: 0 };
    for (const item of items) reasonCounts[item.rankReason ?? "none"] += 1;
    void this.logger?.info?.("supplier.for_sku.lookup", "Supplier for-SKU lookup", {
      skuId: id, page, pageSize, returned: items.length, total: Number(total), searched: search !== "", ranked: reasonCounts
    });
    return { items, total: Number(total), page, pageSize };
  }

  #read(work) {
    return this.database.withTransaction(work, READ_TRANSACTION_OPTIONS);
  }

  async #findById(connection, supplierId, options, forUpdate = false) {
    const [rows] = await connection.query(
      `${SUPPLIER_SELECT} WHERE id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [supplierId]
    );
    return toProjection(rows[0], options);
  }

  async #assertUsable(connection, supplierId, options, forUpdate) {
    const supplier = await this.#findById(connection, supplierId, options, forUpdate);
    if (!supplier) throw supplierNotFound(supplierId);
    if (!supplier.usable) {
      throw supplierConflict("SUPPLIER_NOT_USABLE", "供應商目前不可用於這個用途", {
        supplierId,
        purpose: options.purpose,
        reasons: supplier.reasons
      });
    }
    return supplier;
  }
}
