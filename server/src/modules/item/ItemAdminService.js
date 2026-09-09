/**
 * Item／SKU 的查詢、建立。設計說明見
 * docs/items_management/design_spec.md §6.2、§6.3、§6.10、§8.8。
 *
 * 建立（`createItem()`）只做 Standard Item：`productType: "variant"` 直接
 * 拒絕，request 亦不接受 variant values——原因同範圍界線見
 * docs/items_management/tasks.md 的 T14／T23 條目。修改、狀態變更、刪除等
 * 其餘寫入路徑是 T14 之後的事，那時會在同一個類別上繼續加方法（跟
 * ItemCatalogService 一個類別涵蓋 Category／Brand／UOM 全部操作是同一個
 * 理由）。
 *
 * Attribute values（variant values）同 media 未列入任何 response：兩者依賴
 * 的資料表（item_attribute_values、item_sku_attribute_values、item_media）
 * 是 T23／T25 才會建立，現在硬塞欄位只能回一個永遠是空陣列的假欄位，之後
 * 還要記得回頭改——不如等表存在時直接把真正的查詢接上。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 ItemCatalogService
 * 同一個理由。
 */
import {
  activationReasonRequired,
  attributeNotFound,
  attributeOptionNotFound,
  attributeValueInvalid,
  barcodeNotFound,
  barcodePrimaryDuplicated,
  barcodeTaken,
  brandNotFound,
  categoryNotFound,
  criticalChangeReasonRequired,
  itemActivationRequiresSku,
  itemDeleteRequiresDraft,
  itemNotFound,
  lastActiveSku,
  lastSkuInItem,
  skuChildMismatch,
  skuCodeTaken,
  skuDeleteRequiresDraft,
  skuNotFound,
  standardItemSkuLimit,
  standardSkuHasVariantValues,
  statusTransitionInvalid,
  uomConversionInvalid,
  uomNotFound,
  variantCombinationTaken,
  variantValuesRequired,
  versionConflict
} from "./itemErrors.js";
import { ITEM_LIST_SORT_FIELDS, ITEM_PRICE_CURRENCY, ITEM_PRICE_TAX_BASIS } from "./itemConstants.js";
import { assertSkuActivatable } from "./itemValidation.js";
import { normalizeBarcode } from "./barcodeValidation.js";
import { computeVariantSignature, typedValueToCanonicalString } from "./variantSignature.js";
import { ItemAuditLogService } from "./ItemAuditLogService.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";

