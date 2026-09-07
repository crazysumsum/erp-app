/**
 * Item／SKU 的唯讀查詢：分頁列表與詳情。設計說明見
 * docs/items_management/design_spec.md §6.2、§6.3、§6.10、§8.8。
 *
 * 只做「讀」——建立、修改、狀態變更、刪除等寫入路徑是 T14 之後的事，那時會在
 * 同一個類別上繼續加方法（跟 ItemCatalogService 一個類別涵蓋 Category／
 * Brand／UOM 全部操作是同一個理由）。
 *
 * Attribute values（variant values）同 media 未列入任何 response：兩者依賴
 * 的資料表（item_attribute_values、item_sku_attribute_values、item_media）
 * 是 T23／T25 才會建立，現在硬塞欄位只能回一個永遠是空陣列的假欄位，之後
 * 還要記得回頭改——不如等表存在時直接把真正的查詢接上。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 ItemCatalogService
 * 同一個理由。
 */
import { itemNotFound, skuNotFound } from "./itemErrors.js";
import { ITEM_LIST_SORT_FIELDS, ITEM_PRICE_CURRENCY, ITEM_PRICE_TAX_BASIS } from "./itemConstants.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";

/** `%`、`_`、`\` 是 LIKE 的萬用字元／跳脫字元，使用者輸入的字面值要先跳脫。
 * 這種規模的純函式重複一份，比為了它另開一個共用檔案划算——見
 * UserAdminService.js 開頭對同一件事的說明。 */
