import { INVENTORY_MASTER_STATUSES } from "../../modules/inventory/inventoryConstants.js";

export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
export const VIEW_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["inventory.view"]) })
})]);
export const MGMT_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["inventory.view", "inventory.mgmt"]) })
})]);

const ID = Object.freeze({ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const VERSION = Object.freeze({ type: "integer", minimum: 1, maximum: 4_294_967_295 });
const TIMESTAMP = Object.freeze({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const STATUS = Object.freeze({ type: "string", enum: [...INVENTORY_MASTER_STATUSES] });
const REASON = Object.freeze({ type: "string", trim: true, minLength: 5, maxLength: 500 });
const PASSWORD = Object.freeze({ type: "string", minLength: 1, maxLength: 1024 });
const CODE = Object.freeze({ type: "string", trim: true, minLength: 1, maxLength: 50 });
const NAME = Object.freeze({ type: "string", trim: true, minLength: 1, maxLength: 190 });
const OPTIONAL_NAME = Object.freeze({ type: ["string", "null"], trim: true, maxLength: 190 });
const DESCRIPTION = Object.freeze({ type: "string", trim: true, maxLength: 500 });
const ADDRESS = Object.freeze({ type: ["string", "null"], trim: true, maxLength: 500 });

export const WAREHOUSE_ID_PARAMS = Object.freeze({
  type: "object", additionalProperties: false, required: ["id"], properties: { id: ID }
});
export const WAREHOUSE_PARENT_PARAMS = Object.freeze({
  type: "object", additionalProperties: false, required: ["warehouseId"], properties: { warehouseId: ID }
});
export const BIN_ID_PARAMS = Object.freeze({
  type: "object", additionalProperties: false, required: ["warehouseId", "binId"],
  properties: { warehouseId: ID, binId: ID }
});

function listQuery(sortBy, extras = {}) {
  return Object.freeze({
    type: "object", additionalProperties: false,
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      q: { type: "string", trim: true, maxLength: 190, default: "" },
      status: { type: "string", enum: ["ALL", ...INVENTORY_MASTER_STATUSES], default: "ACTIVE" },
      sortBy: { type: "string", enum: sortBy, default: "code" },
      descending: { type: "boolean", default: false },
      ...extras
    }
  });
}

export const WAREHOUSE_LIST_QUERY = listQuery(["code", "name", "status", "updatedAt"]);
export const BIN_LIST_QUERY = listQuery(["code", "name", "status", "updatedAt"], {
  lockStatus: { type: "string", enum: ["ALL", "LOCKED", "UNLOCKED"], default: "ALL" }
});

export const WAREHOUSE_CREATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["warehouseCode", "warehouseName"],
  properties: { warehouseCode: CODE, warehouseName: NAME, address: ADDRESS, description: DESCRIPTION }
});
export const WAREHOUSE_UPDATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["warehouseCode", "warehouseName", "address", "description", "version"],
  properties: { warehouseCode: CODE, warehouseName: NAME, address: ADDRESS, description: DESCRIPTION, version: VERSION }
});
export const BIN_CREATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["binCode"],
  properties: { binCode: CODE, binName: OPTIONAL_NAME, description: DESCRIPTION }
});
export const BIN_UPDATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["binCode", "binName", "description", "version"],
  properties: { binCode: CODE, binName: OPTIONAL_NAME, description: DESCRIPTION, version: VERSION }
});
export const LIFECYCLE = Object.freeze({
  type: "object", additionalProperties: false, required: ["version", "reason", "password"],
  properties: { version: VERSION, reason: REASON, password: PASSWORD }
});

export const WAREHOUSE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "code", "name", "address", "description", "status", "version", "createdAt", "updatedAt"],
  properties: {
    id: ID, code: { type: "string" }, name: { type: "string" }, address: { type: ["string", "null"] },
    description: { type: "string" }, status: STATUS, version: VERSION, createdAt: TIMESTAMP, updatedAt: TIMESTAMP
  }
});
export const BIN_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "warehouseId", "code", "name", "description", "status", "version", "createdAt", "updatedAt"],
  properties: {
    id: ID, warehouseId: ID, code: { type: "string" }, name: { type: ["string", "null"] },
    description: { type: "string" }, status: STATUS, version: VERSION, createdAt: TIMESTAMP, updatedAt: TIMESTAMP
  }
});
const WAREHOUSE_BLOCKERS = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["currentOnHand", "activeReservations", "activeAllocations", "openTransfers", "activeStocktakes", "activeBinLocks"],
  properties: Object.fromEntries([
    "currentOnHand", "activeReservations", "activeAllocations", "openTransfers", "activeStocktakes", "activeBinLocks"
  ].map((field) => [field, { type: "integer", minimum: 0 }]))
});
const BIN_BLOCKERS = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["currentOnHand", "activeAllocations", "openTransfers", "activeStocktakeLocks"],
  properties: Object.fromEntries([
    "currentOnHand", "activeAllocations", "openTransfers", "activeStocktakeLocks"
  ].map((field) => [field, { type: "integer", minimum: 0 }]))
});
const CURRENT_LOCK = Object.freeze({
  type: ["object", "null"], additionalProperties: false,
  required: ["type", "stocktakeId", "stocktakeNumber", "lockedAt"],
  properties: {
    type: { const: "STOCKTAKE" }, stocktakeId: ID, stocktakeNumber: { type: "string" }, lockedAt: TIMESTAMP
  }
});

export const WAREHOUSE_DETAIL = Object.freeze({
  ...WAREHOUSE_RESPONSE,
  required: [...WAREHOUSE_RESPONSE.required, "binSummary", "blockers"],
  properties: {
    ...WAREHOUSE_RESPONSE.properties,
    binSummary: {
      type: "object", additionalProperties: false, required: ["total", "active", "inactive"],
      properties: Object.fromEntries(["total", "active", "inactive"].map((field) => [field, { type: "integer", minimum: 0 }]))
    },
    blockers: WAREHOUSE_BLOCKERS
  }
});
export const BIN_SUMMARY = Object.freeze({
  ...BIN_RESPONSE, required: [...BIN_RESPONSE.required, "locked"], properties: { ...BIN_RESPONSE.properties, locked: { type: "boolean" } }
});
export const BIN_DETAIL = Object.freeze({
  ...BIN_RESPONSE,
  required: [...BIN_RESPONSE.required, "blockers", "currentLock"],
  properties: { ...BIN_RESPONSE.properties, blockers: BIN_BLOCKERS, currentLock: CURRENT_LOCK }
});

function listResponse(item) {
  return Object.freeze({
    type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
    properties: {
      items: { type: "array", items: item }, total: { type: "integer", minimum: 0 },
      page: ID, pageSize: { type: "integer", minimum: 1, maximum: 100 }
    }
  });
}

export const WAREHOUSE_LIST_RESPONSE = listResponse(WAREHOUSE_RESPONSE);
export const BIN_LIST_RESPONSE = listResponse(BIN_SUMMARY);
export const WAREHOUSE_DELETE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["id", "deleted"],
  properties: { id: ID, deleted: { const: true } }
});
export const BIN_DELETE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["id", "warehouseId", "deleted"],
  properties: { id: ID, warehouseId: ID, deleted: { const: true } }
});
