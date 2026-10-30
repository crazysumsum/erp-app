import {
 INVENTORY_ALLOCATION_STATUSES,
  INVENTORY_ADJUSTMENT_REASON_CATEGORIES,
  INVENTORY_MASTER_STATUSES,
  INVENTORY_RESERVATION_STATUSES,
  INVENTORY_STOCK_STATUSES,
  INVENTORY_TRANSFER_STATUSES
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
export const ADJUST_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["inventory.view", "inventory.adjust"]) })
})]);

const ID = Object.freeze({ type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const NON_NEGATIVE_QUANTITY = Object.freeze({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const SIGNED_QUANTITY = Object.freeze({ type: "integer", minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER });
const VERSION = Object.freeze({ type: "integer", minimum: 1, maximum: 4_294_967_295 });
const TIMESTAMP = Object.freeze({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const STATUS = Object.freeze({ type: "string", enum: [...INVENTORY_MASTER_STATUSES] });
const REASON = Object.freeze({ type: "string", trim: true, minLength: 5, maxLength: 500 });
const PASSWORD = Object.freeze({ type: "string", minLength: 1, maxLength: 1024 });
const CODE = Object.freeze({ type: "string", trim: true, minLength: 1, maxLength: 50 });
const NAME = Object.freeze({ type: "string", trim: true, minLength: 1, maxLength: 190 });
const OPTIONAL_NAME = Object.freeze({ type: ["string", "null"], trim: true, maxLength: 190 });

export const SKU_LOOKUP_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  oneOf: [
    { type: "object", properties: { code: {} }, required: ["code"] },
    { type: "object", properties: { barcode: {} }, required: ["barcode"] }
  ],
  properties: {
    code: { type: "string", minLength: 1, maxLength: 190, pattern: "^[^\\u0000-\\u001f\\u007f]*$" },
    barcode: { type: "string", minLength: 1, maxLength: 190, pattern: "^[^\\p{Cc}]+$" }
  }
});
export const SKU_LOOKUP_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["skuId", "skuCode", "skuName", "trackingPolicy", "baseUom"],
  properties: {
    skuId: ID, skuCode: { type: "string" }, skuName: { type: "string" },
    trackingPolicy: { type: "string", enum: ["none", "batch", "batch_expiry"] },
    baseUom: { type: "object", additionalProperties: false, required: ["uomId", "uomCode"],
      properties: { uomId: ID, uomCode: { type: "string" } } }
  }
});
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
// The preparation normalizer supplies lineId; defaults inside oneOf are rejected by strict Ajv.
const HIGH_RISK_SOURCE = Object.freeze({ ...SOURCE,
  properties: { ...SOURCE.properties, lineId: { type: "string", maxLength: 100 } } });
const HIGH_RISK_COMMON = Object.freeze({ source: HIGH_RISK_SOURCE, password: PASSWORD, quantity: ID, uomId: ID,
  reasonText: { type: "string", minLength: 1, maxLength: 500, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]+$" } });
const HIGH_RISK_REQUIRED = ["source", "password", "quantity", "uomId", "reasonText"];
const EXPECTED_ABSENT = Object.freeze({ type: ["integer", "null"], minimum: 1, maximum: 4_294_967_295 });
const ADJUSTMENT_REASON = Object.freeze({ type: "string", enum: [...INVENTORY_ADJUSTMENT_REASON_CATEGORIES] });
const ADJUSTMENT_IN_PROPERTIES = Object.freeze({ ...HIGH_RISK_COMMON, direction: { const: "IN" }, warehouseId: ID, binId: ID,
  skuId: ID, stockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] }, expectedBalanceVersion: EXPECTED_ABSENT,
  reasonCategory: ADJUSTMENT_REASON, lotNumber: { type: "string", minLength: 1, maxLength: 100 },
  expiryDate: { ...DATE_ONLY, type: "string" }, manufactureDate: { ...DATE_ONLY, type: "string" } });
const ADJUSTMENT_OUT_PROPERTIES = Object.freeze({ ...HIGH_RISK_COMMON, direction: { const: "OUT" }, balanceId: ID,
  expectedBalanceVersion: VERSION, reasonCategory: ADJUSTMENT_REASON });
export const ADJUSTMENT_CREATE = Object.freeze({
  type: "object", additionalProperties: false, required: HIGH_RISK_REQUIRED,
  properties: { ...ADJUSTMENT_IN_PROPERTIES, ...ADJUSTMENT_OUT_PROPERTIES, direction: { type: "string", enum: ["IN", "OUT"] },
    expectedBalanceVersion: EXPECTED_ABSENT },
  oneOf: [
    { type: "object", additionalProperties: false, properties: ADJUSTMENT_IN_PROPERTIES,
      required: [...HIGH_RISK_REQUIRED, "direction", "warehouseId", "binId", "skuId", "stockStatus", "expectedBalanceVersion", "reasonCategory"] },
    { type: "object", additionalProperties: false, properties: ADJUSTMENT_OUT_PROPERTIES,
      required: [...HIGH_RISK_REQUIRED, "direction", "balanceId", "expectedBalanceVersion", "reasonCategory"] }
  ]
});
export const STATUS_TRANSFER_CREATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: [...HIGH_RISK_REQUIRED, "sourceBalanceId", "destinationStatus", "expectedSourceVersion", "expectedDestinationVersion"],
  properties: { ...HIGH_RISK_COMMON, sourceBalanceId: ID, destinationStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] },
    expectedSourceVersion: VERSION, expectedDestinationVersion: EXPECTED_ABSENT }
});
export const REVERSAL_ID_PARAMS = Object.freeze({
  type: "object", additionalProperties: false, required: ["id"],
  properties: { id: { type: "string", pattern: "^[1-9][0-9]*$" } }
});
export const REVERSAL_CREATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "password", "reasonText", "expectedBalances"],
  properties: { source: HIGH_RISK_SOURCE, password: PASSWORD, reasonText: HIGH_RISK_COMMON.reasonText,
    expectedBalances: { type: "array", minItems: 1, maxItems: 200, items: {
      type: "object", additionalProperties: false, required: ["balanceId", "expectedVersion"],
      properties: { balanceId: ID, expectedVersion: VERSION }
    } } }
});
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

