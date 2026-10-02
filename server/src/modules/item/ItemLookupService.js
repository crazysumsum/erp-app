/**
 * 下游模組（採購／銷售／庫存）唯一應該依賴嘅唯讀 SKU 查找入口。設計說明見
 * docs/items_management/design_spec.md §8.3。
 *
 * 呢個 service 唔讀 HTTP claims，亦都唔自行授權——呼叫端（採購／庫存／銷售
 * Handler）自己用返自己嘅 permission 做完授權先嚟呼叫呢度，等 Item 模組唔使
 * 認識所有下游角色（同一個理由，`item.view`／`item.mgmt` 兩個 permission 喺
 * 呢個 service 完全用唔著）。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——同 ItemAdminService／
 * ItemCatalogService 一致。
 */
import {
  barcodeLookupInconsistent,
  skuNotFound,
  skuNotUsable,
  uomConversionInvalid
} from "./itemErrors.js";
import { ITEM_LOOKUP_PURPOSES, ITEM_PRICE_CURRENCY, ITEM_PRICE_TAX_BASIS } from "./itemConstants.js";

const SKU_JOIN_ITEM_SELECT = `
  SELECT s.id, s.sku_code, s.sku_name, s.status AS sku_status, s.purchasable, s.sellable, s.inventory_tracked,
         s.tracking_policy, s.shelf_life_days, s.min_receipt_life_days, s.min_sale_life_days,
         s.effective_from, s.effective_to,
         i.id AS item_id, i.name AS item_name, i.product_type, i.status AS item_status
    FROM item_skus s
    JOIN items i ON i.id = s.item_id`;

const SALES_SKU_SELECT = SKU_JOIN_ITEM_SELECT.replace("SELECT s.id,", "SELECT s.version AS sku_version, i.version AS item_version, s.suggested_price_amount, s.id,");

function positiveId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Sales lookup IDs must be positive safe integers");
  return value;
}

function saleIds(values) {
  if (!Array.isArray(values)) throw new TypeError("Sales lookup IDs must be an array");
  const ids = new Set();
  for (const value of values) {
    ids.add(positiveId(value));
    if (ids.size > 100) throw new TypeError("Sales lookup supports at most 100 unique requests");
  }
  return [...ids].sort((a, b) => a - b);
}

function placeholders(ids) { return ids.map(() => "?").join(","); }

function saleUomProjection(row) {
  const factor = Number(row.to_base_factor);
  if (!Number.isSafeInteger(factor) || factor < 1 || factor > 1_000_000 || (row.is_base && factor !== 1)) {
    throw uomConversionInvalid("Sales UOM factor must be an integer from 1 to 1000000; Base UOM factor must be 1");
  }
  return Object.freeze({
    skuUomId: Number(row.id), uomId: Number(row.uom_id), uomCode: row.uom_code, uomName: row.uom_name,
    status: row.uom_status, uomVersion: Number(row.uom_version), mappingVersion: Number(row.version),
    toBaseFactor: factor, isBase: Boolean(row.is_base),
    isDefaultPurchase: Boolean(row.is_default_purchase), isDefaultSale: Boolean(row.is_default_sale)
  });
}

/** 掃描器輸入通常唔會夾埋話你聽係邊種 barcodeType，唔似寫入路徑（見
 * barcodeValidation.js 嘅 `normalizeBarcode()`）可以攞住 type 驗證兼正規
 * 化。呢度淨係做「搵嘢」，唔做寫入前嗰種嚴格驗證（唔合法嘅掃描結果應該
 * 「搵唔到」，唔應該拋一個 GTIN_INVALID 出嚟嚇親呼叫端）——數字就好似 GTIN
 * 咁樣剝走空格／連字號，其他就好似 internal 咁樣淨係 trim。 */
function looseNormalizeBarcode(rawBarcode) {
  const trimmed = String(rawBarcode ?? "").trim();
  const digitsOnly = trimmed.replace(/[ -]/g, "");
  return /^\d+$/.test(digitsOnly) ? digitsOnly : trimmed;
}

