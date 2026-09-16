import { permissionStaleError } from "../../authorization/adminGuard.js";
import { ITEM_PRICE_CURRENCY, ITEM_PRICE_TAX_BASIS } from "../itemConstants.js";
import {
  brandNotFound,
  categoryNotFound,
  criticalChangeReasonRequired,
  skuCodeTaken,
  skuNotFound,
  uomNotFound,
  versionConflict
} from "../itemErrors.js";
import { ItemAuditLogService } from "../ItemAuditLogService.js";
import { normalizeAndValidateSkuCode } from "../itemValidation.js";

function isDuplicateEntry(error) {
  return (error?.cause?.code || error?.code) === "ER_DUP_ENTRY";
}

const EXISTENCE_QUERY_BY_TABLE = Object.freeze({
  item_categories: "SELECT id FROM item_categories WHERE id = ?",
  item_brands: "SELECT id FROM item_brands WHERE id = ?",
  item_uoms: "SELECT id FROM item_uoms WHERE id = ?"
});

async function assertExists(connection, table, id, notFoundError) {
  const [[row]] = await connection.query(EXISTENCE_QUERY_BY_TABLE[table], [id]);
  if (!row) {
    throw notFoundError(id);
  }
}

/**
 * Connection-aware aggregate commands for CSV execution. The worker owns the
 * batch transaction; this domain service owns validation, writes and audit.
 */