function isDuplicateEntry(error) {
  return (error?.cause?.code || error?.code) === "ER_DUP_ENTRY";
}

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
    this.auditLog = new ItemAuditLogService({ database, logger, time });
  }

  // --- Item：建立 -----------------------------------------------------------

  /**
   * 原子建立 Item＋一個或多個 SKU（連同各自嘅 UOM／Barcode 集合），
   * `activate: true` 時在同一交易內全部一齊完成啟用。設計說明見
   * design_spec.md §4.1、§4.4、§6.2、§6.9。
   *
   * Standard：`skus` 恰好一個，唔接受 `variantValues`。Variant：每個 SKU
   * 都要有 `variantValues`（`{attributeId, optionId}[]`，淨係 single_option
   * 型別——理由見 itemSchemas.js 嘅 `ITEM_CREATE_SKU_VARIANT_VALUE_SCHEMA`
   * 註解），由呢度查表驗證 attributeId／optionId 真係存在同啱用先計
   * signature；`(item_id, variant_signature)` 呢條 DB unique key（喺
   * `item_skus` 建表嗰陣已經有，見 0015_create_item_skus.js）負責喺並發
   * 情況下實際擋重複組合。
   */
  async createItem({
    actorId,
    claimedRoles,
    claimedPermissions,
    item,
    skus,
    activate = false,
    activationReason,
    requestId,
    ip
  }) {
    if (activate && !String(activationReason ?? "").trim()) {
      throw activationReasonRequired();
    }

    const itemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      if (item.productType === "standard" && skus.length !== 1) {
        throw standardItemSkuLimit();
      }

      const resolvedVariants = [];
      for (const skuInput of skus) {
        resolvedVariants.push(
          await this.#resolveVariantSignature(connection, {
            productType: item.productType,
            variantValues: skuInput.variantValues ?? []
          })
        );
      }

      if (item.categoryId !== null && item.categoryId !== undefined) {
        await this.#assertCategoryExists(connection, item.categoryId);
      }
      if (item.brandId !== null && item.brandId !== undefined) {
        await this.#assertBrandExists(connection, item.brandId);
      }

      const itemName = String(item.name ?? "").trim();
      const defaultTrackingPolicy = item.defaultTrackingPolicy ?? "none";

      const [itemResult] = await connection.execute(
        `INSERT INTO items
           (name, short_name, description, category_id, brand_id, product_type, country_of_origin,
            manufacturer, default_tracking_policy, default_shelf_life_days, status, version,
            created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
        [
          itemName,
          String(item.shortName ?? "").trim(),
          item.description ?? null,
          item.categoryId ?? null,
          item.brandId ?? null,
          item.productType,
          item.countryOfOrigin ?? null,
          String(item.manufacturer ?? "").trim(),
          defaultTrackingPolicy,
          item.defaultShelfLifeDays ?? null,
          nowMs,
          nowMs,
          actorId,
          actorId
        ]
      );
      const newItemId = itemResult.insertId;

      const createdSkus = [];
      for (const [index, skuInput] of skus.entries()) {
        const createdSku = await this.#createSkuRow(connection, {
          itemId: newItemId,
          sku: skuInput,
          defaultTrackingPolicy,
          nowMs,
          actorId,
          variantSignature: resolvedVariants[index].signature,
          variantValues: resolvedVariants[index].variantValues
        });
        createdSkus.push(createdSku);
      }

      let activated = false;
      if (activate) {
        const hasActiveLeafCategory =
          item.categoryId !== null && item.categoryId !== undefined
            ? await this.#isActiveLeafCategory(connection, item.categoryId)
            : false;

        for (const [index, sku] of createdSkus.entries()) {
          assertSkuActivatable({
            item: { productType: item.productType, hasActiveLeafCategory },
            sku: {
              code: sku.code,
              name: sku.name,
              variantSignature: resolvedVariants[index].signature,
              uoms: sku.uoms,
              trackingPolicy: sku.trackingPolicy,
              shelfLifeDays: sku.shelfLifeDays,
              minReceiptLifeDays: sku.minReceiptLifeDays,
              minSaleLifeDays: sku.minSaleLifeDays,
              sellable: sku.sellable,
              suggestedPriceAmount: sku.suggestedPriceAmount,
              effectiveFrom: sku.effectiveFrom,
              effectiveTo: sku.effectiveTo,
              barcodes: sku.normalizedBarcodes.map((normalizedBarcode) => ({ normalizedBarcode }))
            }
          });
        }

        await connection.execute(`UPDATE items SET status = 'active', version = 2, updated_at = ? WHERE id = ?`, [
          nowMs,
          newItemId
        ]);
        for (const sku of createdSkus) {
          await connection.execute(
            `UPDATE item_skus SET status = 'active', version = 2, updated_at = ? WHERE id = ?`,
            [nowMs, sku.id]
          );
        }
        activated = true;
      }

      const auditReason = activate ? activationReason : "";
      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "item.create",
        targetType: "item",
        targetId: newItemId,
        targetLabel: itemName,
        detail: { productType: item.productType, skuCodes: createdSkus.map((sku) => sku.code), activated },
        reason: auditReason,
        requestId,
        ip
      });
      for (const sku of createdSkus) {
        await this.auditLog.record(connection, {
          actorUserId: actorId,
          actorUsername: actor.username,
          action: "sku.create",
          targetType: "sku",
          targetId: sku.id,
          targetLabel: sku.code,
          detail: { itemId: newItemId, activated },
          reason: auditReason,
          requestId,
          ip
        });
      }

      return newItemId;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: itemId });
  }

  // --- Item：更新 -----------------------------------------------------------

  /**
   * 整組覆蓋 Item 層欄位，compare-and-set。冇 `productType`：變返
   * `"variant"` 依然未開放（理由同 `createItem()`），呢期亦冇「改做
   * standard」嘅實際用途（一開始已經淨係得 standard），所以呢個 method
   * 完全唔處理呢個欄位。SKU Code 唔喺呢度（一開始已經 readonly）。
   */
  async updateItem({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    name,
    shortName,
    description,
    categoryId,
    brandId,
    countryOfOrigin,
    manufacturer,
    defaultTrackingPolicy,
    defaultShelfLifeDays,
    version,
    requestId,
    ip
  }) {
    const itemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[current]] = await connection.query("SELECT * FROM items WHERE id = ?", [id]);
      if (!current) {
        throw itemNotFound(id);
      }

      if (categoryId !== null && categoryId !== undefined) {
        await this.#assertCategoryExists(connection, categoryId);
      }
      if (brandId !== null && brandId !== undefined) {
        await this.#assertBrandExists(connection, brandId);
      }

      const nowMs = this.time.nowMs();
      const normalizedName = String(name ?? "").trim();
      const normalizedShortName = String(shortName ?? "").trim();
      const normalizedManufacturer = String(manufacturer ?? "").trim();
      const nextDescription = description ?? null;
      const nextCategoryId = categoryId ?? null;
      const nextBrandId = brandId ?? null;
      const nextCountryOfOrigin = countryOfOrigin ?? null;
      const nextDefaultShelfLifeDays = defaultShelfLifeDays ?? null;

      const [result] = await connection.execute(
        `UPDATE items
            SET name = ?, short_name = ?, description = ?, category_id = ?, brand_id = ?,
                country_of_origin = ?, manufacturer = ?, default_tracking_policy = ?,
                default_shelf_life_days = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ?`,
        [
          normalizedName,
          normalizedShortName,
          nextDescription,
          nextCategoryId,
          nextBrandId,
          nextCountryOfOrigin,
          normalizedManufacturer,
          defaultTrackingPolicy,
          nextDefaultShelfLifeDays,
          nowMs,
          actorId,
          id,
          version
        ]
      );

      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query("SELECT id FROM items WHERE id = ?", [id]);
        if (!stillExists) {
          throw itemNotFound(id);
        }
        throw versionConflict();
      }

      const detail = {};
      if (normalizedName !== current.name) {
        detail.name = { before: current.name, after: normalizedName };
      }
      if (normalizedShortName !== current.short_name) {
        detail.shortName = { before: current.short_name, after: normalizedShortName };
      }
      if (nextDescription !== current.description) {
        detail.description = { before: current.description, after: nextDescription };
      }
      if (Number(nextCategoryId ?? 0) !== Number(current.category_id ?? 0)) {
        detail.categoryId = { before: current.category_id, after: nextCategoryId };
      }
      if (Number(nextBrandId ?? 0) !== Number(current.brand_id ?? 0)) {
        detail.brandId = { before: current.brand_id, after: nextBrandId };
      }
      if (nextCountryOfOrigin !== current.country_of_origin) {
        detail.countryOfOrigin = { before: current.country_of_origin, after: nextCountryOfOrigin };
      }
      if (normalizedManufacturer !== current.manufacturer) {
        detail.manufacturer = { before: current.manufacturer, after: normalizedManufacturer };
      }
      if (defaultTrackingPolicy !== current.default_tracking_policy) {
        detail.defaultTrackingPolicy = { before: current.default_tracking_policy, after: defaultTrackingPolicy };
      }
      if (Number(nextDefaultShelfLifeDays ?? 0) !== Number(current.default_shelf_life_days ?? 0)) {
        detail.defaultShelfLifeDays = { before: current.default_shelf_life_days, after: nextDefaultShelfLifeDays };
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "item.update",
        targetType: "item",
        targetId: id,
        targetLabel: normalizedName,
        detail: Object.keys(detail).length > 0 ? detail : null,
        requestId,
        ip
      });

      return id;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: itemId });
  }

  // --- SKU：更新 ------------------------------------------------------------

  /**
   * 整組覆蓋 SKU（除 `skuCode`／`variantValues` 外全部可編輯欄位＋UOM／
   * Barcode 完整集合），compare-and-set，同一交易處理埋兩張子表。`skuCode`
   * 唔喺呢度（readonly，特批修改留返獨立、未建嘅高強度端點）；
   * `variantValues` 同樣未開放（T23）。
   *
   * UOM／Barcode 用「刪晒重插」而唔係逐行 diff：design_spec §6.3 本身就
   * 形容呢個係「完整集合連同 version 一次提交」，子表本身冇對外承諾嘅
   * 穩定 id——呼叫端提交嘅舊 id 只係用嚟做「呢個 id 係咪真係屬於呢個
   * SKU」嘅擁有權檢查（`SKU_CHILD_MISMATCH`），檢查完之後點樣重建都可以，
   * 冇任何需求要求呢啲 id 跨次更新保持穩定。呢個做法明顯比逐行
   * update／insert／delete 三分支簡單。
   *
   * 「關鍵變更」（Base UOM、任何 UOM 嘅換算係數、追蹤政策）冇填 `reason`
   * 會被拒絕；本期未有交易／庫存表可以查，所以未去到「已有交易就直接
   * 擋」嗰層（`uomChangeBlocked()`／`trackingPolicyChangeBlocked()`，留返
   * 第一個真引用出現先接上，見 design_spec §8.4）。
   */
  async updateSku({
    actorId,
    claimedRoles,
    claimedPermissions,
    id,
    skuName,
    trackingPolicy,
    shelfLifeDays,
    minReceiptLifeDays,
    minSaleLifeDays,
    purchasable,
    sellable,
    inventoryTracked,
    suggestedPriceAmount,
    effectiveFrom,
    effectiveTo,
    uoms,
    barcodes,
    version,
    reason,
    requestId,
    ip
  }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[current]] = await connection.query("SELECT * FROM item_skus WHERE id = ?", [id]);
      if (!current) {
        throw skuNotFound(id);
      }

      const [currentUomRows] = await connection.query(
        "SELECT id, uom_id, to_base_factor, is_base FROM item_sku_uoms WHERE sku_id = ?",
        [id]
      );
      const currentUomIds = new Set(currentUomRows.map((row) => Number(row.id)));
      for (const row of uoms) {
        if (row.id !== undefined && row.id !== null && !currentUomIds.has(row.id)) {
          throw skuChildMismatch("uom", row.id);
        }
      }

      const [currentBarcodeRows] = await connection.query("SELECT id FROM item_sku_barcodes WHERE sku_id = ?", [
        id
      ]);
      const currentBarcodeIds = new Set(currentBarcodeRows.map((row) => Number(row.id)));
      for (const row of barcodes) {
        if (row.id !== undefined && row.id !== null && !currentBarcodeIds.has(row.id)) {
          throw skuChildMismatch("barcode", row.id);
        }
      }

      this.#assertUomShapeValid(uoms);
      await this.#assertUomsExist(
        connection,
        uoms.map((uom) => uom.uomId)
      );

      const isCritical = this.#isCriticalSkuChange({
        currentTrackingPolicy: current.tracking_policy,
        nextTrackingPolicy: trackingPolicy,
        currentUoms: currentUomRows,
        nextUoms: uoms
      });
      if (isCritical && !String(reason ?? "").trim()) {
        throw criticalChangeReasonRequired();
      }

      const nowMs = this.time.nowMs();
      const normalizedSkuName = String(skuName ?? "").trim();
      const nextPrice = suggestedPriceAmount ?? null;

      const [result] = await connection.execute(
        `UPDATE item_skus
            SET sku_name = ?, tracking_policy = ?, shelf_life_days = ?, min_receipt_life_days = ?,
                min_sale_life_days = ?, purchasable = ?, sellable = ?, inventory_tracked = ?,
                suggested_price_amount = ?, effective_from = ?, effective_to = ?,
                updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ?`,
        [
          normalizedSkuName,
          trackingPolicy,
          shelfLifeDays ?? null,
          minReceiptLifeDays ?? null,
          minSaleLifeDays ?? null,
          purchasable ? 1 : 0,
          sellable ? 1 : 0,
          inventoryTracked ? 1 : 0,
          nextPrice,
          effectiveFrom ?? null,
          effectiveTo ?? null,
          nowMs,
          actorId,
          id,
          version
        ]
      );

      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query("SELECT id FROM item_skus WHERE id = ?", [id]);
        if (!stillExists) {
          throw skuNotFound(id);
        }
        throw versionConflict();
      }

      // 刪晒重插：barcode 先行——佢哋靠 RESTRICT FK 指住 item_sku_uoms，要喺
      // 刪 UOM 之前先冇晒依賴。
      await connection.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [id]);
      await connection.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [id]);

      const uomIdToSkuUomId = new Map();
      for (const uom of uoms) {
        const [uomResult] = await connection.execute(
          `INSERT INTO item_sku_uoms
             (sku_id, uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale,
              version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            id,
            uom.uomId,
            uom.toBaseFactor,
            uom.isBase ? 1 : 0,
            uom.isDefaultPurchase ? 1 : 0,
            uom.isDefaultSale ? 1 : 0,
            nowMs,
            nowMs,
            actorId,
            actorId
          ]
        );
        uomIdToSkuUomId.set(uom.uomId, uomResult.insertId);
      }

      this.#assertBarcodeShapeValid(barcodes, uomIdToSkuUomId);

      for (const barcode of barcodes) {
        const normalized = normalizeBarcode(barcode.barcode, barcode.barcodeType);
        try {
          await connection.execute(
            `INSERT INTO item_sku_barcodes
               (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary,
                version, created_at, updated_at, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            [
              id,
              uomIdToSkuUomId.get(barcode.uomId),
              String(barcode.barcode),
              normalized,
              barcode.barcodeType,
              barcode.isPrimary ? 1 : 0,
              nowMs,
              nowMs,
              actorId,
              actorId
            ]
          );
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw barcodeTaken(barcode.barcode);
          }
          throw error;
        }
      }

      const detail = {};
      if (normalizedSkuName !== current.sku_name) {
        detail.skuName = { before: current.sku_name, after: normalizedSkuName };
      }
      if (trackingPolicy !== current.tracking_policy) {
        detail.trackingPolicy = { before: current.tracking_policy, after: trackingPolicy };
      }
      if (String(current.suggested_price_amount ?? "") !== String(nextPrice ?? "")) {
        detail.suggestedRetailPrice = {
          before:
            current.suggested_price_amount === null
              ? null
              : { amount: String(current.suggested_price_amount), currency: ITEM_PRICE_CURRENCY, taxBasis: ITEM_PRICE_TAX_BASIS },
          after:
            nextPrice === null ? null : { amount: String(nextPrice), currency: ITEM_PRICE_CURRENCY, taxBasis: ITEM_PRICE_TAX_BASIS }
        };
      }
      if (isCritical) {
        detail.criticalUomOrTrackingChange = true;
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "sku.update",
        targetType: "sku",
        targetId: id,
        targetLabel: normalizedSkuName,
        detail: Object.keys(detail).length > 0 ? detail : null,
        reason: reason ?? "",
        requestId,
        ip
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  // --- Item：生命週期 --------------------------------------------------------

  /**
   * draft／inactive → active（同一交易至少啟用一個完整 SKU，Item 先跟住轉
   * active）；已經 active 嘅 Item 都可以再嚟啟用多幾個 SKU（例如之前停咗
   * 嘅一個 SKU 想擺返啟用）——呢種情況 Item 本身冇轉，唔記 item.activate
   * audit（冇轉冇嘢好記），但依然驗證返成呼叫者聲稱嘅 version 啱唔啱，避免
   * 對住舊資料做決定。
   */
  async activateItem({ actorId, claimedRoles, claimedPermissions, id, skuIds, reason, version, requestId, ip }) {
    const itemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[current]] = await connection.query("SELECT * FROM items WHERE id = ?", [id]);
      if (!current) {
        throw itemNotFound(id);
      }
      if (!["draft", "inactive", "active"].includes(current.status)) {
        throw statusTransitionInvalid(current.status, "active");
      }

      const uniqueSkuIds = [...new Set(skuIds ?? [])];
      let skuRows = [];
      if (uniqueSkuIds.length > 0) {
        const placeholders = uniqueSkuIds.map(() => "?").join(",");
        [skuRows] = await connection.query(
          `SELECT * FROM item_skus WHERE id IN (${placeholders}) AND item_id = ?`,
          [...uniqueSkuIds, id]
        );
        const foundIds = new Set(skuRows.map((row) => Number(row.id)));
        for (const skuId of uniqueSkuIds) {
          if (!foundIds.has(skuId)) {
            throw skuNotFound(skuId);
          }
        }
      }

      const toActivate = [];
      for (const sku of skuRows) {
        if (sku.status === "active") {
          continue;
        }
        if (!["draft", "inactive"].includes(sku.status)) {
          throw statusTransitionInvalid(sku.status, "active");
        }
        await this.#assertSkuRowActivatable(connection, sku, {
          productType: current.product_type,
          categoryId: current.category_id
        });
        toActivate.push(sku);
      }

      const itemNeedsActivation = current.status !== "active";
      if (itemNeedsActivation && toActivate.length === 0) {
        throw itemActivationRequiresSku();
      }

      const nowMs = this.time.nowMs();

      if (itemNeedsActivation) {
        const [result] = await connection.execute(
          `UPDATE items SET status = 'active', updated_at = ?, updated_by = ?, version = version + 1
            WHERE id = ? AND version = ? AND status IN ('draft', 'inactive')`,
          [nowMs, actorId, id, version]
        );
        if (result.affectedRows === 0) {
          const [[stillExists]] = await connection.query("SELECT version, status FROM items WHERE id = ?", [id]);
          if (!stillExists) {
            throw itemNotFound(id);
          }
          if (Number(stillExists.version) !== Number(version)) {
            throw versionConflict();
          }
          throw statusTransitionInvalid(stillExists.status, "active");
        }

        await this.auditLog.record(connection, {
          actorUserId: actorId,
          actorUsername: actor.username,
          action: "item.activate",
          targetType: "item",
          targetId: id,
          targetLabel: current.name,
          detail: { status: { before: current.status, after: "active" } },
          reason,
          requestId,
          ip
        });
      } else if (Number(current.version) !== Number(version)) {
        throw versionConflict();
      }

      for (const sku of toActivate) {
        await connection.execute(
          "UPDATE item_skus SET status = 'active', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?",
          [nowMs, actorId, sku.id]
        );
        await this.auditLog.record(connection, {
          actorUserId: actorId,
          actorUsername: actor.username,
          action: "sku.activate",
          targetType: "sku",
          targetId: sku.id,
          targetLabel: sku.sku_code,
          detail: { status: { before: sku.status, after: "active" } },
          reason,
          requestId,
          ip
        });
      }

      return id;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: itemId });
  }

  /** active → inactive；同一交易將全部 Active SKU 轉 Inactive（DEC-024）。 */
  async deactivateItem({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const itemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      await this.#transitionItemStatus(connection, {
        id,
        version,
        fromStatuses: ["active"],
        toStatus: "inactive",
        action: "item.deactivate",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      await this.#cascadeSkuStatus(connection, {
        itemId: id,
        fromStatuses: ["active"],
        toStatus: "inactive",
        forcePurchasableFalse: false,
        action: "sku.deactivate",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      return id;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: itemId });
  }

  /** active／inactive → discontinued；全部可採購 SKU 停止採購（DEC-024）。
   * Draft SKU 保持 Draft（design_spec §4.2：「Draft SKU 保持 Draft 但不可
   * 啟用」），唔喺 cascade 嘅 fromStatuses 之內。 */
  async discontinueItem({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const itemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      await this.#transitionItemStatus(connection, {
        id,
        version,
        fromStatuses: ["active", "inactive"],
        toStatus: "discontinued",
        action: "item.discontinue",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      await this.#cascadeSkuStatus(connection, {
        itemId: id,
        fromStatuses: ["active", "inactive"],
        toStatus: "discontinued",
        forcePurchasableFalse: true,
        action: "sku.discontinue",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      return id;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: itemId });
  }

  /** draft／inactive／discontinued → archived；非 Archived 嘅 SKU 全部同交易
   * 轉 Archived（DEC-024）。引用檢查（庫存／在途／未完成引用）呢期未有
   * 下游表可以查，design_spec §8.4 明確話「現在不為尚不存在的模組建立
   * plugin registry 或空 interface；待第一個真引用出現再抽取」，所以呢度
   * 未做——同 T16 對 `uomChangeBlocked()`／`trackingPolicyChangeBlocked()`
   * 嘅判斷一致。 */
  async archiveItem({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const itemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      await this.#transitionItemStatus(connection, {
        id,
        version,
        fromStatuses: ["draft", "inactive", "discontinued"],
        toStatus: "archived",
        action: "item.archive",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      // 保險網：正常流程去到呢一步唔應該仲有 active 嘅 SKU（Item 由 active
      // 轉呢幾個 fromStatuses 之前一定經過 deactivate／discontinue，兩者都
      // 已經 cascade 走晒 active SKU），但「非 Archived 嘅 SKU 全部轉
      // Archived」係規則本身嘅字面意思，唔靠呢個假設，連 active 都一齊掃。
      await this.#cascadeSkuStatus(connection, {
        itemId: id,
        fromStatuses: ["draft", "active", "inactive", "discontinued"],
        toStatus: "archived",
        forcePurchasableFalse: false,
        action: "sku.archive",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      return id;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: itemId });
  }

  /** archived → inactive；唔自動 restore／activate 任何 SKU，SKU 仍然
   * Archived，要逐一叫 `restoreSku()` 先至攞返（design_spec §4.2）。 */
  async restoreItem({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const itemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      await this.#transitionItemStatus(connection, {
        id,
        version,
        fromStatuses: ["archived"],
        toStatus: "inactive",
        action: "item.restore",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      return id;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: itemId });
  }

  /** 永久刪除 Draft Item 連同它嘅 Draft children（UOM／Barcode／SKU）。只
   * 檢查 Item aggregate 自身：Phase 1 未有庫存／採購／銷售表可以查真正嘅
   * 引用，design_spec §8.4 明確話「現在不為尚不存在的模組建立 plugin
   * registry 或空 interface；待第一個真引用出現再抽取」——同 T16／T18
   * 對 `uomChangeBlocked()`／archive 引用檢查嘅範圍決定一致。「未引用」喺
   * 呢期即係「仲係 draft」：Item 一旦離開 draft 就唔會再返嚟（冇任何
   * transition 會將已啟用過嘅 Item 變返 draft），所以 draft Item 底下嘅
   * SKU 一定全部都仲係 draft，唔使逐個 SKU 再檢查一次狀態。 */
  async deleteItem({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[current]] = await connection.query("SELECT name, status FROM items WHERE id = ?", [id]);
      if (!current) {
        throw itemNotFound(id);
      }
      if (current.status !== "draft") {
        throw itemDeleteRequiresDraft(current.status);
      }

      const [skuRows] = await connection.query("SELECT id FROM item_skus WHERE item_id = ?", [id]);
      const skuIds = skuRows.map((row) => row.id);
      if (skuIds.length > 0) {
        const placeholders = skuIds.map(() => "?").join(",");
        await connection.execute(`DELETE FROM item_sku_barcodes WHERE sku_id IN (${placeholders})`, skuIds);
        await connection.execute(`DELETE FROM item_sku_uoms WHERE sku_id IN (${placeholders})`, skuIds);
        await connection.execute(`DELETE FROM item_skus WHERE id IN (${placeholders})`, skuIds);
      }

      const [result] = await connection.execute("DELETE FROM items WHERE id = ? AND version = ?", [id, version]);
      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query("SELECT version FROM items WHERE id = ?", [id]);
        if (!stillExists) {
          throw itemNotFound(id);
        }
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "item.delete",
        targetType: "item",
        targetId: id,
        targetLabel: current.name,
        detail: { deletedSkuCount: skuIds.length },
        reason,
        requestId,
        ip
      });
    });
  }

  /** 複製成一個新嘅 Draft Item；唔複製 Barcode，每個來源 SKU 都要呼叫端
   * 提供一個新嘅 SKU Code（design_spec §6.2）。`skus` 要求同來源 Item 現存
   * 嘅 SKU 一一對應（同一數量，`sourceSkuId` 覆蓋齊全冇重複）——呢個限制
   * 反映而家嘅實際狀態：唔存在「淨係複製部分 SKU」呢個需求，亦都冇「複製
   * 之後底下多咗／少咗未講嘅 SKU」呢種曖昧情況。 */
  async copyItem({ actorId, claimedRoles, claimedPermissions, id, skus, requestId, ip }) {
    const newItemId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      const [[source]] = await connection.query("SELECT * FROM items WHERE id = ?", [id]);
      if (!source) {
        throw itemNotFound(id);
      }

      const [sourceSkuRows] = await connection.query("SELECT * FROM item_skus WHERE item_id = ?", [id]);
      const sourceSkuById = new Map(sourceSkuRows.map((row) => [row.id, row]));

      if (skus.length !== sourceSkuRows.length) {
        throw skuChildMismatch("sku", skus[0]?.sourceSkuId ?? null);
      }
      const seenSourceSkuIds = new Set();
      for (const entry of skus) {
        if (!sourceSkuById.has(entry.sourceSkuId) || seenSourceSkuIds.has(entry.sourceSkuId)) {
          throw skuChildMismatch("sku", entry.sourceSkuId);
        }
        seenSourceSkuIds.add(entry.sourceSkuId);
      }

      const [itemResult] = await connection.execute(
        `INSERT INTO items
           (name, short_name, description, category_id, brand_id, product_type, country_of_origin,
            manufacturer, default_tracking_policy, default_shelf_life_days, status, version,
            created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
        [
          source.name,
          source.short_name,
          source.description,
          source.category_id,
          source.brand_id,
          source.product_type,
          source.country_of_origin,
          source.manufacturer,
          source.default_tracking_policy,
          source.default_shelf_life_days,
          nowMs,
          nowMs,
          actorId,
          actorId
        ]
      );
      const newItemId = itemResult.insertId;
      const copiedSkus = [];

      for (const entry of skus) {
        const sourceSku = sourceSkuById.get(entry.sourceSkuId);
        const [uomRows] = await connection.query(
          "SELECT uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale FROM item_sku_uoms WHERE sku_id = ?",
          [sourceSku.id]
        );

        const created = await this.#createSkuRow(connection, {
          itemId: newItemId,
          sku: {
            skuCode: entry.skuCode,
            skuName: sourceSku.sku_name,
            trackingPolicy: sourceSku.tracking_policy,
            shelfLifeDays: sourceSku.shelf_life_days,
            minReceiptLifeDays: sourceSku.min_receipt_life_days,
            minSaleLifeDays: sourceSku.min_sale_life_days,
            purchasable: Boolean(sourceSku.purchasable),
            sellable: Boolean(sourceSku.sellable),
            inventoryTracked: Boolean(sourceSku.inventory_tracked),
            suggestedPriceAmount: sourceSku.suggested_price_amount,
            effectiveFrom: sourceSku.effective_from,
            effectiveTo: sourceSku.effective_to,
            uoms: uomRows.map((row) => ({
              uomId: row.uom_id,
              toBaseFactor: row.to_base_factor,
              isBase: Boolean(row.is_base),
              isDefaultPurchase: Boolean(row.is_default_purchase),
              isDefaultSale: Boolean(row.is_default_sale)
            })),
            barcodes: []
          },
          defaultTrackingPolicy: source.default_tracking_policy,
          nowMs,
          actorId
        });

        copiedSkus.push({ sourceSkuId: sourceSku.id, newSkuId: created.id, newSkuCode: created.code });
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "item.copy",
        targetType: "item",
        targetId: newItemId,
        targetLabel: source.name,
        detail: { copiedFromItemId: id, skus: copiedSkus },
        requestId,
        ip
      });

      return newItemId;
    });

    return this.getItem({ actorId, claimedRoles, claimedPermissions, id: newItemId });
  }

  // --- SKU：生命週期 ---------------------------------------------------------

  /** draft／inactive → active；父 Item 必須已經係 active（唔喺呢度 cascade
   * 起 Item，起 Item 嗰下係 `activateItem()` 嘅事）。 */
  async activateSku({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[sku]] = await connection.query(
        `SELECT s.*, i.status AS item_status, i.product_type AS item_product_type,
                i.category_id AS item_category_id
           FROM item_skus s JOIN items i ON i.id = s.item_id WHERE s.id = ?`,
        [id]
      );
      if (!sku) {
        throw skuNotFound(id);
      }
      if (sku.item_status !== "active") {
        throw statusTransitionInvalid(sku.status, "active");
      }
      if (!["draft", "inactive"].includes(sku.status)) {
        throw statusTransitionInvalid(sku.status, "active");
      }

      await this.#assertSkuRowActivatable(connection, sku, {
        productType: sku.item_product_type,
        categoryId: sku.item_category_id
      });

      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `UPDATE item_skus SET status = 'active', updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status IN ('draft', 'inactive')`,
        [nowMs, actorId, id, version]
      );
      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query("SELECT version, status FROM item_skus WHERE id = ?", [id]);
        if (!stillExists) {
          throw skuNotFound(id);
        }
        if (Number(stillExists.version) !== Number(version)) {
          throw versionConflict();
        }
        throw statusTransitionInvalid(stillExists.status, "active");
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "sku.activate",
        targetType: "sku",
        targetId: id,
        targetLabel: sku.sku_code,
        detail: { status: { before: sku.status, after: "active" } },
        reason,
        requestId,
        ip
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  /** active → inactive；唔可以停用父 Item（本身仍然 active 嗰陣）最後一個
   * Active SKU（design_spec §4.2）。 */
  async deactivateSku({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[sku]] = await connection.query(
        `SELECT s.*, i.status AS item_status FROM item_skus s JOIN items i ON i.id = s.item_id WHERE s.id = ?`,
        [id]
      );
      if (!sku) {
        throw skuNotFound(id);
      }

      // 「呢粒仲係唔係最後一個 Active SKU」呢個檢查一定要同轉 inactive嗰句
      // UPDATE 綁埋一齊做，唔可以分開做兩句：分開做嘅話，兩個並行請求各自
      // 停用同一個 Item 底下唔同嘅 SKU，各自嘅交易喺呢句 SELECT COUNT 嗰陣
      // 都會見到「仲有第二粒 Active」（見返對方未 commit 之前嗰個舊值），
      // 兩個都通過檢查，結果個 Item 剩返零個 Active SKU——同
      // UserAdminService.disable() 防「停用最後一個 active admin」嗰個
      // race 一模一樣，呢度用返同一招：將「仲有冇第二粒」做成 UPDATE 嘅
      // WHERE 子句本身嘅一部分，等 InnoDB 用真正嘅列鎖去序列化呢兩個交易，
      // 第二個交易嘅 WHERE 判斷先會見到第一個交易已經 commit 咗嘅最新資料。
      const requiresLastActiveGuard = sku.item_status === "active" && sku.status === "active";
      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `UPDATE item_skus SET status = 'inactive', updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ? AND version = ? AND status = 'active'
          ${
            requiresLastActiveGuard
              ? `AND EXISTS (
                   SELECT 1 FROM (
                     SELECT s2.id FROM item_skus s2 WHERE s2.item_id = ? AND s2.status = 'active' AND s2.id != ?
                   ) AS other_active_skus
                 )`
              : ""
          }`,
        requiresLastActiveGuard
          ? [nowMs, actorId, id, version, sku.item_id, id]
          : [nowMs, actorId, id, version]
      );
      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query("SELECT version, status FROM item_skus WHERE id = ?", [id]);
        if (!stillExists) {
          throw skuNotFound(id);
        }
        if (Number(stillExists.version) !== Number(version)) {
          throw versionConflict();
        }
        if (stillExists.status !== "active") {
          throw statusTransitionInvalid(stillExists.status, "inactive");
        }
        // Version 啱、狀態仲係 active，但 UPDATE 一列都冇改到：唯一嘅可能就
        // 係 requiresLastActiveGuard 嘅 EXISTS 判斷唔通過。
        throw lastActiveSku();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "sku.deactivate",
        targetType: "sku",
        targetId: id,
        targetLabel: sku.sku_code,
        detail: { status: { before: sku.status, after: "inactive" } },
        reason,
        requestId,
        ip
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  /** active／inactive → discontinued；強制 purchasable=false，sellable 保留
   * 現狀等清貨（design_spec §4.2）。 */
  async discontinueSku({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      await this.#transitionSkuStatus(connection, {
        id,
        version,
        fromStatuses: ["active", "inactive"],
        toStatus: "discontinued",
        forcePurchasableFalse: true,
        action: "sku.discontinue",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  /** draft／inactive／discontinued → archived。引用檢查未做，理由同
   * `archiveItem()`。 */
  async archiveSku({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      await this.#transitionSkuStatus(connection, {
        id,
        version,
        fromStatuses: ["draft", "inactive", "discontinued"],
        toStatus: "archived",
        forcePurchasableFalse: false,
        action: "sku.archive",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  /** archived → inactive。 */
  async restoreSku({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      await this.#transitionSkuStatus(connection, {
        id,
        version,
        fromStatuses: ["archived"],
        toStatus: "inactive",
        forcePurchasableFalse: false,
        action: "sku.restore",
        actorId,
        actor,
        reason,
        requestId,
        ip,
        nowMs
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  /** 永久刪除 Draft SKU；「未引用」嘅範圍決定同 `deleteItem()` 一致（Phase 1
   * 冇下游表）。「不令 Item 零 SKU」係呢個方法獨有嘅額外檢查：Item 本身唔一
   * 定要係 draft（Item 可以係 active，底下有一粒 draft 嘅 SKU），純粹淨係
   * 睇緊呢粒 SKU 自己嘅狀態，同埋刪咗之後 Item 底下係咪仲有第二粒。 */
  async deleteSku({ actorId, claimedRoles, claimedPermissions, id, reason, version, requestId, ip }) {
    await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[current]] = await connection.query(
        "SELECT item_id, sku_code, status FROM item_skus WHERE id = ?",
        [id]
      );
      if (!current) {
        throw skuNotFound(id);
      }
      if (current.status !== "draft") {
        throw skuDeleteRequiresDraft(current.status);
      }

      const [[{ otherSkuCount }]] = await connection.query(
        "SELECT COUNT(*) AS otherSkuCount FROM item_skus WHERE item_id = ? AND id != ?",
        [current.item_id, id]
      );
      if (Number(otherSkuCount) === 0) {
        throw lastSkuInItem();
      }

      await connection.execute("DELETE FROM item_sku_barcodes WHERE sku_id = ?", [id]);
      await connection.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [id]);

      const [result] = await connection.execute("DELETE FROM item_skus WHERE id = ? AND version = ?", [id, version]);
      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query("SELECT version FROM item_skus WHERE id = ?", [id]);
        if (!stillExists) {
          throw skuNotFound(id);
        }
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "sku.delete",
        targetType: "sku",
        targetId: id,
        targetLabel: current.sku_code,
        reason,
        requestId,
        ip
      });
    });
  }

  /** SKU Code 特批修改：全域唯一（不分大小寫，同建立時共用一個 unique
   * index），reason 必填，`jwt-device-password` 由 handler 嘅 `authType`
   * 保證（見 skuHighRiskHandlers.js）。 */
  async changeSkuCode({ actorId, claimedRoles, claimedPermissions, id, skuCode, reason, version, requestId, ip }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();

      const [[current]] = await connection.query("SELECT sku_code, version FROM item_skus WHERE id = ?", [id]);
      if (!current) {
        throw skuNotFound(id);
      }

      const newCode = String(skuCode).trim();
      let result;
      try {
        [result] = await connection.execute(
          `UPDATE item_skus SET sku_code = ?, updated_at = ?, updated_by = ?, version = version + 1
            WHERE id = ? AND version = ?`,
          [newCode, nowMs, actorId, id, version]
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw skuCodeTaken(newCode);
        }
        throw error;
      }

      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query("SELECT version FROM item_skus WHERE id = ?", [id]);
        if (!stillExists) {
          throw skuNotFound(id);
        }
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "sku.code.change",
        targetType: "sku",
        targetId: id,
        targetLabel: newCode,
        detail: { skuCode: { before: current.sku_code, after: newCode } },
        reason,
        requestId,
        ip
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  /** 移除並釋放一個條碼；`jwt-device-password` 由 handler 嘅 `authType`
   * 保證。條碼有自己嘅 `version`（同一招每個獨立資源各自 optimistic
   * lock），唔係借 SKU 個 version。 */
  async releaseBarcode({ actorId, claimedRoles, claimedPermissions, id, barcodeId, reason, version, requestId, ip }) {
    const skuId = await this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });

      const [[sku]] = await connection.query("SELECT sku_code FROM item_skus WHERE id = ?", [id]);
      if (!sku) {
        throw skuNotFound(id);
      }

      const [[barcode]] = await connection.query(
        "SELECT barcode, normalized_barcode FROM item_sku_barcodes WHERE id = ? AND sku_id = ?",
        [barcodeId, id]
      );
      if (!barcode) {
        throw barcodeNotFound(barcodeId);
      }

      const [result] = await connection.execute(
        "DELETE FROM item_sku_barcodes WHERE id = ? AND version = ?",
        [barcodeId, version]
      );
      if (result.affectedRows === 0) {
        const [[stillExists]] = await connection.query(
          "SELECT version FROM item_sku_barcodes WHERE id = ?",
          [barcodeId]
        );
        if (!stillExists) {
          throw barcodeNotFound(barcodeId);
        }
        throw versionConflict();
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "barcode.release",
        targetType: "sku",
        targetId: id,
        targetLabel: sku.sku_code,
        detail: { barcodeId, barcode: barcode.barcode, normalizedBarcode: barcode.normalized_barcode },
        reason,
        requestId,
        ip
      });

      return id;
    });

    return this.getSku({ actorId, claimedRoles, claimedPermissions, id: skuId });
  }

  // --- 生命週期：共用私有 helper ----------------------------------------------

  /** Item 狀態轉換嘅共用邏輯：compare-and-set（version＋合法 fromStatuses
   * 一齊喺 UPDATE 嘅 WHERE 度做），失敗時分清係版本問題定係狀態唔啱，成功
   * 就寫一筆 audit。跟 ItemCatalogService.#transitionCategoryStatus() 同一
   * 個技巧。 */
  async #transitionItemStatus(
    connection,
    { id, version, fromStatuses, toStatus, action, actorId, actor, reason, requestId, ip, nowMs }
  ) {
    const [[current]] = await connection.query("SELECT name, status FROM items WHERE id = ?", [id]);
    if (!current) {
      throw itemNotFound(id);
    }

    const placeholders = fromStatuses.map(() => "?").join(",");
    const [result] = await connection.execute(
      `UPDATE items SET status = ?, updated_at = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND version = ? AND status IN (${placeholders})`,
      [toStatus, nowMs, actorId, id, version, ...fromStatuses]
    );

    if (result.affectedRows === 0) {
      const [[stillExists]] = await connection.query("SELECT version, status FROM items WHERE id = ?", [id]);
      if (!stillExists) {
        throw itemNotFound(id);
      }
      if (Number(stillExists.version) !== Number(version)) {
        throw versionConflict();
      }
      throw statusTransitionInvalid(stillExists.status, toStatus);
    }

    await this.auditLog.record(connection, {
      actorUserId: actorId,
      actorUsername: actor.username,
      action,
      targetType: "item",
      targetId: id,
      targetLabel: current.name,
      detail: { status: { before: current.status, after: toStatus } },
      reason,
      requestId,
      ip
    });
  }

  /** SKU 狀態轉換嘅共用邏輯，單一實體、唔牽涉 cascade——同
   * `#transitionItemStatus()` 同一個技巧，`forcePurchasableFalse` 俾
   * discontinue 用。 */
  async #transitionSkuStatus(
    connection,
    { id, version, fromStatuses, toStatus, forcePurchasableFalse, action, actorId, actor, reason, requestId, ip, nowMs }
  ) {
    const [[current]] = await connection.query("SELECT sku_code, status FROM item_skus WHERE id = ?", [id]);
    if (!current) {
      throw skuNotFound(id);
    }

    const placeholders = fromStatuses.map(() => "?").join(",");
    const [result] = await connection.execute(
      `UPDATE item_skus
          SET status = ?, ${forcePurchasableFalse ? "purchasable = 0, " : ""}updated_at = ?, updated_by = ?,
              version = version + 1
        WHERE id = ? AND version = ? AND status IN (${placeholders})`,
      [toStatus, nowMs, actorId, id, version, ...fromStatuses]
    );

    if (result.affectedRows === 0) {
      const [[stillExists]] = await connection.query("SELECT version, status FROM item_skus WHERE id = ?", [id]);
      if (!stillExists) {
        throw skuNotFound(id);
      }
      if (Number(stillExists.version) !== Number(version)) {
        throw versionConflict();
      }
      throw statusTransitionInvalid(stillExists.status, toStatus);
    }

    await this.auditLog.record(connection, {
      actorUserId: actorId,
      actorUsername: actor.username,
      action,
      targetType: "sku",
      targetId: id,
      targetLabel: current.sku_code,
      detail: { status: { before: current.status, after: toStatus } },
      reason,
      requestId,
      ip
    });
  }

  /** Item 狀態轉換 cascade 落去佢啲 SKU：查返合資格嘅 SKU（連同 fromStatuses
   * 篩選），逐個 UPDATE＋寫一筆 audit——每粒 SKU 獨立一筆，等 audit 睇到
   * 邊幾粒 SKU 實際上受影響，唔係淨係話「個 Item 轉咗」。 */
  async #cascadeSkuStatus(
    connection,
    { itemId, fromStatuses, toStatus, forcePurchasableFalse, action, actorId, actor, reason, requestId, ip, nowMs }
  ) {
    const placeholders = fromStatuses.map(() => "?").join(",");
    const [rows] = await connection.query(
      `SELECT id, sku_code, status FROM item_skus WHERE item_id = ? AND status IN (${placeholders})`,
      [itemId, ...fromStatuses]
    );

    for (const row of rows) {
      await connection.execute(
        `UPDATE item_skus
            SET status = ?, ${forcePurchasableFalse ? "purchasable = 0, " : ""}updated_at = ?, updated_by = ?,
                version = version + 1
          WHERE id = ?`,
        [toStatus, nowMs, actorId, row.id]
      );

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action,
        targetType: "sku",
        targetId: row.id,
        targetLabel: row.sku_code,
        detail: { status: { before: row.status, after: toStatus }, cascadedFromItem: true },
        reason,
        requestId,
        ip
      });
    }
  }

  /** `assertSkuActivatable()` 要嘅資料由呢度查齊（UOM／Barcode 集合、
   * Category 是否 active leaf），俾 `activateItem()`／`activateSku()` 共用，
   * 唔通過就拋錯，冇返回值。 */
  async #assertSkuRowActivatable(connection, skuRow, { productType, categoryId }) {
    const [uomRows] = await connection.query(
      "SELECT uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale FROM item_sku_uoms WHERE sku_id = ?",
      [skuRow.id]
    );
    const [barcodeRows] = await connection.query(
      "SELECT normalized_barcode FROM item_sku_barcodes WHERE sku_id = ?",
      [skuRow.id]
    );
    const hasActiveLeafCategory =
      categoryId !== null && categoryId !== undefined ? await this.#isActiveLeafCategory(connection, categoryId) : false;

    assertSkuActivatable({
      item: { productType, hasActiveLeafCategory },
      sku: {
        code: skuRow.sku_code,
        name: skuRow.sku_name,
        variantSignature: skuRow.variant_signature,
        uoms: uomRows.map((row) => ({
          isBase: Boolean(row.is_base),
          isDefaultPurchase: Boolean(row.is_default_purchase),
          isDefaultSale: Boolean(row.is_default_sale),
          toBaseFactor: row.to_base_factor
        })),
        trackingPolicy: skuRow.tracking_policy,
        shelfLifeDays: skuRow.shelf_life_days,
        minReceiptLifeDays: skuRow.min_receipt_life_days,
        minSaleLifeDays: skuRow.min_sale_life_days,
        sellable: Boolean(skuRow.sellable),
        suggestedPriceAmount: skuRow.suggested_price_amount,
        effectiveFrom: skuRow.effective_from,
        effectiveTo: skuRow.effective_to,
        barcodes: barcodeRows.map((row) => ({ normalizedBarcode: row.normalized_barcode }))
      }
    });
  }

  /** Base UOM、任一 UOM 嘅換算係數，或者追蹤政策改咗，就係關鍵變更——呢
   * 三樣係「呢個 SKU 點樣換算、點樣追蹤」嘅根本設定，跟 design_spec 對
   * 呢個 task 嘅 acceptance criteria 一致。 */
  #isCriticalSkuChange({ currentTrackingPolicy, nextTrackingPolicy, currentUoms, nextUoms }) {
    if (currentTrackingPolicy !== nextTrackingPolicy) {
      return true;
    }

    const normalizeCurrent = (rows) =>
      rows.map((row) => `${row.uom_id}:${row.to_base_factor}:${row.is_base ? 1 : 0}`).sort();
    const normalizeNext = (rows) =>
      rows.map((row) => `${row.uomId}:${row.toBaseFactor}:${row.isBase ? 1 : 0}`).sort();

    const currentSet = normalizeCurrent(currentUoms);
    const nextSet = normalizeNext(nextUoms);

    if (currentSet.length !== nextSet.length) {
      return true;
    }

    return currentSet.some((value, index) => value !== nextSet[index]);
  }

  async #assertCategoryExists(connection, categoryId) {
    const [rows] = await connection.query("SELECT id FROM item_categories WHERE id = ?", [categoryId]);
    if (rows.length === 0) {
      throw categoryNotFound(categoryId);
    }
  }

  async #assertBrandExists(connection, brandId) {
    const [rows] = await connection.query("SELECT id FROM item_brands WHERE id = ?", [brandId]);
    if (rows.length === 0) {
      throw brandNotFound(brandId);
    }
  }

  /** Active leaf category：本身 active，並且冇任何子分類（唔理子分類自己嘅狀態）。 */
  async #isActiveLeafCategory(connection, categoryId) {
    const [[category]] = await connection.query("SELECT status FROM item_categories WHERE id = ?", [
      categoryId
    ]);
    if (!category || category.status !== "active") {
      return false;
    }
    const [[{ childCount }]] = await connection.query(
      "SELECT COUNT(*) AS childCount FROM item_categories WHERE parent_id = ?",
      [categoryId]
    );
    return Number(childCount) === 0;
  }

  /** Standard：`variantValues` 一定要空，回 `{ signature: null, variantValues: [] }`。
   * Variant：查表驗證每個 `{attributeId, optionId}` 真係存在、屬性真係
   * `is_variant`＋`single_option`、option 真係屬於嗰個屬性，然後計出
   * signature——只有呢度負責查表；`computeVariantSignature()`／
   * `typedValueToCanonicalString()` 本身係純函式，唔識查資料庫（見
   * variantSignature.js 檔頭註解）。連 `variantValues` 本身（已經驗證過）
   * 一齊回埋，等 `#createSkuRow()` 可以寫返 `item_sku_attribute_values`——
   * signature 淨係用嚟做唯一性判斷，唔代替實際 attribute value rows
   * （design_spec §4.4）。 */
  async #resolveVariantSignature(connection, { productType, variantValues }) {
    if (productType === "standard") {
      if (variantValues.length > 0) {
        throw standardSkuHasVariantValues();
      }
      return { signature: null, variantValues: [] };
    }

    if (variantValues.length === 0) {
      throw variantValuesRequired();
    }

    const entries = [];
    for (const { attributeId, optionId } of variantValues) {
      const [[attribute]] = await connection.query(
        "SELECT id, data_type, is_variant FROM item_attribute_definitions WHERE id = ?",
        [attributeId]
      );
      if (!attribute) {
        throw attributeNotFound(attributeId);
      }
      if (!attribute.is_variant) {
        throw attributeValueInvalid(`屬性 ${attributeId} 唔係 Variant 屬性`);
      }
      if (attribute.data_type !== "single_option") {
        throw attributeValueInvalid(`屬性 ${attributeId} 唔係單選型別，暫時唔支援用嚟做規格`);
      }

      const [[option]] = await connection.query(
        "SELECT id, attribute_id FROM item_attribute_options WHERE id = ?",
        [optionId]
      );
      if (!option) {
        throw attributeOptionNotFound(optionId);
      }
      if (Number(option.attribute_id) !== Number(attributeId)) {
        throw attributeValueInvalid(`選項 ${optionId} 唔屬於屬性 ${attributeId}`);
      }

      entries.push({ attributeId, typedValue: typedValueToCanonicalString("single_option", optionId) });
    }

    let signature;
    try {
      signature = computeVariantSignature(entries);
    } catch (error) {
      if (error instanceof TypeError) {
        throw attributeValueInvalid(error.message);
      }
      throw error;
    }

    return { signature, variantValues };
  }

  async #assertUomsExist(connection, uomIds) {
    const uniqueIds = [...new Set(uomIds)];
    if (uniqueIds.length === 0) {
      return;
    }
    const [rows] = await connection.query(
      `SELECT id FROM item_uoms WHERE id IN (${uniqueIds.map(() => "?").join(",")})`,
      uniqueIds
    );
    const foundIds = new Set(rows.map((row) => Number(row.id)));
    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        throw uomNotFound(id);
      }
    }
  }

  /** 結構性檢查，唔管 activate 定 draft 都要成立：重複單位、多過一個
   * base／預設採購／預設銷售，係輸入本身格式錯，唔係「未完整」。 */
  #assertUomShapeValid(uoms) {
    const seenUomIds = new Set();
    let baseCount = 0;
    let purchaseCount = 0;
    let saleCount = 0;

    for (const uom of uoms) {
      if (seenUomIds.has(uom.uomId)) {
        throw uomConversionInvalid("同一個 SKU 不可以重複加同一個單位");
      }
      seenUomIds.add(uom.uomId);
      if (uom.isBase) baseCount += 1;
      if (uom.isDefaultPurchase) purchaseCount += 1;
      if (uom.isDefaultSale) saleCount += 1;
    }

    if (baseCount > 1) {
      throw uomConversionInvalid("Base 單位最多只可以有一個");
    }
    if (purchaseCount > 1) {
      throw uomConversionInvalid("預設採購單位最多只可以有一個");
    }
    if (saleCount > 1) {
      throw uomConversionInvalid("預設銷售單位最多只可以有一個");
    }
  }

  /** `barcode.uomId` 必須是同一個 SKU 提交嘅其中一個 UOM（用嚟解出
   * sku_uom_id）；同一個包裝單位最多一個 primary。 */
  #assertBarcodeShapeValid(barcodes, uomIdToSkuUomId) {
    const primaryUomIds = new Set();
    for (const barcode of barcodes) {
      if (!uomIdToSkuUomId.has(barcode.uomId)) {
        throw skuChildMismatch("uom", barcode.uomId);
      }
      if (barcode.isPrimary) {
        if (primaryUomIds.has(barcode.uomId)) {
          throw barcodePrimaryDuplicated();
        }
        primaryUomIds.add(barcode.uomId);
      }
    }
  }

  /**
   * 插入一粒 SKU 連同佢嘅 UOM／Barcode 集合，回傳 assertSkuActivatable() 同
   * audit 都用得到嘅正規化後資料。SKU Code／Barcode 呢兩個 unique key 先
   * catch ER_DUP_ENTRY：sku_id 係呢個交易先建立，UOM／Barcode 嗰幾個
   * generated-column unique key（base_slot 等）唔可能同其他交易race，靠
   * `#assertUomShapeValid()` 喺插入之前擋（見嗰個方法嘅註解）。
   */
  async #createSkuRow(
    connection,
    { itemId, sku, defaultTrackingPolicy, nowMs, actorId, variantSignature = null, variantValues = [] }
  ) {
    const skuCode = String(sku.skuCode ?? "").trim();
    const skuName = String(sku.skuName ?? "").trim();
    const trackingPolicy = sku.trackingPolicy ?? defaultTrackingPolicy;
    const purchasable = sku.purchasable ?? true;
    const sellable = sku.sellable ?? true;
    const inventoryTracked = sku.inventoryTracked ?? true;

    const uomsInput = sku.uoms ?? [];
    this.#assertUomShapeValid(uomsInput);
    await this.#assertUomsExist(
      connection,
      uomsInput.map((uom) => uom.uomId)
    );

    let skuId;
    try {
      const [result] = await connection.execute(
        `INSERT INTO item_skus
           (item_id, sku_code, sku_name, variant_signature, tracking_policy, shelf_life_days,
            min_receipt_life_days, min_sale_life_days, purchasable, sellable, inventory_tracked,
            suggested_price_amount, effective_from, effective_to, status, version,
            created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
        [
          itemId,
          skuCode,
          skuName,
          variantSignature,
          trackingPolicy,
          sku.shelfLifeDays ?? null,
          sku.minReceiptLifeDays ?? null,
          sku.minSaleLifeDays ?? null,
          purchasable ? 1 : 0,
          sellable ? 1 : 0,
          inventoryTracked ? 1 : 0,
          sku.suggestedPriceAmount ?? null,
          sku.effectiveFrom ?? null,
          sku.effectiveTo ?? null,
          nowMs,
          nowMs,
          actorId,
          actorId
        ]
      );
      skuId = result.insertId;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        // 兩條 unique key 都可能撞：sku_code 全域唯一，同 (item_id,
        // variant_signature) 擋同一個 Item 內重複規格組合——用錯誤訊息入面
        // 嘅 key name 分清邊一條，唔可以一律當做 SKU_CODE_TAKEN。真正嘅
        // mysql2 error 收埋喺 `.cause`（`MySqlDatabaseExecutor` 包裝過），
        // 唔係呢層本身——同 `isDuplicateEntry()` 揾 `.code` 果種
        // `error?.cause?.code || error?.code` 撈法一致。
        const sqlMessage = error?.cause?.sqlMessage ?? error?.sqlMessage ?? "";
        if (String(sqlMessage).includes("uq_item_skus_item_variant")) {
          throw variantCombinationTaken();
        }
        throw skuCodeTaken(skuCode);
      }
      throw error;
    }

    // Variant signature 淨係用嚟做唯一性判斷；可讀嘅規格組合本身要由呢啲
    // typed value rows 組出嚟（design_spec §4.4：「這個 hash 只用於唯一性，
    // 不代替實際 attribute rows」）。`#resolveVariantSignature()` 已經查表
    // 驗證過每一項，呢度直接寫，唔使再驗一次。
    for (const { attributeId, optionId } of variantValues) {
      await connection.execute(
        `INSERT INTO item_sku_attribute_values (sku_id, attribute_id, option_id, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?)`,
        [skuId, attributeId, optionId, nowMs, actorId]
      );
    }

    const uomIdToSkuUomId = new Map();
    for (const uom of uomsInput) {
      const [result] = await connection.execute(
        `INSERT INTO item_sku_uoms
           (sku_id, uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale,
            version, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          skuId,
          uom.uomId,
          uom.toBaseFactor,
          uom.isBase ? 1 : 0,
          uom.isDefaultPurchase ? 1 : 0,
          uom.isDefaultSale ? 1 : 0,
          nowMs,
          nowMs,
          actorId,
          actorId
        ]
      );
      uomIdToSkuUomId.set(uom.uomId, result.insertId);
    }

    const barcodesInput = sku.barcodes ?? [];
    this.#assertBarcodeShapeValid(barcodesInput, uomIdToSkuUomId);

    const normalizedBarcodes = [];
    for (const barcode of barcodesInput) {
      const normalized = normalizeBarcode(barcode.barcode, barcode.barcodeType);
      try {
        await connection.execute(
          `INSERT INTO item_sku_barcodes
             (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary,
              version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            skuId,
            uomIdToSkuUomId.get(barcode.uomId),
            String(barcode.barcode),
            normalized,
            barcode.barcodeType,
            barcode.isPrimary ? 1 : 0,
            nowMs,
            nowMs,
            actorId,
            actorId
          ]
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw barcodeTaken(barcode.barcode);
        }
        throw error;
      }
      normalizedBarcodes.push(normalized);
    }

    return {
      id: skuId,
      code: skuCode,
      name: skuName,
      trackingPolicy,
      shelfLifeDays: sku.shelfLifeDays ?? null,
      minReceiptLifeDays: sku.minReceiptLifeDays ?? null,
      minSaleLifeDays: sku.minSaleLifeDays ?? null,
      sellable,
      suggestedPriceAmount: sku.suggestedPriceAmount ?? null,
      effectiveFrom: sku.effectiveFrom ?? null,
      effectiveTo: sku.effectiveTo ?? null,
      uoms: uomsInput.map((uom) => ({
        isBase: Boolean(uom.isBase),
        isDefaultPurchase: Boolean(uom.isDefaultPurchase),
        isDefaultSale: Boolean(uom.isDefaultSale),
        toBaseFactor: uom.toBaseFactor
      })),
      normalizedBarcodes
    };
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
    includeArchived = false,
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
    } else if (!includeArchived) {
      // 冇指定明確 status 先套呢條預設：明確要求 status=archived 就一定要
      // 睇得到，唔可以俾呢個預設值擋住——同 UOM／Category 嗰個 includeArchived
      // 慣例一致（FR-DELETE-005：封存資料預設不在日常列表顯示）。
      conditions.push("i.status != 'archived'");
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

    // Item 層級共用 media：sku_id 為 NULL。SKU 專屬 media 喺 getSku() 另外查，
    // 唔喺呢度一併攞——理由同 uoms／barcodes 分開喺 SKU detail 一樣，Item
    // detail 只負責它自己 aggregate 範圍內嘅資料。
    const [mediaRows] = await this.database.query(
      `SELECT id, item_id, sku_id, media_kind, original_name, mime_type, byte_size,
              is_primary, sort_order, created_at
         FROM item_media
        WHERE item_id = ? AND sku_id IS NULL
        ORDER BY sort_order, id`,
      [id]
    );

    return this.#toItemDetail(row, skuRows, mediaRows);
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
    includeArchived = false,
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
    } else if (!includeArchived) {
      // 同 listItems()：冇指定明確 status 先套呢條預設，明確要求 archived
      // 唔會被呢個預設值擋住。
      conditions.push("s.status != 'archived'");
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
      `SELECT id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, version
         FROM item_sku_barcodes
        WHERE sku_id = ?
        ORDER BY is_primary DESC, id`,
      [id]
    );

    // SKU 專屬 media；Item 層級共用 media（sku_id NULL）喺 getItem() 出現，
    // 唔喺呢度重複。
    const [mediaRows] = await this.database.query(
      `SELECT id, item_id, sku_id, media_kind, original_name, mime_type, byte_size,
              is_primary, sort_order, created_at
         FROM item_media
        WHERE sku_id = ?
        ORDER BY sort_order, id`,
      [id]
    );

    return this.#toSkuDetail(row, uomRows, barcodeRows, mediaRows);
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

  #toItemDetail(row, skuRows, mediaRows) {
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
      media: mediaRows.map((media) => this.#toMediaSummary(media)),
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

  #toSkuDetail(row, uomRows, barcodeRows, mediaRows) {
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
        isPrimary: Boolean(barcode.is_primary),
        version: Number(barcode.version)
      })),
      media: mediaRows.map((media) => this.#toMediaSummary(media)),
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  /** `item_media` 一列的白名單映射，Item／SKU detail 共用——形狀同
   * `ItemMediaService#toSummary()` 一致（兩者故意各自維護一份：Media 寫入路徑
   * 同 Item／SKU 讀取路徑係兩個獨立 service，理由同呢個檔案其他 helper 一樣，
   * 唔為咗共用三四行映射邏輯而扯埋一條跨 service 依賴）。 */
  #toMediaSummary(row) {
    return {
      id: Number(row.id),
      itemId: Number(row.item_id),
      skuId: row.sku_id === null || row.sku_id === undefined ? null : Number(row.sku_id),
      mediaKind: row.media_kind,
      originalName: row.original_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      isPrimary: Boolean(row.is_primary),
      sortOrder: Number(row.sort_order),
      createdAt: Number(row.created_at)
    };
  }
}
