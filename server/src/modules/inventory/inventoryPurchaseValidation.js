import { inventoryOperationHash } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import { inventoryStringHasInvalidCharacters } from "./inventorySafeJson.js";
import { inventoryPositiveInteger, validateInventoryLotInput, validateInventoryStockStatus } from "./inventoryValidation.js";

function fields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: label });
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw inventoryError("INVENTORY_INPUT_INVALID", { field: `${label}.${key}` });
  }
}

function text(value, field, min, max, ascii = false) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < min ||
      Buffer.byteLength(value, "utf8") > max || inventoryStringHasInvalidCharacters(value, ascii)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return value;
}

export function purchaseSourceId(value, field) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return value;
}

function days(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return value;
}

function claims(value, field) {
  if (!Array.isArray(value)) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  const result = value.map(entry => text(entry, field, 1, 100, true));
  if (new Set(result).size !== result.length) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return result;
}

function commitment(input, skuId) {
  fields(input, ["purchaseOrderId", "purchaseOrderLineId", "confirmedVersion", "skuId", "inventoryTrackedSnapshot",
    "trackingPolicySnapshot", "baseUomIdSnapshot", "baseUomCodeSnapshot", "minimumReceiptLifeDaysSnapshot",
    "skuExceptionReason"], "commitment");
  if (input.skuId !== skuId || input.inventoryTrackedSnapshot !== true) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "commitment" });
  }
  return {
    purchaseOrderId: inventoryPositiveInteger(input.purchaseOrderId, "purchaseOrderId"),
    purchaseOrderLineId: inventoryPositiveInteger(input.purchaseOrderLineId, "purchaseOrderLineId"),
    confirmedVersion: inventoryPositiveInteger(input.confirmedVersion, "confirmedVersion"),
    skuId, inventoryTrackedSnapshot: true, trackingPolicySnapshot: input.trackingPolicySnapshot,
    baseUomIdSnapshot: inventoryPositiveInteger(input.baseUomIdSnapshot, "baseUomIdSnapshot"),
    baseUomCodeSnapshot: text(input.baseUomCodeSnapshot, "baseUomCodeSnapshot", 1, 100),
    minimumReceiptLifeDaysSnapshot: input.minimumReceiptLifeDaysSnapshot == null ? null
      : days(input.minimumReceiptLifeDaysSnapshot, "minimumReceiptLifeDaysSnapshot"),
    skuExceptionReason: input.skuExceptionReason == null ? null : text(input.skuExceptionReason, "skuExceptionReason", 5, 500)
  };
}

function receiptLine(input) {
  fields(input, ["sourceLineId", "skuId", "baseQuantity", "warehouseId", "binId", "lotNumber", "expiryDate",
    "manufactureDate", "stockStatus", "commitment", "minimumLifeEvidence"], "line");
  const skuId = inventoryPositiveInteger(input.skuId, "skuId");
  const snapshot = commitment(input.commitment, skuId);
  const lot = validateInventoryLotInput({ trackingPolicy: snapshot.trackingPolicySnapshot,
    lotNumber: input.lotNumber, expiryDate: input.expiryDate, manufactureDate: input.manufactureDate });
  let minimumLifeEvidence = null;
  if (input.minimumLifeEvidence != null) {
    const evidence = input.minimumLifeEvidence;
    fields(evidence, ["reason", "minimumLifeDaysApplied", "actualRemainingLifeDays"], "minimumLifeEvidence");
    minimumLifeEvidence = {
      reason: text(evidence.reason, "reason", 5, 500),
      minimumLifeDaysApplied: days(evidence.minimumLifeDaysApplied, "minimumLifeDaysApplied"),
      actualRemainingLifeDays: days(evidence.actualRemainingLifeDays, "actualRemainingLifeDays")
    };
  }
  return {
    sourceLineId: purchaseSourceId(input.sourceLineId, "sourceLineId"), skuId,
    baseQuantity: inventoryPositiveInteger(input.baseQuantity, "baseQuantity"),
    warehouseId: inventoryPositiveInteger(input.warehouseId, "warehouseId"),
    binId: inventoryPositiveInteger(input.binId, "binId"),
    lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, manufactureDate: lot.manufactureDate,
    stockStatus: validateInventoryStockStatus(input.stockStatus), commitment: snapshot, minimumLifeEvidence
  };
}