export const BIN_MOVE_CREATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "warehouseId", "lines"],
  properties: {
    source: SOURCE, warehouseId: ID,
    reason: { type: "string", trim: true, maxLength: 500, pattern: "^[^\\u0000-\\u001f\\u007f]*$" },
    lines: { type: "array", minItems: 1, maxItems: 100, items: {
      type: "object", additionalProperties: false,
      required: ["sourceBalanceId", "destinationBinId", "quantity", "expectedSourceVersion", "expectedDestinationVersion"],
      properties: {
        sourceBalanceId: ID, destinationBinId: ID, quantity: ID,
        expectedSourceVersion: VERSION,
        expectedDestinationVersion: { type: ["integer", "null"], minimum: 1, maximum: 4_294_967_295 }
      }
    } }
  }
});
export const BIN_MOVE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["status", "operationId", "movementGroupId", "lineCount"],
  properties: { status: { const: "POSTED" }, operationId: ID,
    movementGroupId: { type: "string", minLength: 1, maxLength: 100 },
    lineCount: { type: "integer", minimum: 1, maximum: 100 } }
});
export const REVERSAL_RESPONSE = Object.freeze({ ...BIN_MOVE_RESPONSE,
  properties: { ...BIN_MOVE_RESPONSE.properties, lineCount: { type: "integer", minimum: 1, maximum: 200 } }
});

export const ISSUE_CREATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["source", "reservationId", "version", "lines"],
  properties: {
    source: SOURCE, reservationId: ID, version: VERSION,
    lines: { type: "array", minItems: 1, maxItems: 100, items: {
      type: "object", additionalProperties: false,
      required: ["allocationId", "expectedVersion", "balanceId", "expectedBalanceVersion", "quantity"],
      properties: {
        allocationId: ID, expectedVersion: VERSION, balanceId: ID,
        expectedBalanceVersion: VERSION, quantity: ID
      }
    } }
  }
});
export const ISSUE_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["status", "operationId", "movementGroupId", "reservationId", "version", "quantity", "lines"],
  properties: {
    status: { const: "POSTED" }, operationId: ID,
    movementGroupId: { type: "string", minLength: 1, maxLength: 100 },
    reservationId: ID, version: VERSION, quantity: ID,
    lines: { type: "array", minItems: 1, maxItems: 100, items: {
      type: "object", additionalProperties: false,
      required: ["movementId", "allocationId", "balanceId", "quantity", "allocationVersion", "balanceVersion"],
      properties: {
        movementId: ID, allocationId: ID, balanceId: ID, quantity: ID,
        allocationVersion: VERSION, balanceVersion: VERSION
      }
    } }
  }
});