function escapeLikeTerm(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** GTIN 正規化的第一步（見 barcodeValidation.js）：條碼搜尋容忍使用者輸入帶
 * 空格或連字號，不要求先自己清乾淨才搜得到。這裡不做完整 GTIN 驗證——搜尋
 * 本來就該對錯字寬容，不是在重新驗證條碼合不合法。 */
function stripBarcodeSeparators(value) {
  return value.replace(/[ -]/g, "");
}

const ITEM_SORT_COLUMNS = Object.freeze({
  name: "i.name",
  category: "c.name",
  brand: "b.name",
  status: "i.status",
  updatedAt: "i.updated_at"
});

const SKU_SORT_COLUMNS = Object.freeze({
  skuCode: "s.sku_code",
  name: "s.sku_name",
  category: "c.name",
  brand: "b.name",
  status: "s.status",
  updatedAt: "s.updated_at"
});

/** Item 列表冇 skuCode 呢個欄位可以排（一個 Item 可以有多個 SKU，邊個排先冇
 * 意義），跌到白名單以外或者 Item 用唔到嘅欄位一律退回 updatedAt。 */
function itemSortColumn(sortBy) {
  return ITEM_LIST_SORT_FIELDS.includes(sortBy) && ITEM_SORT_COLUMNS[sortBy]
    ? ITEM_SORT_COLUMNS[sortBy]
    : ITEM_SORT_COLUMNS.updatedAt;
}

function skuSortColumn(sortBy) {
  return ITEM_LIST_SORT_FIELDS.includes(sortBy) ? SKU_SORT_COLUMNS[sortBy] : SKU_SORT_COLUMNS.updatedAt;
}

function priceResponse(amount) {
  if (amount === null || amount === undefined) {
    return null;
  }
  return { amount: String(amount), currency: ITEM_PRICE_CURRENCY, taxBasis: ITEM_PRICE_TAX_BASIS };
}

export class ItemAdminService {
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("ItemAdminService requires database, logger and time");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
  }

  // --- Item：列表／詳情 ------------------------------------------------------

  /**
   * Item 分頁列表。`q` 同時搜 Item 名稱及它任何一個 SKU 的 Code／名稱／條碼；
   * 用 EXISTS 而不是 JOIN item_skus／item_sku_barcodes，避免一個 Item 有多個
   * 符合條件的 SKU 或條碼時被 JOIN 撐開成多列，令 total 膨脹、分頁跟著算錯
   * （design_spec.md §8.8）。
   */
  async listItems({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    q = "",
    categoryId,
    brandId,
    status,
    sortBy = "updatedAt",
    descending = true
  }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const conditions = [];
    const params = [];

    if (categoryId !== undefined) {
      conditions.push("i.category_id = ?");
      params.push(categoryId);
    }
    if (brandId !== undefined) {
      conditions.push("i.brand_id = ?");
      params.push(brandId);
    }
    if (status) {
      conditions.push("i.status = ?");
      params.push(status);
    }

    const term = String(q ?? "").trim();
    if (term) {
      const escaped = escapeLikeTerm(term);
      const barcodeDigits = stripBarcodeSeparators(term);
      conditions.push(
        `(i.name LIKE ? OR EXISTS (
           SELECT 1 FROM item_skus es
            WHERE es.item_id = i.id
              AND (es.sku_code LIKE ? OR es.sku_name LIKE ? OR EXISTS (
                SELECT 1 FROM item_sku_barcodes eb
                 WHERE eb.sku_id = es.id AND eb.normalized_barcode = ?
              ))
         ))`
      );
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, barcodeDigits);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const direction = descending ? "DESC" : "ASC";
    const offset = (page - 1) * pageSize;

    const fromClause = `FROM items i
       LEFT JOIN item_categories c ON c.id = i.category_id
       LEFT JOIN item_brands b ON b.id = i.brand_id`;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total ${fromClause} ${whereClause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT i.id, i.name, i.short_name, i.category_id, c.name AS category_name,
              i.brand_id, b.name AS brand_name, i.product_type, i.status,
              i.version, i.updated_at,
              (SELECT COUNT(*) FROM item_skus WHERE item_id = i.id) AS sku_count
         ${fromClause} ${whereClause}
        ORDER BY ${itemSortColumn(sortBy)} ${direction}, i.id ${direction}
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      items: rows.map((row) => this.#toItemSummary(row)),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  /** Item 詳情：Item 本身欄位＋全部 SKU 摘要＋version。 */
  async getItem({ actorId, claimedRoles, claimedPermissions, id }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const [[row]] = await this.database.query(
      `SELECT i.id, i.name, i.short_name, i.description, i.category_id, c.name AS category_name,
              i.brand_id, b.name AS brand_name, i.product_type, i.country_of_origin,
              i.manufacturer, i.default_tracking_policy, i.default_shelf_life_days,
              i.status, i.version, i.created_at, i.updated_at
         FROM items i
         LEFT JOIN item_categories c ON c.id = i.category_id
         LEFT JOIN item_brands b ON b.id = i.brand_id
        WHERE i.id = ?`,
      [id]
    );

    if (!row) {
      throw itemNotFound(id);
    }

    const [skuRows] = await this.database.query(
      `SELECT id, sku_code, sku_name, status, suggested_price_amount, version
         FROM item_skus
        WHERE item_id = ?
        ORDER BY sku_code`,
      [id]
    );

    return this.#toItemDetail(row, skuRows);
  }

  // --- SKU：列表／詳情 ------------------------------------------------------

  /**
   * SKU 平鋪分頁列表。`q` 的排序優先序見 design_spec.md §8.8：
   *   1. sku_code 或 normalized_barcode 完全相符排最前；
   *   2. sku_code 前綴相符次之；
   *   3. sku_code／sku_name／Item 名稱的 contains 相符再次之。
   * 只在有 `q` 的時候才加這個 rank 排序，排在呼叫端要求的 sortBy 之前；冇 `q`
   * 就完全跟 sortBy／descending 走。
   */
  async listSkus({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    q = "",
    itemId,
    categoryId,
    brandId,
    status,
    purchasable,
    sellable,
    sortBy = "updatedAt",
    descending = true
  }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const conditions = [];
    const params = [];

    if (itemId !== undefined) {
      conditions.push("s.item_id = ?");
      params.push(itemId);
    }
    if (categoryId !== undefined) {
      conditions.push("i.category_id = ?");
      params.push(categoryId);
    }
    if (brandId !== undefined) {
      conditions.push("i.brand_id = ?");
      params.push(brandId);
    }
    if (status) {
      conditions.push("s.status = ?");
      params.push(status);
    }
    if (purchasable !== undefined) {
      conditions.push("s.purchasable = ?");
      params.push(purchasable ? 1 : 0);
    }
    if (sellable !== undefined) {
      conditions.push("s.sellable = ?");
      params.push(sellable ? 1 : 0);
    }

    const term = String(q ?? "").trim();
    let rankExpression = null;
    const rankParams = [];

    if (term) {
      const escaped = escapeLikeTerm(term);
      const barcodeDigits = stripBarcodeSeparators(term);

      conditions.push(
        `(s.sku_code = ? OR EXISTS (
           SELECT 1 FROM item_sku_barcodes eb WHERE eb.sku_id = s.id AND eb.normalized_barcode = ?
         ) OR s.sku_code LIKE ? OR s.sku_name LIKE ? OR i.name LIKE ?)`
      );
      params.push(term, barcodeDigits, `${escaped}%`, `%${escaped}%`, `%${escaped}%`);

      rankExpression = `CASE
        WHEN s.sku_code = ? THEN 0
        WHEN EXISTS (SELECT 1 FROM item_sku_barcodes eb WHERE eb.sku_id = s.id AND eb.normalized_barcode = ?) THEN 0
        WHEN s.sku_code LIKE ? THEN 1
        ELSE 2
      END`;
      rankParams.push(term, barcodeDigits, `${escaped}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const direction = descending ? "DESC" : "ASC";
    const offset = (page - 1) * pageSize;

    const fromClause = `FROM item_skus s
       JOIN items i ON i.id = s.item_id
       LEFT JOIN item_categories c ON c.id = i.category_id
       LEFT JOIN item_brands b ON b.id = i.brand_id`;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total ${fromClause} ${whereClause}`,
      params
    );

    const orderClause = rankExpression
      ? `ORDER BY ${rankExpression}, ${skuSortColumn(sortBy)} ${direction}, s.id ${direction}`
      : `ORDER BY ${skuSortColumn(sortBy)} ${direction}, s.id ${direction}`;

    const [rows] = await this.database.query(
      `SELECT s.id, s.sku_code, s.sku_name, s.item_id, i.name AS item_name,
              i.category_id, c.name AS category_name, i.brand_id, b.name AS brand_name,
              s.status, s.suggested_price_amount, s.purchasable, s.sellable,
              s.version, s.updated_at,
              (SELECT b2.barcode FROM item_sku_barcodes b2
                WHERE b2.sku_id = s.id AND b2.is_primary = 1 LIMIT 1) AS primary_barcode,
              (SELECT u.code FROM item_sku_uoms su
                 JOIN item_uoms u ON u.id = su.uom_id
                WHERE su.sku_id = s.id AND su.is_base = 1 LIMIT 1) AS base_uom_code
         ${fromClause} ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?`,
      [...params, ...rankParams, pageSize, offset]
    );

    return {
      items: rows.map((row) => this.#toSkuSummary(row)),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  /** SKU 詳情：SKU 本身欄位＋Item 摘要＋UOM 集合＋條碼集合＋價格口徑＋version。 */
  async getSku({ actorId, claimedRoles, claimedPermissions, id }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const [[row]] = await this.database.query(
      `SELECT s.*, i.name AS item_name, i.status AS item_status, i.product_type AS item_product_type,
              i.category_id AS item_category_id, c.name AS item_category_name,
              i.brand_id AS item_brand_id, b.name AS item_brand_name
         FROM item_skus s
         JOIN items i ON i.id = s.item_id
         LEFT JOIN item_categories c ON c.id = i.category_id
         LEFT JOIN item_brands b ON b.id = i.brand_id
        WHERE s.id = ?`,
      [id]
    );

    if (!row) {
      throw skuNotFound(id);
    }

    const [uomRows] = await this.database.query(
      `SELECT su.id, su.uom_id, u.code AS uom_code, u.name AS uom_name, su.to_base_factor,
              su.is_base, su.is_default_purchase, su.is_default_sale
         FROM item_sku_uoms su
         JOIN item_uoms u ON u.id = su.uom_id
        WHERE su.sku_id = ?
        ORDER BY su.is_base DESC, u.code`,
      [id]
    );

    const [barcodeRows] = await this.database.query(
      `SELECT id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary
         FROM item_sku_barcodes
        WHERE sku_id = ?
        ORDER BY is_primary DESC, id`,
      [id]
    );

    return this.#toSkuDetail(row, uomRows, barcodeRows);
  }

  // --- 內部：response 白名單映射 ---------------------------------------------

  #toItemSummary(row) {
    return {
      id: Number(row.id),
      name: row.name,
      shortName: row.short_name,
      categoryId: row.category_id === null ? null : Number(row.category_id),
      categoryName: row.category_name ?? null,
      brandId: row.brand_id === null ? null : Number(row.brand_id),
      brandName: row.brand_name ?? null,
      productType: row.product_type,
      status: row.status,
      skuCount: Number(row.sku_count),
      version: Number(row.version),
      updatedAt: Number(row.updated_at)
    };
  }

  #toItemDetail(row, skuRows) {
    return {
      id: Number(row.id),
      name: row.name,
      shortName: row.short_name,
      description: row.description,
      categoryId: row.category_id === null ? null : Number(row.category_id),
      categoryName: row.category_name ?? null,
      brandId: row.brand_id === null ? null : Number(row.brand_id),
      brandName: row.brand_name ?? null,
      productType: row.product_type,
      countryOfOrigin: row.country_of_origin,
      manufacturer: row.manufacturer,
      defaultTrackingPolicy: row.default_tracking_policy,
      defaultShelfLifeDays: row.default_shelf_life_days === null ? null : Number(row.default_shelf_life_days),
      status: row.status,
      // Attribute values 未接上：item_attribute_values 表要等 T23 先建立。
      attributeValues: [],
      skus: skuRows.map((sku) => ({
        id: Number(sku.id),
        skuCode: sku.sku_code,
        skuName: sku.sku_name,
        status: sku.status,
        suggestedRetailPrice: priceResponse(sku.suggested_price_amount),
        version: Number(sku.version)
      })),
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  #toSkuSummary(row) {
    return {
      id: Number(row.id),
      skuCode: row.sku_code,
      skuName: row.sku_name,
      itemId: Number(row.item_id),
      itemName: row.item_name,
      categoryId: row.category_id === null ? null : Number(row.category_id),
      categoryName: row.category_name ?? null,
      brandId: row.brand_id === null ? null : Number(row.brand_id),
      brandName: row.brand_name ?? null,
      status: row.status,
      primaryBarcode: row.primary_barcode ?? null,
      baseUomCode: row.base_uom_code ?? null,
      suggestedRetailPrice: priceResponse(row.suggested_price_amount),
      purchasable: Boolean(row.purchasable),
      sellable: Boolean(row.sellable),
      version: Number(row.version),
      updatedAt: Number(row.updated_at)
    };
  }

  #toSkuDetail(row, uomRows, barcodeRows) {
    return {
      id: Number(row.id),
      skuCode: row.sku_code,
      skuName: row.sku_name,
      item: {
        id: Number(row.item_id),
        name: row.item_name,
        status: row.item_status,
        productType: row.item_product_type,
        categoryId: row.item_category_id === null ? null : Number(row.item_category_id),
        categoryName: row.item_category_name ?? null,
        brandId: row.item_brand_id === null ? null : Number(row.item_brand_id),
        brandName: row.item_brand_name ?? null
      },
      variantSignature: row.variant_signature,
      // Variant values 未接上：item_sku_attribute_values 表要等 T23 先建立。
      variantValues: [],
      netContent: row.net_content,
      netContentUomId: row.net_content_uom_id === null ? null : Number(row.net_content_uom_id),
      weight: row.weight,
      weightUomId: row.weight_uom_id === null ? null : Number(row.weight_uom_id),
      length: row.length,
      width: row.width,
      height: row.height,
      dimensionUomId: row.dimension_uom_id === null ? null : Number(row.dimension_uom_id),
      trackingPolicy: row.tracking_policy,
      shelfLifeDays: row.shelf_life_days === null ? null : Number(row.shelf_life_days),
      minReceiptLifeDays: row.min_receipt_life_days === null ? null : Number(row.min_receipt_life_days),
      minSaleLifeDays: row.min_sale_life_days === null ? null : Number(row.min_sale_life_days),
      purchasable: Boolean(row.purchasable),
      sellable: Boolean(row.sellable),
      inventoryTracked: Boolean(row.inventory_tracked),
      suggestedRetailPrice: priceResponse(row.suggested_price_amount),
      effectiveFrom: row.effective_from === null ? null : Number(row.effective_from),
      effectiveTo: row.effective_to === null ? null : Number(row.effective_to),
      status: row.status,
      uoms: uomRows.map((uom) => ({
        id: Number(uom.id),
        uomId: Number(uom.uom_id),
        uomCode: uom.uom_code,
        uomName: uom.uom_name,
        toBaseFactor: Number(uom.to_base_factor),
        isBase: Boolean(uom.is_base),
        isDefaultPurchase: Boolean(uom.is_default_purchase),
        isDefaultSale: Boolean(uom.is_default_sale)
      })),
      barcodes: barcodeRows.map((barcode) => ({
        id: Number(barcode.id),
        skuUomId: Number(barcode.sku_uom_id),
        barcode: barcode.barcode,
        normalizedBarcode: barcode.normalized_barcode,
        barcodeType: barcode.barcode_type,
        isPrimary: Boolean(barcode.is_primary)
      })),
      // Media 未接上：item_media 表要等 T25 先建立。
      media: [],
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }
}
