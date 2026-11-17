import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_WRITE_POLICY, PURCHASING_LOOKUP_RESPONSE, PURCHASING_SUPPLIER_ID_PARAMS, purchasingLookupQuery, purchasingLookupService
} from "../purchasing/purchasingSchemas.js";

// 八條路由嘅授權同流程一樣，只係讀唔同嘅選項（同 salesLookupHandlers 一樣）。Query 喺 handler 驗，錯誤先係 §5.7 嘅 PURCHASING_INPUT_INVALID。
function lookupHandler(name, path, kind, read, params = EMPTY) {
  return class extends BaseRequestHandler {
    static handlerName = name;
    static api = { method: "GET", path: `/api/v1/purchasing-lookups/${path}`, description: `Read Purchasing ${kind} choices`,
      authorizationPolicies: [PURCHASE_ORDER_WRITE_POLICY], requestSchema: { params, query: {}, body: EMPTY }, responseSchema: { 200: PURCHASING_LOOKUP_RESPONSE[kind] } };
    constructor(services = {}) {
      super(services);
      this.lookup = purchasingLookupService(services, this.logger);
    }
    async execute(req) {
      return this.response(await read(this.lookup, { claims: req.auth.claims, ...purchasingLookupQuery(req, kind), ...(req.input.params?.id ? { supplierId: Number(req.input.params.id) } : {}) }));
    }
  };
}

export const PurchasingSupplierLookupHandler = lookupHandler("purchasingSupplierLookup", "suppliers", "suppliers", (lookup, input) => lookup.suppliers(input));
export const PurchasingSupplierDefaultsHandler = lookupHandler("purchasingSupplierDefaults", "suppliers/:id/defaults", "supplierDefaults",
  (lookup, input) => lookup.supplierDefaults(input), PURCHASING_SUPPLIER_ID_PARAMS);
export const PurchasingSkuLookupHandler = lookupHandler("purchasingSkuLookup", "skus", "skus", (lookup, input) => lookup.skus(input));
export const PurchasingCurrencyLookupHandler = lookupHandler("purchasingCurrencyLookup", "currencies", "currencies", (lookup, input) => lookup.currencies(input));
export const PurchasingPaymentTermLookupHandler = lookupHandler("purchasingPaymentTermLookup", "payment-terms", "paymentTerms", (lookup, input) => lookup.paymentTerms(input));
export const PurchasingWarehouseLookupHandler = lookupHandler("purchasingWarehouseLookup", "warehouses", "warehouses", (lookup, input) => lookup.warehouses(input));
export const PurchasingBuyerLookupHandler = lookupHandler("purchasingBuyerLookup", "buyers", "buyers", (lookup, input) => lookup.buyers(input));
export const PurchasingApproverLookupHandler = lookupHandler("purchasingApproverLookup", "approvers", "approvers", (lookup, input) => lookup.approvers(input));
