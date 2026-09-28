import {
  INVENTORY_MASTER_STATUSES,
  INVENTORY_STOCK_STATUSES
} from "../../modules/inventory/inventoryConstants.js";

export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
export const VIEW_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["inventory.view"]) })
})]);
export const MGMT_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["inventory.view", "inventory.mgmt"]) })
})]);
export const OPERATION_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["inventory.view", "inventory.operation"]) })
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

const SOURCE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["module", "documentType", "documentId", "eventId"],
  properties: {
    module: { type: "string", minLength: 1, maxLength: 40, pattern: "^[\\x20-\\x7e]+$" },
    documentType: { type: "string", minLength: 1, maxLength: 50, pattern: "^[\\x20-\\x7e]+$" },
    documentId: { type: "string", minLength: 1, maxLength: 100 },
    lineId: { type: "string", maxLength: 100, default: "" },
    eventId: { type: "string", minLength: 1, maxLength: 100 }
  }
});
const DATE_ONLY = Object.freeze({ type: ["string", "null"], pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" });
const MINIMUM_LIFE_OVERRIDE = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "permission", "reason", "minimumLifeDaysApplied", "actualRemainingLifeDays", "actorId",
    "receiptId", "requestId"
  ],
  properties: {
    permission: { const: "receiving.expiry.override" },
    reason: { type: "string", trim: true, minLength: 5, maxLength: 500 },
    minimumLifeDaysApplied: { type: "integer", minimum: 0, maximum: 36500 },
    actualRemainingLifeDays: { type: "integer", minimum: 0, maximum: 36500 },
    actorId: ID,
    receiptId: { type: "string", minLength: 1, maxLength: 100 },
    requestId: { type: "string", minLength: 1, maxLength: 64, pattern: "^[\\x20-\\x7e]+$" }
  }
});

export const RECEIPT_CREATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["source", "skuId", "quantity", "uomId", "warehouseId", "binId", "stockStatus"],
  properties: {
    source: SOURCE,
    skuId: ID,
    quantity: ID,
    uomId: ID,
    warehouseId: ID,
    binId: ID,
    lotNumber: { type: ["string", "null"], trim: true, minLength: 1, maxLength: 100 },
    expiryDate: DATE_ONLY,
    manufactureDate: DATE_ONLY,
    stockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] },
    minimumLifeOverride: MINIMUM_LIFE_OVERRIDE
  }
});

const UOM_RESULT = Object.freeze({
  type: "object", additionalProperties: false, required: ["id", "code"],
  properties: { id: ID, code: { type: "string" } }
});
const BALANCE_RESULT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "onHandQuantity", "allocatedQuantity", "version"],
  properties: {
    id: ID,
    onHandQuantity: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    allocatedQuantity: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    version: VERSION
  }
});

export const RECEIPT_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "status", "operationId", "movementGroupId", "movementId", "skuId", "skuCode", "skuName",
    "warehouseId", "warehouseCode", "binId", "binCode", "lotId", "lotNumber", "expiryDate",
    "stockStatus", "inputQuantity", "inputUom", "baseQuantity", "baseUom", "balance", "postedAt"
  ],
  properties: {
    status: { const: "POSTED" },
    operationId: ID,
    movementGroupId: { type: "string", minLength: 1, maxLength: 100 },
    movementId: ID,
    skuId: ID,
    skuCode: { type: "string" },
    skuName: { type: "string" },
    warehouseId: ID,
    warehouseCode: { type: "string" },
    binId: ID,
    binCode: { type: "string" },
    lotId: { type: ["integer", "null"], minimum: 1 },
    lotNumber: { type: ["string", "null"] },
    expiryDate: DATE_ONLY,
    stockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] },
    inputQuantity: ID,
    inputUom: UOM_RESULT,
    baseQuantity: ID,
    baseUom: UOM_RESULT,
    balance: BALANCE_RESULT,
    postedAt: TIMESTAMP
  }
});

