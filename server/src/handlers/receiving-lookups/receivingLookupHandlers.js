import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ReceivingLookupService } from "../../modules/purchasing/ReceivingLookupService.js";
import { EMPTY } from "../purchasing/purchasingSchemas.js";
import { GOODS_RECEIPT_ID_PARAMS, GOODS_RECEIPT_WRITE_POLICY } from "../purchasing/receivingSchemas.js";

const ID = { type: "integer", minimum: 1 }, TEXT = { type: "string" };
const list = (properties) => ({ type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array",
  items: { type: "object", required: Object.keys(properties), additionalProperties: false, properties } } } });
const Q = { type: "object", additionalProperties: false, properties: { q: { type: "string", maxLength: 100 } } };

function lookupHandler(name, path, response, read, { params = EMPTY, query = EMPTY } = {}) {
  return class extends BaseRequestHandler {
    static handlerName = name;
    static api = { method: "GET", path: `/api/v1/receiving-lookups/${path}`, description: `Read receiving ${path} choices`,
      authorizationPolicies: [GOODS_RECEIPT_WRITE_POLICY], requestSchema: { params, query, body: EMPTY }, responseSchema: { 200: response } };
    constructor(services = {}) {
      super(services);
      this.lookup = new ReceivingLookupService({ database: services.require("mysqldatabase") });
    }
    async execute(req) {
      return this.response(await read(this.lookup, req));
    }
  };
}

export const ReceivingPurchaseOrderLookupHandler = lookupHandler("receivingPurchaseOrderLookup", "purchase-orders",
  list({ id: ID, number: TEXT, status: { enum: ["CONFIRMED", "PARTIALLY_RECEIVED"] }, supplierCode: TEXT, supplierName: TEXT, version: ID }),
  (lookup, req) => lookup.purchaseOrders({ claims: req.auth.claims, q: req.input.query?.q }), { query: Q });
export const ReceivingWarehouseLookupHandler = lookupHandler("receivingWarehouseLookup", "warehouses", list({ id: ID, code: TEXT, name: TEXT }),
  (lookup, req) => lookup.warehouses({ claims: req.auth.claims }));
export const ReceivingBinLookupHandler = lookupHandler("receivingBinLookup", "warehouses/:id/bins", list({ id: ID, code: TEXT }),
  (lookup, req) => lookup.bins({ claims: req.auth.claims, warehouseId: Number(req.input.params.id) }), { params: GOODS_RECEIPT_ID_PARAMS });
