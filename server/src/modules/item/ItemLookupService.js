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
import { barcodeLookupInconsistent, skuNotFound, skuNotUsable } from "./itemErrors.js";
import { ITEM_LOOKUP_PURPOSES } from "./itemConstants.js";

const SKU_JOIN_ITEM_SELECT = `
  SELECT s.id, s.sku_code, s.status AS sku_status, s.purchasable, s.sellable, s.inventory_tracked,
         s.tracking_policy, s.shelf_life_days, s.min_receipt_life_days, s.min_sale_life_days,
         s.effective_from, s.effective_to,
         i.id AS item_id, i.name AS item_name, i.product_type, i.status AS item_status
    FROM item_skus s
    JOIN items i ON i.id = s.item_id`;

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

  async #toProjectionOrNull(row, options) {
    if (!row) {
      return null;
    }
    const uomRowsBySkuId = await this.#loadUomRows([row.id]);
    return this.#toProjection(row, uomRowsBySkuId.get(Number(row.id)) ?? [], options);
  }

  async #loadUomRows(skuIds) {
    const uniqueIds = [...new Set(skuIds)];
    const byId = new Map();
    if (uniqueIds.length === 0) {
      return byId;
    }

    const placeholders = uniqueIds.map(() => "?").join(",");
    const [rows] = await this.database.query(
      `SELECT su.sku_id, su.uom_id, u.code AS uom_code, su.to_base_factor, su.is_base,
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

  #toProjection(row, uomRows, { purpose, atMs, includeInactive = false } = {}) {
    const { usable, reasons } = this.#evaluateUsability(row, { purpose, atMs, includeInactive });

    return {
      skuId: Number(row.id),
      skuCode: row.sku_code,
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