const NONNEGATIVE = Object.freeze({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const NULLABLE_ID = Object.freeze({ type: ["integer", "null"], minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const LIST_PAGE = Object.freeze({
  page: { type: "integer", minimum: 1, default: 1 },
  pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
});
const EXPIRY_FILTERS = Object.freeze({
  expiryFrom: DATE_ONLY,
  expiryTo: DATE_ONLY,
  expiryState: { type: "string", enum: ["ALL", "UNEXPIRED", "EXPIRED", "WITHIN_DAYS"], default: "ALL" },
  withinDays: { type: "integer", minimum: 0, maximum: 36500, default: 30 }
});
const STOCK_STATUS_FILTER = Object.freeze({
  type: "string", enum: ["ALL", ...INVENTORY_STOCK_STATUSES], default: "ALL"
});
const BASE_UOM = Object.freeze({
  type: "object", additionalProperties: false, required: ["uomId", "uomCode"],
  properties: { uomId: ID, uomCode: { type: "string" } }
});
const SKU_REF = Object.freeze({
  type: "object", additionalProperties: false, required: ["skuId", "code", "name"],
  properties: { skuId: ID, code: { type: "string" }, name: { type: "string" } }
});
const SOURCE_LINK = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["module", "documentType", "documentId", "lineId", "eventId"],
  properties: {
    module: { type: "string" }, documentType: { type: "string" }, documentId: { type: "string" },
    lineId: { type: "string" }, eventId: { type: "string" }
  }
});

export const STOCK_ID_PARAMS = Object.freeze({
  type: "object", additionalProperties: false, required: ["balanceId"], properties: { balanceId: ID }
});
export const MOVEMENT_ID_PARAMS = Object.freeze({
  type: "object", additionalProperties: false, required: ["id"], properties: { id: ID }
});
export const STOCK_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    ...LIST_PAGE,
    q: { type: "string", trim: true, maxLength: 190, default: "" },
    warehouseId: ID, binId: ID, skuId: ID,
    lot: { type: "string", trim: true, maxLength: 100 },
    ...EXPIRY_FILTERS,
    status: STOCK_STATUS_FILTER,
    availability: { type: "string", enum: ["ALL", "IN_STOCK", "NO_STOCK", "ZERO_ATP"], default: "ALL" },
    sortBy: {
      type: "string",
      enum: ["skuCode", "skuName", "warehouse", "bin", "lot", "expiryDate", "stockStatus", "onHand", "available"],
      default: "skuCode"
    },
    descending: { type: "boolean", default: false }
  }
});
export const STOCK_SUMMARY_QUERY = Object.freeze({
  type: "object", additionalProperties: false, required: ["skuId"],
  properties: {
    skuId: ID, warehouseId: ID,
    purpose: { type: "string", trim: true, minLength: 1, maxLength: 40, pattern: "^[\\x20-\\x7e]+$" },
    minimumRemainingDays: { type: "integer", minimum: 0, maximum: 36500, default: 0 }
  }
});
export const LOT_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    ...LIST_PAGE,
    skuId: ID, warehouseId: ID,
    lot: { type: "string", trim: true, maxLength: 100 },
    ...EXPIRY_FILTERS,
    status: STOCK_STATUS_FILTER,
    sortBy: { type: "string", enum: ["skuCode", "lot", "expiryDate", "firstReceiptDate"], default: "lot" },
    descending: { type: "boolean", default: false }
  }
});
export const EXPIRY_LIST_QUERY = Object.freeze({
  ...LOT_LIST_QUERY,
  properties: {
    ...LOT_LIST_QUERY.properties,
    expiryState: { type: "string", enum: ["EXPIRED", "WITHIN_DAYS"], default: "EXPIRED" }
  }
});
export const MOVEMENT_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    ...LIST_PAGE,
    postedFrom: TIMESTAMP, postedTo: TIMESTAMP,
    movementType: { type: "string", trim: true, minLength: 1, maxLength: 40, pattern: "^[\\x20-\\x7e]+$" },
    sourceModule: { type: "string", trim: true, minLength: 1, maxLength: 40, pattern: "^[\\x20-\\x7e]+$" },
    sourceDocumentType: { type: "string", trim: true, minLength: 1, maxLength: 50, pattern: "^[\\x20-\\x7e]+$" },
    sourceDocumentId: { type: "string", trim: true, minLength: 1, maxLength: 100 },
    skuId: ID, warehouseId: ID, binId: ID, lotId: ID, actorId: ID
  }
});
export const OPERATION_SOURCE_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["sourceModule", "sourceDocumentType", "sourceDocumentId", "sourceEventId"],
  properties: {
    sourceModule: { type: "string", trim: true, minLength: 1, maxLength: 40, pattern: "^[\\x20-\\x7e]+$" },
    sourceDocumentType: { type: "string", trim: true, minLength: 1, maxLength: 50, pattern: "^[\\x20-\\x7e]+$" },
    sourceDocumentId: { type: "string", trim: true, minLength: 1, maxLength: 100 },
    sourceLineId: { type: "string", trim: true, maxLength: 100, default: "" },
    sourceEventId: { type: "string", trim: true, minLength: 1, maxLength: 100 }
  }
});

const STOCK_ITEM = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "balanceId", "warehouse", "bin", "sku", "lot", "stockStatus", "isExpired",
    "onHand", "allocated", "bucketFree", "baseUom", "version"
  ],
  properties: {
    balanceId: ID,
    warehouse: {
      type: "object", additionalProperties: false, required: ["warehouseId", "code", "name"],
      properties: { warehouseId: ID, code: { type: "string" }, name: { type: "string" } }
    },
    bin: {
      type: "object", additionalProperties: false, required: ["binId", "code", "name"],
      properties: { binId: ID, code: { type: "string" }, name: { type: ["string", "null"] } }
    },
    sku: SKU_REF,
    lot: {
      type: ["object", "null"], additionalProperties: false,
      required: ["lotId", "number", "expiryDate", "manufactureDate"],
      properties: { lotId: ID, number: { type: "string" }, expiryDate: DATE_ONLY, manufactureDate: DATE_ONLY }
    },
    stockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] },
    isExpired: { type: "boolean" },
    onHand: NONNEGATIVE, allocated: NONNEGATIVE, bucketFree: NONNEGATIVE,
    baseUom: BASE_UOM,
    version: VERSION
  }
});