export class ItemLookupService {
  constructor({ database, logger, time } = {}) {
    if (!database) {
      throw new TypeError("ItemLookupService requires a database");
    }
    if (!logger) {
      throw new TypeError("ItemLookupService requires a logger");
    }
    if (!time) {
      throw new TypeError("ItemLookupService requires a time service");
    }
    this.database = database;
    this.logger = logger;
    this.time = time;
  }

  /** 按 SKU id 查一粒；搵唔到就回 `null`（唔拋錯——「搵唔到」對呼叫端係合法
   * 結果，唔係 exceptional path；要拋錯用 `assertUsable()`）。 */
  async findById(skuId, options = {}) {
    const [rows] = await this.database.query(`${SKU_JOIN_ITEM_SELECT} WHERE s.id = ?`, [skuId]);
    return this.#toProjectionOrNull(rows[0], options);
  }

  async findByCode(skuCode, options = {}) {
    const [rows] = await this.database.query(`${SKU_JOIN_ITEM_SELECT} WHERE s.sku_code = ?`, [skuCode]);
    return this.#toProjectionOrNull(rows[0], options);
  }

  /** `normalized_barcode` 有 UNIQUE key，正常唔會撞到一個以上嘅 SKU——撞到
   * 即係資料事故，記 error 之後拋出嚟，唔可以任揀一筆當結果。 */
  async findByBarcode(barcode, options = {}) {
    const normalized = looseNormalizeBarcode(barcode);
    const [rows] = await this.database.query(
      `${SKU_JOIN_ITEM_SELECT} JOIN item_sku_barcodes b ON b.sku_id = s.id WHERE b.normalized_barcode = ?`,
      [normalized]
    );

    if (rows.length > 1) {
      const skuIds = [...new Set(rows.map((row) => row.id))];
      void this.logger.error("item.barcode_lookup_inconsistent", "A barcode matched more than one SKU", {
        barcode: normalized,
        skuIds
      });
      throw barcodeLookupInconsistent(normalized);
    }

    return this.#toProjectionOrNull(rows[0], options);
  }

