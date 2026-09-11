import { stringify } from "csv-stringify/sync";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ITEM_STATUSES } from "../../modules/item/itemConstants.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import { EMPTY_OBJECT_SCHEMA, ITEM_MGMT_POLICY } from "../skus/skuSchemas.js";

const EXPORT_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    q: { type: "string", maxLength: 190, default: "" },
    itemId: { type: "integer", minimum: 1 },
    categoryId: { type: "integer", minimum: 1 },
    brandId: { type: "integer", minimum: 1 },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    includeArchived: { type: "boolean", default: false },
    purchasable: { type: "boolean" },
    sellable: { type: "boolean" }
  }
});

const EXPORT_CSV_COLUMNS = Object.freeze([
  "skuCode",
  "skuName",
  "itemName",
  "categoryName",
  "brandName",
  "status",
  "primaryBarcode",
  "baseUomCode",
  "suggestedPriceAmount",
  "currency",
  "taxBasis",
  "purchasable",
  "sellable",
  "updatedAt"
]);

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

/**
 * 按目前 SKU 篩選匯出 UTF-8 CSV。設計說明見
 * docs/items_management/design_spec.md §6.8。固定 HKD／`tax_not_applicable`
 * 價格口徑、ISO 8601＋offset 時間、穩定欄位順序；不輸出 stored path、audit
 * IP、internal hash 或成本等未授權欄位（見 `ItemAdminService.exportSkus()`
 * 的白名單 SELECT）。
 *
 * `item.export` audit 喺 `ItemAdminService.exportSkus()` 入面寫，只記篩選
 * 條件同筆數，唔保存整份 CSV 內容——同 import 嘅 `item.import` audit 同一個
 * 理由（見 ItemAuditLogService.record() 的說明：密碼、雜湊、token、檔案
 * 內容永遠不該入 detail）。
 */
export class ExportSkusHandler extends BaseRequestHandler {
  static handlerName = "exportSkus";

  static api = {
    method: "GET",
    path: "/api/v1/item-exports/skus",
    description: "按目前 SKU 篩選匯出 UTF-8 CSV。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    download: { enabled: true },
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EXPORT_QUERY_SCHEMA
    },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  constructor(services = {}) {
    super(services);
    this.itemAdmin = new ItemAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { q, itemId, categoryId, brandId, status, includeArchived, purchasable, sellable } = req.input.query;

    const items = await this.itemAdmin.exportSkus({
      ...actorContext(req),
      q,
      itemId,
      categoryId,
      brandId,
      status,
      includeArchived,
      purchasable,
      sellable,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || ""
    });

    const csvText = stringify(items, { header: true, columns: [...EXPORT_CSV_COLUMNS] });

    return this.file({
      buffer: Buffer.from(csvText, "utf8"),
      fileName: `sku-export-${Date.now()}.csv`,
      contentType: "text/csv; charset=utf-8"
    });
  }
}
