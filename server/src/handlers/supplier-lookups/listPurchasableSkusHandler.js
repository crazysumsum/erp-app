import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemLookupService } from "../../modules/item/ItemLookupService.js";
import { assertActorFresh } from "../../modules/authorization/directoryLookups.js";
import { SUPPLIER_MGMT_POLICY } from "../suppliers/supplierSchemas.js";

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
const QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    q: { type: "string", maxLength: 190, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]*$", default: "" },
    // 修改對話框用：精確攞一隻 SKU，唔靠前綴搜尋嘅第一頁（REV-088 L-1）。
    skuId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    // 冇上限嘅話，大到唔係 safe integer 嘅 page 會喺 Item 度變 TypeError（500）（REV-088 L-2）。
    page: { type: "integer", minimum: 1, maximum: 1_000_000, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
  }
});
const UOM = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["skuUomId", "uomCode", "uomName", "status", "toBaseFactor", "isBase", "isDefaultPurchase"],
  properties: { skuUomId: { type: "integer" }, uomCode: { type: "string" }, uomName: { type: "string" }, status: { type: "string" },
    toBaseFactor: { type: "integer" }, isBase: { type: "boolean" }, isDefaultPurchase: { type: "boolean" } }
});
const SKU = Object.freeze({
  type: "object", additionalProperties: false, required: ["skuId", "skuCode", "skuName", "itemName", "uoms"],
  properties: { skuId: { type: "integer" }, skuCode: { type: "string" }, skuName: { type: ["string", "null"] }, itemName: { type: "string" },
    uoms: { type: "array", items: UOM } }
});
const RESPONSE = Object.freeze({
  type: "object", required: ["items", "total", "page", "pageSize"], additionalProperties: false,
  properties: { items: { type: "array", items: SKU }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" } }
});

/**
 * 供貨關係 dialog 揀 SKU 用（TASK-039，HD-098）：Item 嘅 `searchForPurchase`（Item §8.3.2）只列而家可以採購嘅 SKU；
 * 帶 `skuId` 就用 `findById(purpose purchase)` 精確攞嗰一隻，唔可以採購就回空清單。
 * 閘喺 `supplier.mgmt`，同建立／修改關係一樣；只回揀選需要嘅欄位。
 */
export class ListPurchasableSkusHandler extends BaseRequestHandler {
  static handlerName = "listPurchasableSkus";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-lookups/skus",
    description: "搜尋目前可採購的 SKU 及其單位，供建立或修改供貨關係時選擇。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: EMPTY, query: QUERY, body: EMPTY },
    responseSchema: { 200: RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase");
    this.time = services.require("time");
    this.items = new ItemLookupService({ database: this.database, logger: services.require("logging").logger, time: this.time });
  }

  async execute(req) {
    const { claims } = req.auth;
    await assertActorFresh(this.database, { actorId: Number(claims.sub), claimedRoles: claims.roles, claimedPermissions: claims.permissions });
    const { skuId, ...search } = req.input.query;
    let result;
    if (skuId) {
      const sku = await this.items.findById(Number(skuId), { purpose: "purchase", atMs: this.time.nowMs() });
      const items = sku?.usable ? [sku] : [];
      result = { items, total: items.length, page: 1, pageSize: search.pageSize };
    } else {
      result = await this.items.searchForPurchase(search);
    }
    return this.response({
      ...result,
      items: result.items.map((sku) => ({
        skuId: sku.skuId, skuCode: sku.skuCode, skuName: sku.skuName, itemName: sku.itemName,
        uoms: sku.uoms.map((uom) => ({ skuUomId: uom.skuUomId, uomCode: uom.uomCode, uomName: uom.uomName, status: uom.status,
          toBaseFactor: uom.toBaseFactor, isBase: uom.isBase, isDefaultPurchase: uom.isDefaultPurchase }))
      }))
    });
  }
}