export const RESERVATION_CREATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["source", "skuId", "warehouseId", "quantity", "purpose", "minimumRemainingDays"],
  properties: {
    source: SOURCE, skuId: ID, warehouseId: ID, quantity: ID,
    purpose: { const: "SALE" },
    minimumRemainingDays: { type: "integer", minimum: 0, maximum: 36_500 }
  }
});

export const RESERVATION_ID_PARAMS = Object.freeze({
  type: "object", additionalProperties: false, required: ["id"], properties: { id: ID }
});
export const RESERVATION_RELEASE = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "version", "quantity"],
  properties: { source: SOURCE, version: VERSION, quantity: ID }
});
export const RESERVATION_CANCEL = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "version"],
  properties: { source: SOURCE, version: VERSION }
});
export const ALLOCATION_CANDIDATES_QUERY = Object.freeze({
  type: "object", additionalProperties: false, required: ["requestedQuantity"],
  properties: { requestedQuantity: ID, page: { type: "integer", minimum: 1, default: 1 } }
});
export const ALLOCATION_CANDIDATES_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["reservationId", "requestedQuantity", "asOf", "reservationVersion", "unallocatedQuantity", "page", "hasMore", "items"],
  properties: {
    reservationId: ID, requestedQuantity: ID, asOf: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    reservationVersion: VERSION, unallocatedQuantity: { type: "integer", minimum: 0 },
    page: ID, hasMore: { type: "boolean" },
    items: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["balanceId", "binId", "lotId", "expiryDate", "firstReceiptDate", "fifoAnchorDate",
        "freeQuantity", "balanceVersion", "selectionStrategy", "rank"],
      properties: {
        balanceId: ID, binId: ID, lotId: { type: ["integer", "null"], minimum: 1 },
        expiryDate: DATE_ONLY, firstReceiptDate: DATE_ONLY, fifoAnchorDate: DATE_ONLY,
        freeQuantity: ID, balanceVersion: VERSION, selectionStrategy: { type: "string", enum: ["FEFO", "FIFO"] }, rank: ID
      }
    } }
  }
});

const ALLOCATION_LINE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["balanceId", "expectedVersion", "quantity"],
  properties: { balanceId: ID, expectedVersion: VERSION, quantity: ID }
});
const ALLOCATION_RELEASE_LINE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["allocationId", "expectedVersion", "quantity"],
  properties: { allocationId: ID, expectedVersion: VERSION, quantity: ID }
});
const ALLOCATION_LINES = Object.freeze({ type: "array", minItems: 1, maxItems: 100, items: ALLOCATION_LINE });
const ALLOCATION_RELEASE_LINES = Object.freeze({ type: "array", minItems: 1, maxItems: 100, items: ALLOCATION_RELEASE_LINE });
export const ALLOCATION_CREATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "version", "allocations"],
  properties: { source: SOURCE, version: VERSION, allocations: ALLOCATION_LINES, overrideReason: REASON }
});
export const ALLOCATION_RELEASE = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "version", "releases"],
  properties: { source: SOURCE, version: VERSION, releases: ALLOCATION_RELEASE_LINES }
});
export const ALLOCATION_REALLOCATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["source", "version", "releases", "allocations"],
  properties: {
    source: SOURCE, version: VERSION, releases: ALLOCATION_RELEASE_LINES,
    allocations: ALLOCATION_LINES, overrideReason: REASON
  }
});
const ALLOCATION_CREATED_RESULT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "balanceId", "quantity", "version", "balanceVersion", "selectionStrategy", "isSequenceOverride"],
  properties: {
    id: ID, balanceId: ID, quantity: ID, version: VERSION, balanceVersion: VERSION,
    selectionStrategy: { type: "string", enum: ["FEFO", "FIFO"] }, isSequenceOverride: { type: "boolean" }
  }
});
const ALLOCATION_RELEASED_RESULT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "balanceId", "quantity", "releasedQuantity", "outstandingQuantity", "status", "version", "balanceVersion"],
  properties: {
    id: ID, balanceId: ID, quantity: ID, releasedQuantity: NON_NEGATIVE_QUANTITY,
    outstandingQuantity: NON_NEGATIVE_QUANTITY,
    status: { type: "string", enum: ["ACTIVE", "PARTIALLY_CONSUMED", "RELEASED"] },
    version: VERSION, balanceVersion: VERSION
  }
});
function allocationResponse(item) {
  return Object.freeze({
    type: "object", additionalProperties: false,
    required: ["reservationId", "operationId", "version", "quantity", "allocations"],
    properties: {
      reservationId: ID, operationId: ID, version: VERSION, quantity: ID,
      allocations: { type: "array", minItems: 1, maxItems: 100, items: item }
    }
  });
}
export const ALLOCATION_CREATE_RESPONSE = allocationResponse(ALLOCATION_CREATED_RESULT);
export const ALLOCATION_RELEASE_RESPONSE = allocationResponse(ALLOCATION_RELEASED_RESULT);

