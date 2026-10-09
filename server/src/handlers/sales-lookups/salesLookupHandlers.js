import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesLookupService } from "../../modules/sales/SalesLookupService.js";
import { EMPTY, SALES_LOOKUP_RESPONSE, salesActorClaims, salesLookupQuery } from "../sales/salesSchemas.js";

// Four real purpose routes share the same fresh authorization and bounded read flow.
function lookupHandler(kind, name) {
  return class extends BaseRequestHandler {
    static handlerName = name;
    static api = { method: "GET", path: `/api/v1/sales-lookups/${kind}`, description: `Read Sales ${kind} choices`,
      authorizationPolicies: [{ name: "hasPermission", options: { permissions: ["sales.view", kind === "channels" ? "sales.import" : "sales.mgmt"] } }],
      requestSchema: { params: EMPTY, query: {}, body: EMPTY }, responseSchema: { 200: SALES_LOOKUP_RESPONSE[kind] } };
    constructor(services = {}) {
      super(services);
      this.lookup = new SalesLookupService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger, config: services.config?.sales });
    }
    async execute(req) { return this.response(await this.lookup.list({ claims: salesActorClaims(req), kind, input: salesLookupQuery(req, kind) })); }
  };
}
export const SalesCustomerLookupHandler = lookupHandler("customers", "salesCustomerLookup");
export const SalesSkuLookupHandler = lookupHandler("skus", "salesSkuLookup");
export const SalesWarehouseLookupHandler = lookupHandler("warehouses", "salesWarehouseLookup");
export const SalesChannelLookupHandler = lookupHandler("channels", "salesChannelLookup");
