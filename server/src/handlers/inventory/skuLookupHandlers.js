import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { RequestValidationError } from "../../framework/validation/requestValidator.js";
import { ItemLookupService } from "../../modules/item/ItemLookupService.js";
import { uomConversionInvalid } from "../../modules/item/itemErrors.js";
import { normalizeAndValidateSkuCode } from "../../modules/item/itemValidation.js";
import { inventoryError } from "../../modules/inventory/inventoryErrors.js";
import { EMPTY, VIEW_POLICY, SKU_LOOKUP_QUERY, SKU_LOOKUP_RESPONSE } from "./inventorySchemas.js";

export class LookupInventorySkuHandler extends BaseRequestHandler {
  static handlerName = "lookupInventorySku";
  static api = { method: "GET", path: "/api/v1/inventory/sku-lookup", authType: "jwt",
    description: "依精確 SKU Code 或 Barcode 查找可供庫存選料的最小資料。", authorizationPolicies: VIEW_POLICY,
    requestSchema: { params: EMPTY, query: SKU_LOOKUP_QUERY }, responseSchema: { 200: SKU_LOOKUP_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase");
    this.itemDependencies = { logger: services.require("logging").logger, time: services.require("time") };
  }
  async execute(req) {
    // Global query coercion supports numeric filters, but this contract accepts only raw strings.
    const byCode = Object.hasOwn(req.query, "code"), field = byCode ? "code" : "barcode";
    if (byCode === Object.hasOwn(req.query, "barcode") || typeof req.query[field] !== "string") {
      throw new RequestValidationError([{ location: "query", path: `/${field}`, keyword: "type", message: byCode ? "must be string" : "must be one raw string" }], true);
    }
    const raw = req.query[field];
    if (!byCode && (!raw.trim() || [...raw].length > 190 || Buffer.byteLength(raw, "utf8") > 760 || /\p{Cc}/u.test(raw))) {
      throw new RequestValidationError([{ location: "query", path: "/barcode", keyword: "pattern", message: "invalid barcode input" }], true);
    }
    const value = byCode ? normalizeAndValidateSkuCode(req.input.query.code) : raw;
    const data = await this.database.withTransaction(async (tx) => {
      const item = new ItemLookupService({ database: tx, ...this.itemDependencies });
      const found = byCode ? await item.findByCode(value, { purpose: "inventory" }) : await item.findByBarcode(value, { purpose: "inventory" });
      if (!found) throw inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
      const profile = found;
      const baseUom = profile.uoms.find(uom => uom.isBase);
      if (!baseUom || baseUom.toBaseFactor !== 1) {
        throw uomConversionInvalid("Inventory profile requires exactly one Base UOM with factor 1");
      }
      if (!profile.inventoryTracked) throw inventoryError("SKU_NOT_INVENTORY_TRACKED");
      if (!profile.usable) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "skuId" });
      if (profile.trackingPolicy === "serial") throw inventoryError("SERIAL_TRACKING_UNSUPPORTED");
      return { skuId: profile.skuId, skuCode: profile.skuCode, skuName: profile.skuName, trackingPolicy: profile.trackingPolicy,
        baseUom: { uomId: baseUom.uomId, uomCode: baseUom.uomCode } };
    });
    return this.response(data);
  }
}