const AVAILABILITY_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["eligibleOnHand", "reserved", "rawAtp", "atp", "uncoveredReserved"],
  properties: {
    eligibleOnHand: NON_NEGATIVE_QUANTITY, reserved: NON_NEGATIVE_QUANTITY,
    rawAtp: SIGNED_QUANTITY, atp: NON_NEGATIVE_QUANTITY, uncoveredReserved: NON_NEGATIVE_QUANTITY
  }
});
export const RESERVATION_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "operationId", "warehouseId", "skuId", "purpose", "minimumRemainingDays",
    "originalQuantity", "consumedQuantity", "releasedQuantity", "outstandingQuantity", "status", "version"],
  properties: {
    id: ID, operationId: ID, warehouseId: ID, skuId: ID, purpose: { const: "SALE" },
    minimumRemainingDays: { type: "integer", minimum: 0, maximum: 36_500 },
    originalQuantity: NON_NEGATIVE_QUANTITY, consumedQuantity: NON_NEGATIVE_QUANTITY,
    releasedQuantity: NON_NEGATIVE_QUANTITY, outstandingQuantity: NON_NEGATIVE_QUANTITY,
    status: { type: "string", enum: [...INVENTORY_RESERVATION_STATUSES] }, version: VERSION,
    availability: AVAILABILITY_RESPONSE
  }
});

export const RESERVATION_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    q: { type: "string", trim: true, maxLength: 190, default: "" },
    warehouseId: ID, skuId: ID,
    sourceModule: { type: "string", minLength: 1, maxLength: 40 },
    sourceDocumentType: { type: "string", minLength: 1, maxLength: 50 },
    sourceDocumentId: { type: "string", minLength: 1, maxLength: 100 },
    status: { type: "string", enum: ["ALL", ...INVENTORY_RESERVATION_STATUSES], default: "ALL" },
    uncovered: { type: "boolean" },
    sortBy: { type: "string", enum: ["updatedAt", "createdAt", "status", "skuCode"], default: "updatedAt" },
    descending: { type: "boolean", default: true }
  }
});
const RESERVATION_INQUIRY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "warehouse", "sku", "source", "purpose", "minimumRemainingDays", "originalQuantity",
    "consumedQuantity", "releasedQuantity", "outstandingQuantity", "status", "version", "createdAt", "updatedAt", "availability"],
  properties: {
    id: ID,
    warehouse: { type: "object", additionalProperties: false, required: ["warehouseId", "code"],
      properties: { warehouseId: ID, code: { type: "string" } } },
    sku: { type: "object", additionalProperties: false, required: ["skuId", "code", "name"],
      properties: { skuId: ID, code: { type: "string" }, name: { type: "string" } } },
    source: SOURCE, purpose: { const: "SALE" },
    minimumRemainingDays: { type: "integer", minimum: 0, maximum: 36_500 },
    originalQuantity: NON_NEGATIVE_QUANTITY, consumedQuantity: NON_NEGATIVE_QUANTITY,
    releasedQuantity: NON_NEGATIVE_QUANTITY, outstandingQuantity: NON_NEGATIVE_QUANTITY,
    status: { type: "string", enum: [...INVENTORY_RESERVATION_STATUSES] }, version: VERSION,
    createdAt: TIMESTAMP, updatedAt: TIMESTAMP, availability: AVAILABILITY_RESPONSE
  }
});
export const RESERVATION_LIST_RESPONSE = listResponse(RESERVATION_INQUIRY);
export const RESERVATION_DETAIL_RESPONSE = Object.freeze({
  ...RESERVATION_INQUIRY,
  required: [...RESERVATION_INQUIRY.required, "allocations"],
  properties: { ...RESERVATION_INQUIRY.properties,
    allocations: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["id", "balanceId", "binId", "lotId", "expiryDate", "allocatedQuantity", "consumedQuantity",
        "releasedQuantity", "outstandingQuantity", "selectionStrategy", "isSequenceOverride", "overrideReason", "status",
        "version", "balanceVersion"],
      properties: {
        id: ID, balanceId: ID, binId: ID, lotId: { type: ["integer", "null"], minimum: 1 }, expiryDate: DATE_ONLY,
        allocatedQuantity: NON_NEGATIVE_QUANTITY, consumedQuantity: NON_NEGATIVE_QUANTITY,
        releasedQuantity: NON_NEGATIVE_QUANTITY, outstandingQuantity: NON_NEGATIVE_QUANTITY,
        selectionStrategy: { type: "string", enum: ["FEFO", "FIFO"] }, isSequenceOverride: { type: "boolean" },
        overrideReason: { type: "string", maxLength: 500 },
        status: { type: "string", enum: [...INVENTORY_ALLOCATION_STATUSES] },
        version: VERSION, balanceVersion: VERSION
      }
    } }
  }
});