  /** 100 個 id 都係固定兩條 query（呢度＋佢自己嘅 UOM query），唔逐個 id
   * 查——回 `Map<skuId, projection>`，搵唔到嘅 id 唔會出現喺個 map 度。 */
  async findManyByIds(skuIds, options = {}) {
    const uniqueIds = [...new Set(skuIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const placeholders = uniqueIds.map(() => "?").join(",");
    const [rows] = await this.database.query(`${SKU_JOIN_ITEM_SELECT} WHERE s.id IN (${placeholders})`, uniqueIds);

    const uomRowsBySkuId = await this.#loadUomRows(rows.map((row) => row.id));
    const result = new Map();
    for (const row of rows) {
      result.set(Number(row.id), this.#toProjection(row, uomRowsBySkuId.get(Number(row.id)) ?? [], options));
    }
    return result;
  }

  async findManyForSale(skuIds, { atMs, purpose = "new_sale" } = {}) {
    if (purpose !== "new_sale") throw new TypeError("Sales lookup purpose must be new_sale");
    const nowMs = this.#saleTime(atMs);
    const ids = saleIds(skuIds);
    if (!ids.length) return new Map();
    const [rows] = await this.database.query(`${SALES_SKU_SELECT} WHERE s.id IN (${placeholders(ids)}) ORDER BY s.id`, ids);
    const uoms = await this.#loadUomRows(rows.map(row => Number(row.id)));
    return new Map(rows.map(row => [Number(row.id), this.#saleProjection(row, uoms.get(Number(row.id)) ?? [], nowMs)]));
  }

  async findSaleUom(skuId, skuUomId, { atMs } = {}) {
    positiveId(skuUomId);
    const sku = (await this.findManyForSale([skuId], { atMs })).get(skuId);
    if (!sku?.usable) return null;
    return sku.uoms.find(uom => uom.skuUomId === skuUomId && uom.status === "active") ?? null;
  }

  async getSalesSnapshotsInTransaction(transaction, requests, { atMs } = {}) {
    this.#assertExecutor(transaction);
    const nowMs = this.#saleTime(atMs);
    if (!Array.isArray(requests)) throw new TypeError("Sales snapshot requests must be an array");
    const unique = new Map();
    for (const request of requests) {
      const skuId = positiveId(request?.skuId), skuUomId = positiveId(request?.skuUomId);
      unique.set(`${skuId}:${skuUomId}`, { skuId, skuUomId });
      if (unique.size > 100) throw new TypeError("Sales lookup supports at most 100 unique requests");
    }
    const wanted = [...unique.values()].sort((a, b) => a.skuId - b.skuId || a.skuUomId - b.skuUomId);
    if (!wanted.length) return Object.freeze([]);
    const skuIds = saleIds(wanted.map(request => request.skuId));
    // Discover first; every returned value below comes from current locked reads.
    const [discovered] = await transaction.query(
      `SELECT s.id AS sku_id, s.item_id, su.id, su.uom_id
         FROM item_skus s LEFT JOIN item_sku_uoms su ON su.sku_id = s.id
        WHERE s.id IN (${placeholders(skuIds)}) ORDER BY s.id, su.id`, skuIds
    );
    for (const id of skuIds) if (!discovered.some(row => Number(row.sku_id) === id)) throw skuNotFound(id);
    const itemIds = [...new Set(discovered.map(row => Number(row.item_id)))].sort((a, b) => a - b);
    const uomIds = [...new Set(discovered.filter(row => row.id !== null).map(row => Number(row.uom_id)))].sort((a, b) => a - b);
    if (!uomIds.length) throw uomConversionInvalid("Sales SKU has no UOM associations");
    const [uoms] = await transaction.query(
      `SELECT id, code, name, status, version FROM item_uoms WHERE id IN (${placeholders(uomIds)}) ORDER BY id FOR SHARE`, uomIds
    );
    const [items] = await transaction.query(
      `SELECT id, name, product_type, status, version FROM items WHERE id IN (${placeholders(itemIds)}) ORDER BY id FOR SHARE`, itemIds
    );
    const [skus] = await transaction.query(
      `SELECT s.*, s.status AS sku_status, s.version AS sku_version FROM item_skus s
        WHERE s.id IN (${placeholders(skuIds)}) ORDER BY s.id FOR SHARE`, skuIds
    );
    const [mappings] = await transaction.query(
      `SELECT * FROM item_sku_uoms WHERE sku_id IN (${placeholders(skuIds)}) ORDER BY id FOR SHARE`, skuIds
    );
    const byUom = new Map(uoms.map(row => [Number(row.id), row]));
    const byItem = new Map(items.map(row => [Number(row.id), row]));
    const bySku = new Map(skus.map(row => [Number(row.id), row]));
    const original = new Map(discovered.filter(row => row.id !== null).map(row => [Number(row.id), row]));
    if (mappings.length !== original.size) throw uomConversionInvalid("SKU UOM associations changed; retry the transaction");
    const byMapping = new Map();
    for (const mapping of mappings) {
      const before = original.get(Number(mapping.id));
      const sku = bySku.get(Number(mapping.sku_id));
      const uom = byUom.get(Number(mapping.uom_id));
      if (!before || !sku || !uom || Number(before.sku_id) !== Number(mapping.sku_id) ||
          Number(before.uom_id) !== Number(mapping.uom_id) || Number(before.item_id) !== Number(sku.item_id)) {
        throw uomConversionInvalid("SKU UOM associations changed; retry the transaction");
      }
      byMapping.set(Number(mapping.id), { ...mapping, uom_code: uom.code, uom_name: uom.name, uom_status: uom.status, uom_version: uom.version });
    }
    const projections = new Map();
    for (const sku of skus) {
      const item = byItem.get(Number(sku.item_id));
      if (!item) throw skuNotFound(Number(sku.id));
      const projection = this.#saleProjection({ ...sku, item_id: item.id, item_name: item.name, item_status: item.status,
        product_type: item.product_type, item_version: item.version },
      [...byMapping.values()].filter(row => Number(row.sku_id) === Number(sku.id)), nowMs);
      if (!projection.usable) throw skuNotUsable(projection.skuId, "new_sale", projection.reasons);
      projections.set(projection.skuId, projection);
    }
    return Object.freeze(wanted.map(({ skuId, skuUomId }) => {
      const sku = projections.get(skuId);
      if (!sku) throw skuNotFound(skuId);
      const salesUom = sku.uoms.find(uom => uom.skuUomId === skuUomId);
      if (!salesUom || salesUom.status !== "active") throw uomConversionInvalid("Sales UOM is missing, inactive or belongs to another SKU");
      return Object.freeze({ ...sku, salesUom });
    }));
  }

  async getSalesInventoryProfilesInTransaction(transaction, skuIds, { atMs } = {}) {
    this.#assertExecutor(transaction);
    const nowMs = this.#saleTime(atMs);
    const ids = saleIds(skuIds);
    if (!ids.length) return new Map();
    const [bases] = await transaction.query(
      `SELECT sku_id, id FROM item_sku_uoms WHERE sku_id IN (${placeholders(ids)}) AND is_base = 1 ORDER BY sku_id`, ids
    );
    if (bases.length !== ids.length || new Set(bases.map(row => Number(row.sku_id))).size !== ids.length) {
      throw uomConversionInvalid("Every Sales SKU requires exactly one Base UOM");
    }
    const snapshots = await this.getSalesSnapshotsInTransaction(transaction,
      bases.map(row => ({ skuId: Number(row.sku_id), skuUomId: Number(row.id) })), { atMs: nowMs });
    for (const snapshot of snapshots) {
      const currentBases = snapshot.uoms.filter(uom => uom.isBase);
      if (currentBases.length !== 1 || currentBases[0].skuUomId !== snapshot.salesUom.skuUomId ||
          snapshot.salesUom.toBaseFactor !== 1) throw uomConversionInvalid("Base UOM changed; retry the transaction");
    }
    return new Map(snapshots.map(snapshot => [snapshot.skuId, snapshot]));
  }

  /** 搵唔到就拋 `SKU_NOT_FOUND`；搵到但唔啱呢個 purpose 就拋 `SKU_NOT_
   * USABLE`（帶埋 `reasons`）；兩種都啱先返個 projection。 */
  async assertUsable(skuId, options = {}) {
    const projection = await this.findById(skuId, options);
    if (!projection) {
      throw skuNotFound(skuId);
    }
    if (!projection.usable) {
      throw skuNotUsable(skuId, options.purpose, projection.reasons);
    }
    return projection;
  }

  async getInventoryProfileInTransaction(transaction, skuId) {
    this.#assertExecutor(transaction);
    const [rows] = await transaction.query(`${SKU_JOIN_ITEM_SELECT} WHERE s.id = ?`, [skuId]);
    if (!rows[0]) return null;

    const uomRows = await this.#loadUomRows([rows[0].id], transaction);
    const projection = this.#toProjection(
      rows[0],
      uomRows.get(Number(rows[0].id)) ?? [],
      { purpose: "inventory" }
    );
    const baseUom = projection.uoms.find((uom) => uom.isBase);
    if (!baseUom || baseUom.toBaseFactor !== 1) {
      throw uomConversionInvalid("Inventory profile requires exactly one Base UOM with factor 1");
    }

    return {
      skuId: projection.skuId,
      skuCode: projection.skuCode,
      skuName: projection.skuName,
      skuStatus: projection.skuStatus,
      itemStatus: projection.itemStatus,
      inventoryTracked: projection.inventoryTracked,
      trackingPolicy: projection.trackingPolicy,
      shelfLifeDays: projection.shelfLifeDays,
      minimumReceiptLifeDays: projection.minimumReceiptLifeDays,
      minimumSaleLifeDays: projection.minimumSaleLifeDays,
      baseUom: { uomId: baseUom.uomId, uomCode: baseUom.uomCode },
      usable: projection.usable,
      reasons: projection.reasons
    };
  }

  async resolveUomInTransaction(transaction, skuId, uomId) {
    this.#assertExecutor(transaction);
    const [rows] = await transaction.query(
      `SELECT su.sku_id, su.uom_id, u.code AS uom_code, su.to_base_factor, su.is_base
         FROM item_sku_uoms su
         JOIN item_uoms u ON u.id = su.uom_id
        WHERE su.sku_id = ? AND su.uom_id = ? AND u.status = 'active'`,
      [skuId, uomId]
    );
    if (!rows[0]) return null;

    const factor = Number(rows[0].to_base_factor);
    const isBase = Boolean(rows[0].is_base);
    if (!Number.isSafeInteger(factor) || factor < 1 || factor > 1_000_000 || (isBase && factor !== 1)) {
      throw uomConversionInvalid("Inventory UOM factor must be an integer from 1 to 1000000; Base UOM factor must be 1");
    }

    return {
      skuId: Number(rows[0].sku_id),
      uomId: Number(rows[0].uom_id),
      uomCode: rows[0].uom_code,
      toBaseFactor: factor,
      isBase
    };
  }

  async #toProjectionOrNull(row, options) {
    if (!row) {
      return null;
    }
    const uomRowsBySkuId = await this.#loadUomRows([row.id]);
    return this.#toProjection(row, uomRowsBySkuId.get(Number(row.id)) ?? [], options);
  }

  async #loadUomRows(skuIds, executor = this.database) {
    const uniqueIds = [...new Set(skuIds)];
    const byId = new Map();
    if (uniqueIds.length === 0) {
      return byId;
    }

    const placeholders = uniqueIds.map(() => "?").join(",");
    const [rows] = await executor.query(
      `SELECT su.id, su.sku_id, su.uom_id, su.version, u.code AS uom_code,
              u.name AS uom_name, u.status AS uom_status, u.version AS uom_version, su.to_base_factor, su.is_base,
              su.is_default_purchase, su.is_default_sale
         FROM item_sku_uoms su
         JOIN item_uoms u ON u.id = su.uom_id
        WHERE su.sku_id IN (${placeholders})`,
      uniqueIds
    );

    for (const row of rows) {
      const skuId = Number(row.sku_id);
      if (!byId.has(skuId)) {
        byId.set(skuId, []);
      }
      byId.get(skuId).push(row);
    }
    return byId;
  }

  #assertExecutor(executor) {
    if (!executor || typeof executor.query !== "function") {
      throw new TypeError("ItemLookupService transaction executor must provide query()");
    }
  }