const MOVEMENT = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "movementId", "groupId", "movementType", "locationKind", "warehouse", "bin", "sku", "lot",
    "stockStatus", "direction", "quantity", "balanceBefore", "balanceAfter", "balanceVersionAfter",
    "postedAt", "postedBy", "operationId", "source"
  ],
  properties: {
    movementId: ID, groupId: { type: "string" }, movementType: { type: "string" },
    locationKind: { type: "string", enum: ["BIN", "IN_TRANSIT"] },
    warehouse: {
      type: "object", additionalProperties: false, required: ["warehouseId", "code"],
      properties: { warehouseId: ID, code: { type: "string" } }
    },
    bin: {
      type: ["object", "null"], additionalProperties: false, required: ["binId", "code"],
      properties: { binId: ID, code: { type: "string" } }
    },
    sku: SKU_REF,
    lot: {
      type: ["object", "null"], additionalProperties: false, required: ["lotId", "number", "expiryDate"],
      properties: { lotId: ID, number: { type: "string" }, expiryDate: DATE_ONLY }
    },
    stockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] },
    direction: { type: "string", enum: ["IN", "OUT"] },
    quantity: ID,
    balanceBefore: { type: ["integer", "null"], minimum: 0 },
    balanceAfter: { type: ["integer", "null"], minimum: 0 },
    balanceVersionAfter: NULLABLE_ID,
    postedAt: TIMESTAMP,
    postedBy: {
      type: "object", additionalProperties: false, required: ["userId", "label"],
      properties: { userId: NULLABLE_ID, label: { type: "string" } }
    },
    operationId: ID,
    source: SOURCE_LINK
  }
});

const LOT_ITEM = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "lotId", "sku", "lotNumber", "expiryDate", "manufactureDate", "firstReceiptDate",
    "isExpired", "remainingLifeDays", "totalOnHand", "availableOnHand", "quarantined", "damaged", "baseUom"
  ],
  properties: {
    lotId: ID, sku: SKU_REF, lotNumber: { type: "string" }, expiryDate: DATE_ONLY,
    manufactureDate: DATE_ONLY, firstReceiptDate: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    isExpired: { type: "boolean" }, remainingLifeDays: { type: ["integer", "null"] },
    totalOnHand: NONNEGATIVE, availableOnHand: NONNEGATIVE, quarantined: NONNEGATIVE, damaged: NONNEGATIVE,
    baseUom: BASE_UOM
  }
});

export const STOCK_LIST_RESPONSE = listResponse(STOCK_ITEM);
export const LOT_LIST_RESPONSE = listResponse(LOT_ITEM);
export const MOVEMENT_LIST_RESPONSE = listResponse(MOVEMENT);
export const STOCK_DETAIL_RESPONSE = Object.freeze({
  ...STOCK_ITEM,
  required: [...STOCK_ITEM.required, "allocationSummary", "recentMovements"],
  properties: {
    ...STOCK_ITEM.properties,
    allocationSummary: {
      type: "object", additionalProperties: false, required: ["allocated"], properties: { allocated: NONNEGATIVE }
    },
    recentMovements: { type: "array", items: MOVEMENT, maxItems: 20 }
  }
});
export const STOCK_SUMMARY_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "totalOnHand", "availableOnHand", "eligibleOnHand", "reserved", "atp",
    "uncoveredReserved", "quarantined", "damaged", "inTransit"
  ],
  properties: Object.fromEntries([
    "totalOnHand", "availableOnHand", "eligibleOnHand", "reserved", "atp",
    "uncoveredReserved", "quarantined", "damaged", "inTransit"
  ].map((field) => [field, NONNEGATIVE]))
});
export const MOVEMENT_DETAIL_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["movement", "groupLegs", "reversal"],
  properties: {
    movement: MOVEMENT,
    groupLegs: { type: "array", items: MOVEMENT },
    reversal: {
      type: "object", additionalProperties: false,
      required: ["reversalOfMovementId", "reversedByMovementId"],
      properties: { reversalOfMovementId: NULLABLE_ID, reversedByMovementId: NULLABLE_ID }
    }
  }
});
export const OPERATION_SOURCE_RESPONSE = Object.freeze({
  type: ["object", "null"], additionalProperties: false,
  required: ["operationId", "resultType", "resultId", "resultSummary", "completedAt"],
  properties: {
    operationId: ID, resultType: { type: "string" }, resultId: { type: "string" },
    resultSummary: { type: ["object", "null"] }, completedAt: TIMESTAMP
  }
});