const UOM_RESULT = Object.freeze({
  type: "object", additionalProperties: false, required: ["id", "code"],
  properties: { id: ID, code: { type: "string" } }
});
export const ADJUSTMENT_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["status", "operationId", "movementGroupId", "lineCount", "inputQuantity", "inputUom", "baseQuantity", "baseUom"],
  properties: { status: { const: "POSTED" }, operationId: ID, movementGroupId: { type: "string", minLength: 1, maxLength: 100 },
    lineCount: { type: "integer", minimum: 1, maximum: 2 }, inputQuantity: ID, inputUom: UOM_RESULT, baseQuantity: ID, baseUom: UOM_RESULT }
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
export const STOCK_AGGREGATE_LIST_QUERY = Object.freeze({
  ...STOCK_LIST_QUERY,
  properties: {
    ...STOCK_LIST_QUERY.properties,
    sortBy: {
      type: "string",
      enum: ["skuCode", "skuName", "totalOnHand", "availableOnHand"],
      default: "skuCode"
    }
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
export const STOCK_AGGREGATE_LIST_RESPONSE = listResponse(Object.freeze({
  type: "object", additionalProperties: false,
  required: ["sku", "baseUom", ...STOCK_SUMMARY_RESPONSE.required],
  properties: {
    sku: SKU_REF,
    baseUom: BASE_UOM,
    ...STOCK_SUMMARY_RESPONSE.properties
  }
}));
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

const TRANSFER_STATUS = Object.freeze({ type: "string", enum: [...INVENTORY_TRANSFER_STATUSES] });
const TRANSFER_REASON = Object.freeze({ type: "string", trim: true, maxLength: 500 });
export const TRANSFER_ID_PARAMS = MOVEMENT_ID_PARAMS;
export const TRANSFER_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    ...LIST_PAGE, number: { type: "string", maxLength: 100 },
    sourceWarehouseId: ID, destinationWarehouseId: ID,
    status: { type: "string", enum: ["ALL", ...INVENTORY_TRANSFER_STATUSES], default: "ALL" },
    createdFrom: TIMESTAMP, createdTo: TIMESTAMP,
    sortBy: { type: "string", enum: ["updatedAt", "createdAt", "number", "status"], default: "updatedAt" },
    descending: { type: "boolean", default: true }
  }
});
const TRANSFER_DRAFT_LINE = Object.freeze({
  type: "object", additionalProperties: false, required: ["skuId", "sourceBinId", "stockStatus", "quantity"],
  properties: { skuId: ID, lotId: NULLABLE_ID, sourceBinId: ID,
    stockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] }, quantity: ID }
});
export const TRANSFER_CREATE = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "sourceWarehouseId", "destinationWarehouseId", "lines"],
  properties: { source: SOURCE, sourceWarehouseId: ID, destinationWarehouseId: ID, reason: TRANSFER_REASON,
    lines: { type: "array", minItems: 1, maxItems: 100, items: TRANSFER_DRAFT_LINE } }
});
export const TRANSFER_UPDATE = Object.freeze({
  ...TRANSFER_CREATE, required: [...TRANSFER_CREATE.required, "version"],
  properties: { ...TRANSFER_CREATE.properties, version: VERSION,
    lines: { ...TRANSFER_CREATE.properties.lines, items: {
      ...TRANSFER_DRAFT_LINE, dependencies: { id: ["expectedVersion"], expectedVersion: ["id"] },
      properties: { ...TRANSFER_DRAFT_LINE.properties, id: ID, expectedVersion: VERSION }
    } }
  }
});
export const TRANSFER_DISPATCH = Object.freeze({
  type: "object", additionalProperties: false, required: ["source", "version"],
  properties: { source: SOURCE, version: VERSION }
});
export const TRANSFER_CANCEL = Object.freeze({
  ...TRANSFER_DISPATCH, required: [...TRANSFER_DISPATCH.required, "reason"],
  properties: { ...TRANSFER_DISPATCH.properties, reason: { ...TRANSFER_REASON, minLength: 1 } }
});
export const TRANSFER_RECEIVE = Object.freeze({
  ...TRANSFER_DISPATCH, required: [...TRANSFER_DISPATCH.required, "lines"],
  properties: { ...TRANSFER_DISPATCH.properties, reason: TRANSFER_REASON,
    lines: { type: "array", minItems: 1, maxItems: 100, items: {
      type: "object", additionalProperties: false, required: ["id", "quantity", "destinationBinId"],
      properties: { id: ID, quantity: ID, destinationBinId: ID,
        stockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] } }
    } }
  }
});
export const TRANSFER_COMMAND_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["id", "operationId", "status", "version", "rowCount"],
  properties: { id: ID, operationId: ID, status: TRANSFER_STATUS, version: VERSION,
    rowCount: { type: "integer", minimum: 1, maximum: 100 } }
});
const TRANSFER = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "number", "sourceWarehouseId", "destinationWarehouseId", "status", "version", "reason", "inTransitQuantity",
    "createdAt", "updatedAt", "createdBy", "updatedBy", "dispatchedBy", "receivedBy", "cancelledBy", "dispatchedAt", "receivedAt", "cancelledAt"],
  properties: { id: ID, number: { type: "string" }, sourceWarehouseId: ID, destinationWarehouseId: ID,
    status: TRANSFER_STATUS, version: VERSION, reason: { type: "string" }, inTransitQuantity: NONNEGATIVE,
    createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    ...Object.fromEntries(["createdBy", "updatedBy", "dispatchedBy", "receivedBy", "cancelledBy"].map(field => [field, NULLABLE_ID])),
    ...Object.fromEntries(["dispatchedAt", "receivedAt", "cancelledAt"].map(field => [field, { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER }])) }
});
export const TRANSFER_LIST_RESPONSE = listResponse(TRANSFER);
const TRANSFER_LINE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "lineNumber", "skuId", "lotId", "sourceBinId", "destinationBinId", "dispatchStockStatus", "receiveStockStatus",
    "quantity", "inTransitQuantity", "skuCode", "lotNumber", "expiryDate", "dispatchMovementGroupId", "receiveMovementGroupId", "version"],
  properties: { id: ID, lineNumber: ID, skuId: ID, lotId: NULLABLE_ID, sourceBinId: ID, destinationBinId: NULLABLE_ID,
    dispatchStockStatus: { type: "string", enum: [...INVENTORY_STOCK_STATUSES] },
    receiveStockStatus: { type: ["string", "null"], enum: [...INVENTORY_STOCK_STATUSES, null] },
    quantity: ID, inTransitQuantity: NONNEGATIVE, skuCode: { type: "string" }, lotNumber: { type: "string" }, expiryDate: DATE_ONLY,
    dispatchMovementGroupId: { type: ["string", "null"] }, receiveMovementGroupId: { type: ["string", "null"] }, version: VERSION }
});
export const TRANSFER_DETAIL_RESPONSE = Object.freeze({
  ...TRANSFER, required: [...TRANSFER.required, "lines", "movements"],
  properties: { ...TRANSFER.properties, lines: { type: "array", minItems: 1, maxItems: 100, items: TRANSFER_LINE },
    movements: { type: "array", items: MOVEMENT } }
});
