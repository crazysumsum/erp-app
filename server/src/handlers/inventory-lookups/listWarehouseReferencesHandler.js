import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryMasterService } from "../../modules/inventory/InventoryMasterService.js";
import { INVENTORY_MASTER_STATUSES } from "../../modules/inventory/inventoryConstants.js";
import { EMPTY } from "../inventory/inventorySchemas.js";

const PAGE = { type: "integer", minimum: 1 };
const PAGE_SIZE = { ...PAGE, maximum: 50 };
const STATUS = { type: "string", enum: [...INVENTORY_MASTER_STATUSES] };
const WAREHOUSE = {
  type: "object", additionalProperties: false,
  required: ["id", "code", "name", "status"],
  properties: { id: PAGE, code: { type: "string" }, name: { type: "string" }, status: STATUS }
};

export class ListWarehouseReferencesHandler extends BaseRequestHandler {
  static handlerName = "listWarehouseReferences";

  static api = {
    method: "GET",
    path: "/api/v1/inventory-lookups/warehouses",
    description: "搜尋倉庫代碼及名稱。",
    authorizationPolicies: [{
      name: "hasPermission",
      options: { permissions: ["inventory.view", "sales.view", "fulfillment.view"], match: "any" }
    }],
    requestSchema: { params: EMPTY, body: EMPTY, query: {
      type: "object", additionalProperties: false,
      properties: {
        page: { ...PAGE, default: 1 },
        pageSize: { ...PAGE_SIZE, default: 20 },
        q: { type: "string", trim: true, maxLength: 190, default: "" },
        status: { type: "string", enum: ["ALL", ...INVENTORY_MASTER_STATUSES], default: "ALL" }
      }
    } },
    responseSchema: { 200: {
      type: "object", additionalProperties: false,
      required: ["items", "total", "page", "pageSize"],
      properties: {
        items: { type: "array", items: WAREHOUSE, maxItems: 50 },
        total: { type: "integer", minimum: 0 }, page: PAGE, pageSize: PAGE_SIZE
      }
    } }
  };

  constructor(services) {
    super(services);
    this.inventory = new InventoryMasterService({
      database: services.require("mysqldatabase"),
      logger: this.logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    return this.response(await this.inventory.listWarehouseReferences(req.input.query));
  }
}