export class ItemImportAggregateService {
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("ItemImportAggregateService requires database, logger and time");
    }
    this.auditLog = new ItemAuditLogService({ database, logger, time });
  }

  async authorizeExecution(connection, { actorId }) {
    const [[actor]] = await connection.query(
      `SELECT u.id, u.username,
              EXISTS(
                SELECT 1
                  FROM user_roles ur
                  JOIN role_permissions rp ON rp.role_id = ur.role_id
                  JOIN permissions p ON p.id = rp.permission_id
                 WHERE ur.user_id = u.id AND p.name = 'item.mgmt'
              ) AS has_item_mgmt
         FROM users u
        WHERE u.id = ? AND u.status = 'active'`,
      [actorId]
    );
    if (!actor || !actor.has_item_mgmt) {
      throw permissionStaleError();
    }
    return { id: Number(actor.id), username: actor.username };
  }

  async applyRow(connection, context) {
    return context.row.operation === "create"
      ? this.#createStandardItem(connection, context)
      : this.#updateSku(connection, context);
  }

  async #createStandardItem(connection, { row, actorId, actor, reason, requestId, ip, nowMs }) {
    const {
      skuCode,
      skuName,
      itemName,
      categoryId,
      brandId,
      baseUomId,
      defaultTrackingPolicy,
      suggestedPriceAmount,
      purchasable,
      sellable
    } = row.normalizedPayload;

    await assertExists(connection, "item_categories", categoryId, categoryNotFound);
    await assertExists(connection, "item_brands", brandId, brandNotFound);
    await assertExists(connection, "item_uoms", baseUomId, uomNotFound);

    const normalizedItemName = String(itemName ?? "").trim();
    const normalizedSkuCode = normalizeAndValidateSkuCode(skuCode);
    const normalizedSkuName = String(skuName ?? "").trim();
    const [itemResult] = await connection.execute(
      `INSERT INTO items
         (name, short_name, description, category_id, brand_id, product_type, country_of_origin,
          manufacturer, default_tracking_policy, default_shelf_life_days, status, version,
          created_at, updated_at, created_by, updated_by)
       VALUES (?, '', NULL, ?, ?, 'standard', NULL, '', ?, NULL, 'draft', 1, ?, ?, ?, ?)`,
      [normalizedItemName, categoryId, brandId, defaultTrackingPolicy, nowMs, nowMs, actorId, actorId]
    );
    const itemId = itemResult.insertId;

    let skuId;
    try {
      const [skuResult] = await connection.execute(
        `INSERT INTO item_skus
           (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
            suggested_price_amount, status, version, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'draft', 1, ?, ?, ?, ?)`,
        [
          itemId,
          normalizedSkuCode,
          normalizedSkuName,
          defaultTrackingPolicy,
          purchasable ? 1 : 0,
          sellable ? 1 : 0,
          suggestedPriceAmount,
          nowMs,
          nowMs,
          actorId,
          actorId
        ]
      );
      skuId = skuResult.insertId;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw skuCodeTaken(normalizedSkuCode);
      }
      throw error;
    }

    await connection.execute(
      `INSERT INTO item_sku_uoms
         (sku_id, uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale, version,
          created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, 1, 1, ?, ?, 1, ?, ?, ?, ?)`,
      [skuId, baseUomId, purchasable ? 1 : 0, sellable ? 1 : 0, nowMs, nowMs, actorId, actorId]
    );

    await this.auditLog.record(connection, {
      actorUserId: actorId,
      actorUsername: actor.username,
      action: "item.create",
      targetType: "item",
      targetId: itemId,
      targetLabel: normalizedItemName,
      detail: { productType: "standard", skuCodes: [normalizedSkuCode], activated: false },
      reason,
      requestId,
      ip
    });
    await this.auditLog.record(connection, {
      actorUserId: actorId,
      actorUsername: actor.username,
      action: "sku.create",
      targetType: "sku",
      targetId: skuId,
      targetLabel: normalizedSkuCode,
      detail: { itemId, activated: false },
      reason,
      requestId,
      ip
    });
  }

  async #updateSku(connection, { row, actorId, actor, reason, requestId, ip, nowMs }) {
    const { skuName, defaultTrackingPolicy, suggestedPriceAmount, purchasable, sellable } = row.normalizedPayload;
    const [[current]] = await connection.query("SELECT * FROM item_skus WHERE id = ?", [row.matchSkuId]);
    if (!current) {
      throw skuNotFound(row.matchSkuId);
    }
    if (current.tracking_policy !== defaultTrackingPolicy && !String(reason ?? "").trim()) {
      throw criticalChangeReasonRequired();
    }

    const normalizedSkuName = String(skuName ?? "").trim();
    const nextPrice = suggestedPriceAmount ?? null;
    const [result] = await connection.execute(
      `UPDATE item_skus
          SET sku_name = ?, tracking_policy = ?, suggested_price_amount = ?, purchasable = ?, sellable = ?,
              updated_at = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND version = ?`,
      [
        normalizedSkuName,
        defaultTrackingPolicy,
        nextPrice,
        purchasable ? 1 : 0,
        sellable ? 1 : 0,
        nowMs,
        actorId,
        row.matchSkuId,
        row.expectedSkuVersion
      ]
    );
    if (result.affectedRows === 0) {
      const [[stillExists]] = await connection.query("SELECT id FROM item_skus WHERE id = ?", [row.matchSkuId]);
      if (!stillExists) {
        throw skuNotFound(row.matchSkuId);
      }
      throw versionConflict();
    }

    const detail = {};
    if (normalizedSkuName !== current.sku_name) {
      detail.skuName = { before: current.sku_name, after: normalizedSkuName };
    }
    if (defaultTrackingPolicy !== current.tracking_policy) {
      detail.trackingPolicy = { before: current.tracking_policy, after: defaultTrackingPolicy };
      detail.criticalUomOrTrackingChange = true;
    }
    if (String(current.suggested_price_amount ?? "") !== String(nextPrice ?? "")) {
      detail.suggestedRetailPrice = {
        before:
          current.suggested_price_amount === null
            ? null
            : {
                amount: String(current.suggested_price_amount),
                currency: ITEM_PRICE_CURRENCY,
                taxBasis: ITEM_PRICE_TAX_BASIS
              },
        after:
          nextPrice === null
            ? null
            : { amount: String(nextPrice), currency: ITEM_PRICE_CURRENCY, taxBasis: ITEM_PRICE_TAX_BASIS }
      };
    }
    await this.auditLog.record(connection, {
      actorUserId: actorId,
      actorUsername: actor.username,
      action: "sku.update",
      targetType: "sku",
      targetId: row.matchSkuId,
      targetLabel: normalizedSkuName,
      detail: Object.keys(detail).length > 0 ? detail : null,
      reason,
      requestId,
      ip
    });
  }
}
