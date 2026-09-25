export const INVENTORY_MASTER_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);
export const INVENTORY_STOCK_STATUSES = Object.freeze(["AVAILABLE", "QUARANTINED", "DAMAGED"]);
export const INVENTORY_RESERVATION_STATUSES = Object.freeze(["ACTIVE", "PARTIALLY_CONSUMED", "CONSUMED", "RELEASED", "CANCELLED"]);
export const INVENTORY_ALLOCATION_STATUSES = Object.freeze(["ACTIVE", "PARTIALLY_CONSUMED", "CONSUMED", "RELEASED"]);
export const INVENTORY_TRANSFER_STATUSES = Object.freeze(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]);
export const INVENTORY_STOCKTAKE_STATUSES = Object.freeze(["DRAFT", "COUNTING", "READY_TO_POST", "POSTED", "CANCELLED"]);
export const INVENTORY_CONTROL_STATUSES = Object.freeze(["PRE_GO_LIVE", "LIVE"]);
export const INVENTORY_OPENING_JOB_STATUSES = Object.freeze(["UPLOADED", "VALIDATING", "READY", "INVALID", "QUEUED", "POSTING", "COMPLETED", "FAILED", "CANCELLED"]);
export const INVENTORY_OPENING_ROW_STATUSES = Object.freeze(["PENDING", "VALID", "INVALID"]);
export const INVENTORY_MOVEMENT_DIRECTIONS = Object.freeze(["IN", "OUT"]);
export const INVENTORY_LOCATION_KINDS = Object.freeze(["BIN", "IN_TRANSIT"]);
export const INVENTORY_SELECTION_STRATEGIES = Object.freeze(["FEFO", "FIFO"]);
export const INVENTORY_AUDIT_OUTCOMES = Object.freeze(["SUCCEEDED", "REJECTED", "FAILED"]);
export const INVENTORY_ADJUSTMENT_REASON_CATEGORIES = Object.freeze(["COUNT_GAIN", "COUNT_LOSS", "DAMAGE", "EXPIRY", "DATA_CORRECTION", "TRANSFER_VARIANCE", "OTHER"]);

export const INVENTORY_AUDIT_ACTIONS = Object.freeze([
  "warehouse.create", "warehouse.update", "warehouse.deactivate", "warehouse.reactivate", "warehouse.delete",
  "bin.create", "bin.update", "bin.deactivate", "bin.reactivate", "bin.delete",
  "receipt.post", "issue.post", "bin_move.post", "status_transfer.post", "adjustment.post", "movement.reverse",
  "reservation.create", "reservation.release", "reservation.cancel", "reservation.consume",
  "allocation.create", "allocation.release", "allocation.reallocate", "fefo.override",
  "transfer.create", "transfer.update", "transfer.cancel", "transfer.dispatch", "transfer.receive",
  "stocktake.create", "stocktake.update", "stocktake.start", "stocktake.count", "stocktake.add_line", "stocktake.ready", "stocktake.post", "stocktake.cancel",
  "opening.upload", "opening.precheck", "opening.confirm", "opening.post", "opening.cancel",
  "inventory.go_live", "inventory.export"
]);

export const INVENTORY_COMMAND_TYPES = Object.freeze(
  INVENTORY_AUDIT_ACTIONS.map((action) => action.replaceAll(".", "_").toUpperCase())
);