export function normalizePurchaseReceipt(input) {
  fields(input, ["context", "actor", "correlationId", "source", "lines"], "command");
  fields(input.actor, ["userId", "serviceName", "claimedRoles", "claimedPermissions"], "actor");
  fields(input.source, ["documentId", "eventId"], "source");
  const actor = {
    userId: inventoryPositiveInteger(input.actor.userId, "actor.userId"),
    serviceName: text(input.actor.serviceName, "serviceName", 0, 0),
    claimedRoles: claims(input.actor.claimedRoles, "claimedRoles"),
    claimedPermissions: claims(input.actor.claimedPermissions, "claimedPermissions")
  };
  if (!["purchasing.view", "receiving.operation"].every(permission => actor.claimedPermissions.includes(permission))) {
    throw inventoryError("PERMISSION_STALE");
  }
  if (typeof input.source.eventId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.source.eventId)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "eventId" });
  }
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 200) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  }
  const lines = input.lines.map(receiptLine), identities = new Set(), dimensions = new Set(), lots = new Map();
  for (const line of lines) {
    const dimension = JSON.stringify([line.commitment.purchaseOrderId, line.commitment.purchaseOrderLineId,
      line.skuId, line.warehouseId, line.binId, line.lotNumber, line.stockStatus]);
    if (identities.has(line.sourceLineId) || dimensions.has(dimension)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
    }
    identities.add(line.sourceLineId); dimensions.add(dimension);
    if (line.lotNumber !== null) {
      const key = JSON.stringify([line.skuId, line.lotNumber]);
      const dates = JSON.stringify([line.expiryDate, line.manufactureDate]);
      if (lots.has(key) && lots.get(key) !== dates) throw inventoryError("LOT_DATA_CONFLICT");
      lots.set(key, dates);
    }
  }
  return { actor, correlationId: text(input.correlationId, "correlationId", 0, 64, true),
    source: { documentId: purchaseSourceId(input.source.documentId, "documentId"), eventId: input.source.eventId }, lines };
}

export function purchaseReceiptBusinessPayload(command) {
  return {
    purpose: "purchase.receipt", source: command.source,
    lines: [...command.lines].sort((a, b) => Number(a.sourceLineId) - Number(b.sourceLineId))
  };
}

export function purchaseReceiptBusinessHash(command) {
  return inventoryOperationHash({ commandType: "PURCHASE_RECEIPT_BATCH", payload: purchaseReceiptBusinessPayload(command) });
}

export function normalizePurchaseReversal(input) {
  fields(input, ["context", "actor", "correlationId", "source", "goodsReceiptId", "reasonText", "lines"], "command");
  fields(input.actor, ["userId", "serviceName", "claimedRoles", "claimedPermissions"], "actor");
  fields(input.source, ["documentId", "eventId"], "source");
  const actor = { userId: inventoryPositiveInteger(input.actor.userId, "actor.userId"),
    serviceName: text(input.actor.serviceName, "serviceName", 0, 0),
    claimedRoles: claims(input.actor.claimedRoles, "claimedRoles"),
    claimedPermissions: claims(input.actor.claimedPermissions, "claimedPermissions") };
  if (!["purchasing.view", "inventory.adjust"].every(permission => actor.claimedPermissions.includes(permission))) {
    throw inventoryError("PERMISSION_STALE");
  }
  if (typeof input.source.eventId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.source.eventId)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "eventId" });
  }
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 200) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  }
  const details = new Set(), originals = new Set();
  const lines = Array.from(input.lines, line => {
    fields(line, ["sourceLineId", "originalSourceLineId", "originalMovementId", "baseQuantity"], "line");
    const result = { sourceLineId: purchaseSourceId(line.sourceLineId, "sourceLineId"),
      originalSourceLineId: purchaseSourceId(line.originalSourceLineId, "originalSourceLineId"),
      originalMovementId: inventoryPositiveInteger(line.originalMovementId, "originalMovementId"),
      baseQuantity: inventoryPositiveInteger(line.baseQuantity, "baseQuantity") };
    if (details.has(result.sourceLineId) || originals.has(result.originalMovementId)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
    }
    details.add(result.sourceLineId); originals.add(result.originalMovementId);
    return result;
  });
  return { actor, correlationId: text(input.correlationId, "correlationId", 0, 64, true),
    source: { documentId: purchaseSourceId(input.source.documentId, "documentId"), eventId: input.source.eventId },
    goodsReceiptId: purchaseSourceId(input.goodsReceiptId, "goodsReceiptId"),
    reasonText: text(typeof input.reasonText === "string" ? input.reasonText.trim() : input.reasonText, "reasonText", 5, 500), lines };
}

export function purchaseReversalBusinessPayload(command) {
  return { purpose: "purchase.reverse", source: command.source, goodsReceiptId: command.goodsReceiptId,
    reasonText: command.reasonText, lines: [...command.lines].sort((a, b) => Number(a.sourceLineId) - Number(b.sourceLineId)) };
}

export function purchaseReversalBusinessHash(command) {
  return inventoryOperationHash({ commandType: "PURCHASE_REVERSE_BATCH", payload: purchaseReversalBusinessPayload(command) });
}
