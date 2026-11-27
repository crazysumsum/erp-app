import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerLookupService } from "../../modules/customer/CustomerLookupService.js";
import { EMPTY } from "../customers/customerSchemas.js";

const status = { type: "string", enum: ["draft", "pending_approval", "active", "suspended", "blocked", "archived"] };
const page = { type: "integer", minimum: 1, maximum: Math.floor(Number.MAX_SAFE_INTEGER / 50) };
const pageSize = { type: "integer", minimum: 1, maximum: 50 };

export class ListCustomerReferencesHandler extends BaseRequestHandler {
  static handlerName = "listCustomerReferences";
  static api = {
    method: "GET",
    path: "/api/v1/customer-lookups/references",
    description: "List customer identities for reference filters",
    authType: "jwt",
    authorizationPolicies: [{
      name: "hasPermission",
      options: { permissions: ["customer.view", "sales.view", "fulfillment.view"], match: "any" }
    }],
    requestSchema: {
      params: EMPTY,
      body: EMPTY,
      query: {
        type: "object", additionalProperties: false,
        properties: {
          q: { type: "string", maxLength: 190, trim: true, pattern: String.raw`^[^\p{Cc}]*$` },
          page: { ...page, default: 1 },
          pageSize: { ...pageSize, default: 20 },
          status
        }
      }
    },
    responseSchema: {
      200: {
        type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
        properties: {
          items: {
            type: "array", maxItems: 50,
            items: {
              type: "object", additionalProperties: false, required: ["id", "code", "name", "status"],
              properties: {
                id: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
                code: { type: "string" },
                name: { type: "string" },
                status
              }
            }
          },
          total: { type: "integer", minimum: 0 },
          page,
          pageSize
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.lookup = new CustomerLookupService({ database: services.require("mysqldatabase") });
  }

  async execute(req) {
    return this.response(await this.lookup.listReferences(req.input.query));
  }
}
