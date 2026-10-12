import { inventoryError } from "./inventoryErrors.js";
import { inventoryPositiveInteger } from "./inventoryValidation.js";

export function transferTransition(state, action) {
  if (state === "DRAFT") {
    if (action === "edit") return "DRAFT";
    if (action === "dispatch") return "IN_TRANSIT";
    if (action === "cancel") return "CANCELLED";
  }
  if (state === "IN_TRANSIT" && action === "receive") return "RECEIVED";
  throw inventoryError("TRANSFER_STATE_CONFLICT");
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function assertTransferWarehouses(sourceWarehouseId, destinationWarehouseId) {
  if (!positiveId(sourceWarehouseId) || !positiveId(destinationWarehouseId) ||
      sourceWarehouseId === destinationWarehouseId) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "warehouses" });
  }
}

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  for (const line of lines) {
    if (!line || typeof line !== "object" || Array.isArray(line) || !positiveId(line.id)) {
      throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lineId" });
    }
    inventoryPositiveInteger(line.quantity);
  }
}

export function assertCompleteTransferLines(expectedLines, submittedLines) {
  validateLines(expectedLines);
  validateLines(submittedLines);
  const expected = new Map(expectedLines.map((line) => [line.id, line.quantity]));
  if (expected.size !== expectedLines.length) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "lines" });
  const submittedIds = new Set(submittedLines.map((line) => line.id));
  if (submittedLines.length !== expected.size || submittedIds.size !== expected.size ||
      submittedLines.some((line) => expected.get(line.id) !== line.quantity)) {
    throw inventoryError("TRANSFER_PARTIAL_NOT_SUPPORTED");
  }
}