  #saleTime(atMs) {
    const nowMs = atMs ?? this.time.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("atMs must be a non-negative safe integer");
    return nowMs;
  }

  #saleProjection(row, uomRows, atMs) {
    const projection = this.#toProjection(row, uomRows, { purpose: "sale", atMs });
    const reasons = projection.reasons.filter(reason => reason !== "STATUS_NOT_SELLABLE");
    if (row.item_status !== "active" || row.sku_status !== "active") reasons.push("STATUS_NOT_ACTIVE");
    if (row.tracking_policy === "serial") reasons.push("SERIAL_NOT_SUPPORTED");
    return Object.freeze({ ...projection, skuVersion: Number(row.sku_version), itemVersion: Number(row.item_version),
      suggestedPrice: row.suggested_price_amount === null ? null : Object.freeze({
        amount: String(row.suggested_price_amount), currency: ITEM_PRICE_CURRENCY, taxBasis: ITEM_PRICE_TAX_BASIS
      }), uoms: Object.freeze(uomRows.map(saleUomProjection)), usable: reasons.length === 0, reasons: Object.freeze(reasons) });
  }

  #toProjection(row, uomRows, { purpose, atMs, includeInactive = false } = {}) {
    const { usable, reasons } = this.#evaluateUsability(row, { purpose, atMs, includeInactive });

    return {
      skuId: Number(row.id),
      skuCode: row.sku_code,
      skuName: row.sku_name,
      skuStatus: row.sku_status,
      itemId: Number(row.item_id),
      itemName: row.item_name,
      productType: row.product_type,
      itemStatus: row.item_status,
      purchasable: Boolean(row.purchasable),
      sellable: Boolean(row.sellable),
      inventoryTracked: Boolean(row.inventory_tracked),
      trackingPolicy: row.tracking_policy,
      shelfLifeDays: row.shelf_life_days === null ? null : Number(row.shelf_life_days),
      minimumReceiptLifeDays: row.min_receipt_life_days === null ? null : Number(row.min_receipt_life_days),
      minimumSaleLifeDays: row.min_sale_life_days === null ? null : Number(row.min_sale_life_days),
      effectiveFrom: row.effective_from === null ? null : Number(row.effective_from),
      effectiveTo: row.effective_to === null ? null : Number(row.effective_to),
      uoms: uomRows.map((uom) => ({
        uomId: Number(uom.uom_id),
        uomCode: uom.uom_code,
        toBaseFactor: Number(uom.to_base_factor),
        isBase: Boolean(uom.is_base),
        isDefaultPurchase: Boolean(uom.is_default_purchase),
        isDefaultSale: Boolean(uom.is_default_sale)
      })),
      usable,
      reasons
    };
  }

  /** 三種 purpose 各自嘅可用性規則，見 design_spec §8.3 嘅表。冇帶 `purpose`
   * 就淨係睇「未封存」，等 `findById()` 呢類唔帶 purpose 嘅泛用查詢都有個
   * 合理嘅預設可用性判斷。 */
  #evaluateUsability(row, { purpose, atMs, includeInactive }) {
    const reasons = [];
    const now = atMs ?? this.time.nowMs();

    if (purpose !== undefined && !ITEM_LOOKUP_PURPOSES.includes(purpose)) {
      throw new TypeError(`Unknown ItemLookupService purpose: "${purpose}"`);
    }

    const withinEffectiveRange =
      (row.effective_from === null || now >= Number(row.effective_from)) &&
      (row.effective_to === null || now <= Number(row.effective_to));

    if (purpose === "purchase") {
      if (row.item_status !== "active" || row.sku_status !== "active") {
        reasons.push("STATUS_NOT_ACTIVE");
      }
      if (!row.purchasable) {
        reasons.push("NOT_PURCHASABLE");
      }
      if (!withinEffectiveRange) {
        reasons.push("OUTSIDE_EFFECTIVE_RANGE");
      }
    } else if (purpose === "sale") {
      const statusOk =
        (row.item_status === "active" && ["active", "discontinued"].includes(row.sku_status)) ||
        (row.item_status === "discontinued" && row.sku_status === "discontinued");
      if (!statusOk) {
        reasons.push("STATUS_NOT_SELLABLE");
      }
      if (!row.sellable) {
        reasons.push("NOT_SELLABLE");
      }
      if (!withinEffectiveRange) {
        reasons.push("OUTSIDE_EFFECTIVE_RANGE");
      }
    } else if (purpose === "inventory") {
      if (!row.inventory_tracked) {
        reasons.push("NOT_INVENTORY_TRACKED");
      }
      if (row.item_status === "archived" || row.sku_status === "archived") {
        reasons.push("ARCHIVED");
      } else if (!includeInactive && row.sku_status !== "active") {
        reasons.push("NOT_ACTIVE");
      }
    } else {
      if (row.item_status === "archived" || row.sku_status === "archived") {
        reasons.push("ARCHIVED");
      }
    }

    return { usable: reasons.length === 0, reasons };
  }
}
