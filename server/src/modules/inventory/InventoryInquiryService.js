import { InventoryOperationService } from "./InventoryOperationService.js";
import { INVENTORY_RESERVATION_STATUSES, INVENTORY_TRANSFER_STATUSES } from "./inventoryConstants.js";
import { inventoryError } from "./inventoryErrors.js";
import {
  movementProjection,
  stockBucketProjection,
  stockSummaryProjection
} from "./inventoryProjections.js";
import {
  calculateInventoryAvailability,
  inventoryRemainingLifeDays,
  isInventoryLotExpired
} from "./inventoryValidation.js";

const STOCK_SORTS = Object.freeze({
  skuCode: "s.sku_code",
  skuName: "s.sku_name",
  warehouse: "w.warehouse_code",
  bin: "bn.bin_code",
  lot: "l.normalized_lot_number",
  expiryDate: "l.expiry_date",
  stockStatus: "b.stock_status",
  onHand: "b.on_hand_quantity",
  available: "(b.on_hand_quantity - b.allocated_quantity)"
});
const STOCK_AGGREGATE_SORTS = Object.freeze({
  skuCode: "s.sku_code",
  skuName: "s.sku_name",
  totalOnHand: "total_on_hand",
  availableOnHand: "available_on_hand"
});
const LOT_SORTS = Object.freeze({
  skuCode: "s.sku_code",
  lot: "l.normalized_lot_number",
  expiryDate: "l.expiry_date",
  firstReceiptDate: "l.first_receipt_date"
});
const STOCK_STATUSES = new Set(["AVAILABLE", "QUARANTINED", "DAMAGED"]);
const AVAILABILITY_FILTERS = new Set(["ALL", "IN_STOCK", "NO_STOCK", "ZERO_ATP"]);
const EXPIRY_STATES = new Set(["ALL", "UNEXPIRED", "EXPIRED", "WITHIN_DAYS"]);
const RESERVATION_STATUSES = new Set(INVENTORY_RESERVATION_STATUSES);
const TRANSFER_STATUSES = new Set(INVENTORY_TRANSFER_STATUSES);
const TRANSFER_SORTS = Object.freeze({ updatedAt: "t.updated_at", createdAt: "t.created_at",
  number: "t.transfer_number", status: "t.status" });
const RESERVATION_SORTS = Object.freeze({
  updatedAt: "v.updated_at", createdAt: "v.created_at", status: "v.status", skuCode: "v.sku_code"
});

const RESERVATION_VIEW = `
  WITH reservation_base AS (
    SELECT r.*, w.warehouse_code, s.sku_code, s.sku_name,
           o.source_module, o.source_document_type, o.source_document_id,
           o.source_line_id, o.source_event_id,
           COALESCE(c.reserved_quantity, 0) AS reserved_quantity,
           (SELECT COALESCE(SUM(b.on_hand_quantity), 0)
              FROM inventory_stock_balances b
              LEFT JOIN inventory_lots l ON l.id = b.lot_id
             WHERE b.warehouse_id = r.warehouse_id AND b.sku_id = r.sku_id
               AND b.stock_status = 'AVAILABLE'
               AND (l.expiry_date IS NULL OR l.expiry_date >= DATE_ADD(?, INTERVAL r.minimum_remaining_days DAY)))
             AS eligible_on_hand
      FROM inventory_reservations r
      JOIN inventory_warehouses w ON w.id = r.warehouse_id
      JOIN item_skus s ON s.id = r.sku_id
      JOIN inventory_operation_requests o ON o.id = r.create_operation_id
      LEFT JOIN inventory_stock_controls c ON c.warehouse_id = r.warehouse_id AND c.sku_id = r.sku_id
  ), reservation_view AS (
    SELECT reservation_base.*,
           GREATEST(reserved_quantity - eligible_on_hand, 0) AS uncovered_reserved
      FROM reservation_base
  )`;

const STOCK_FROM = `
  FROM inventory_stock_balances b
  JOIN inventory_warehouses w ON w.id = b.warehouse_id
  JOIN inventory_bins bn ON bn.id = b.bin_id AND bn.warehouse_id = b.warehouse_id
  JOIN item_skus s ON s.id = b.sku_id
  JOIN item_sku_uoms su ON su.sku_id = s.id AND su.is_base = 1
  JOIN item_uoms u ON u.id = su.uom_id
  LEFT JOIN inventory_lots l ON l.id = b.lot_id AND l.sku_id = b.sku_id
  LEFT JOIN inventory_stock_controls c ON c.warehouse_id = b.warehouse_id AND c.sku_id = b.sku_id`;

const STOCK_SELECT = `
  SELECT b.*, w.warehouse_code, w.warehouse_name, bn.bin_code, bn.bin_name,
         s.sku_code, s.sku_name, l.lot_number,
         DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS expiry_date,
         DATE_FORMAT(l.manufacture_date, '%Y-%m-%d') AS manufacture_date,
         su.uom_id AS base_uom_id, u.code AS base_uom_code`;

const MOVEMENT_SELECT = `
  SELECT m.*, DATE_FORMAT(m.expiry_date_snapshot, '%Y-%m-%d') AS expiry_date_snapshot,
         o.source_module, o.source_document_type, o.source_document_id,
         o.source_line_id, o.source_event_id, reversed.id AS reversed_by_movement_id
    FROM inventory_movements m
    JOIN inventory_operation_requests o ON o.id = m.operation_request_id
    LEFT JOIN inventory_movements reversed ON reversed.reversal_of_movement_id = m.id`;

function invalid(field) {
  throw inventoryError("INVENTORY_INPUT_INVALID", { field });
}

function positiveId(value, field, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) invalid(field);
  return normalized;
}

function nonNegativeInteger(value, field, defaultValue = 0) {
  const normalized = Number(value ?? defaultValue);
  if (!Number.isSafeInteger(normalized) || normalized < 0) invalid(field);
  return normalized;
}

function boundedText(value, field, max, { optional = true, ascii = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > max || /[\p{Cc}]/u.test(normalized) ||
      (ascii && /[^\x20-\x7e]/u.test(normalized))) invalid(field);
  return normalized;
}

function dateOnly(value, field, { optional = true } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) invalid(field);
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) invalid(field);
  return value;
}

function addDays(value, days) {
  const milliseconds = Date.parse(`${dateOnly(value, "currentDate", { optional: false })}T00:00:00.000Z`);
  if (days > Math.floor((Number.MAX_SAFE_INTEGER - milliseconds) / 86_400_000)) invalid("withinDays");
  return new Date(milliseconds + days * 86_400_000).toISOString().slice(0, 10);
}

function pageInput(input, sorts, defaultSort) {
  const page = positiveId(input.page ?? 1, "page");
  const pageSize = positiveId(input.pageSize ?? 20, "pageSize");
  if (pageSize > 100 || page - 1 > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) invalid("page");
  const sortBy = input.sortBy ?? defaultSort;
  if (!Object.hasOwn(sorts, sortBy) ||
      (input.descending !== undefined && typeof input.descending !== "boolean")) invalid("sortBy");
  return {
    page,
    pageSize,
    sortColumn: sorts[sortBy],
    direction: input.descending ? "DESC" : "ASC",
    offset: (page - 1) * pageSize
  };
}

function escapeLike(value) {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
}

function normalizedBarcode(value) {
  const digits = value.replace(/[ -]/gu, "");
  return /^\d+$/u.test(digits) ? digits : value;
}

function whereClause(filters) {
  return filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
}

function stockFilters(input, currentDate) {
  const filters = [];
  const params = [];
  const search = boundedText(input.q, "q", 190);
  const addId = (field, column) => {
    const id = positiveId(input[field], field, { optional: true });
    if (id !== null) { filters.push(`${column} = ?`); params.push(id); }
  };
  addId("warehouseId", "b.warehouse_id");
  addId("binId", "b.bin_id");
  addId("skuId", "b.sku_id");
  if (input.lot) {
    filters.push("l.normalized_lot_number LIKE ? ESCAPE '!'");
    params.push(`%${escapeLike(boundedText(input.lot, "lot", 100))}%`);
  }
  const expiryFrom = dateOnly(input.expiryFrom, "expiryFrom");
  const expiryTo = dateOnly(input.expiryTo, "expiryTo");
  if (expiryFrom && expiryTo && expiryFrom > expiryTo) invalid("expiryFrom");
  if (expiryFrom) { filters.push("l.expiry_date >= ?"); params.push(expiryFrom); }
  if (expiryTo) { filters.push("l.expiry_date <= ?"); params.push(expiryTo); }
  const status = input.status ?? "ALL";
  if (status !== "ALL" && !STOCK_STATUSES.has(status)) invalid("status");
  if (status !== "ALL") { filters.push("b.stock_status = ?"); params.push(status); }
  const expiryState = input.expiryState ?? "ALL";
  if (!EXPIRY_STATES.has(expiryState)) invalid("expiryState");
  const withinDays = nonNegativeInteger(input.withinDays, "withinDays", 30);
  if (withinDays > 36_500) invalid("withinDays");
  if (expiryState === "EXPIRED") { filters.push("l.expiry_date IS NOT NULL AND l.expiry_date < ?"); params.push(currentDate); }
  if (expiryState === "UNEXPIRED") { filters.push("(l.expiry_date IS NULL OR l.expiry_date >= ?)"); params.push(currentDate); }
  if (expiryState === "WITHIN_DAYS") {
    filters.push("l.expiry_date >= ? AND l.expiry_date <= ?");
    params.push(currentDate, addDays(currentDate, withinDays));
  }
  const availability = input.availability ?? "ALL";
  if (!AVAILABILITY_FILTERS.has(availability)) invalid("availability");
  if (availability === "IN_STOCK") filters.push("b.on_hand_quantity > 0");
  if (availability === "NO_STOCK") filters.push("b.on_hand_quantity = 0");
  if (availability === "ZERO_ATP") {
    filters.push(`(SELECT COALESCE(SUM(b2.on_hand_quantity), 0)
                     FROM inventory_stock_balances b2
                     LEFT JOIN inventory_lots l2 ON l2.id = b2.lot_id
                    WHERE b2.warehouse_id = b.warehouse_id AND b2.sku_id = b.sku_id
                      AND b2.stock_status = 'AVAILABLE'
                      AND (l2.expiry_date IS NULL OR l2.expiry_date >= ?)) <= COALESCE(c.reserved_quantity, 0)`);
    params.push(currentDate);
  }
  if (search) {
    filters.push(`(s.sku_code = ? OR EXISTS (
      SELECT 1 FROM item_sku_barcodes barcode
       WHERE barcode.sku_id = s.id AND barcode.normalized_barcode = ?
    ) OR s.sku_name LIKE ? ESCAPE '!')`);
    params.push(search, normalizedBarcode(search), `%${escapeLike(search)}%`);
  }
  return { filters, params, search };
}

function projectStock(row, currentDate) {
  const bucket = stockBucketProjection({
    ...row,
    is_expired: row.expiry_date === null ? false : isInventoryLotExpired(row.expiry_date, currentDate)
  });
  return {
    balanceId: bucket.balanceId,
    warehouse: { warehouseId: bucket.warehouseId, code: row.warehouse_code, name: row.warehouse_name },
    bin: { binId: bucket.binId, code: row.bin_code, name: row.bin_name ?? null },
    sku: { skuId: bucket.skuId, code: row.sku_code, name: row.sku_name },
    lot: bucket.lotId === null ? null : {
      lotId: bucket.lotId,
      number: row.lot_number,
      expiryDate: row.expiry_date ?? null,
      manufactureDate: row.manufacture_date ?? null
    },
    stockStatus: bucket.stockStatus,
    isExpired: bucket.isExpired,
    onHand: bucket.onHand,
    allocated: bucket.allocated,
    bucketFree: bucket.bucketFree,
    baseUom: bucket.baseUom,
    version: bucket.version
  };
}

function projectReservation(row) {
  return {
    id: positiveId(row.id, "reservationId"),
    warehouse: { warehouseId: positiveId(row.warehouse_id, "warehouseId"), code: row.warehouse_code },
    sku: { skuId: positiveId(row.sku_id, "skuId"), code: row.sku_code, name: row.sku_name },
    source: {
      module: row.source_module, documentType: row.source_document_type,
      documentId: row.source_document_id, lineId: row.source_line_id, eventId: row.source_event_id
    },
    purpose: row.purpose, minimumRemainingDays: nonNegativeInteger(row.minimum_remaining_days, "minimumRemainingDays"),
    originalQuantity: nonNegativeInteger(row.original_quantity, "originalQuantity"),
    consumedQuantity: nonNegativeInteger(row.consumed_quantity, "consumedQuantity"),
    releasedQuantity: nonNegativeInteger(row.released_quantity, "releasedQuantity"),
    outstandingQuantity: nonNegativeInteger(row.outstanding_quantity, "outstandingQuantity"),
    status: row.status, version: positiveId(row.version, "version"),
    createdAt: nonNegativeInteger(row.created_at, "createdAt"),
    updatedAt: nonNegativeInteger(row.updated_at, "updatedAt"),
    availability: calculateInventoryAvailability({
      eligibleOnHand: nonNegativeInteger(row.eligible_on_hand, "eligibleOnHand"),
      reserved: nonNegativeInteger(row.reserved_quantity, "reserved")
    })
  };
}

function projectTransfer(row) {
  const result = {
    id: positiveId(row.id, "transferId"), number: row.transfer_number,
    sourceWarehouseId: positiveId(row.source_warehouse_id, "sourceWarehouseId"),
    destinationWarehouseId: positiveId(row.destination_warehouse_id, "destinationWarehouseId"),
    status: row.status, version: positiveId(row.version, "version"), reason: row.reason,
    inTransitQuantity: nonNegativeInteger(row.in_transit_quantity, "inTransitQuantity"),
    createdAt: nonNegativeInteger(row.created_at, "createdAt"),
    updatedAt: nonNegativeInteger(row.updated_at, "updatedAt")
  };
  for (const [field, column] of [["createdBy", "created_by"], ["updatedBy", "updated_by"],
    ["dispatchedBy", "dispatched_by"], ["receivedBy", "received_by"], ["cancelledBy", "cancelled_by"]]) {
    result[field] = positiveId(row[column], field, { optional: true });
  }
  for (const [field, column] of [["dispatchedAt", "dispatched_at"], ["receivedAt", "received_at"], ["cancelledAt", "cancelled_at"]]) {
    result[field] = row[column] == null ? null : nonNegativeInteger(row[column], field);
  }
  return result;
}

function projectTransferLine(row) {
  return {
    id: positiveId(row.id, "lineId"), lineNumber: positiveId(row.line_number, "lineNumber"),
    skuId: positiveId(row.sku_id, "skuId"), lotId: positiveId(row.lot_id, "lotId", { optional: true }),
    sourceBinId: positiveId(row.source_bin_id, "sourceBinId"),
    destinationBinId: positiveId(row.destination_bin_id, "destinationBinId", { optional: true }),
    dispatchStockStatus: row.dispatch_stock_status, receiveStockStatus: row.receive_stock_status,
    quantity: positiveId(row.quantity, "quantity"), inTransitQuantity: nonNegativeInteger(row.in_transit_quantity, "inTransitQuantity"),
    skuCode: row.sku_code_snapshot, lotNumber: row.lot_number_snapshot, expiryDate: row.expiry_date_snapshot ?? null,
    dispatchMovementGroupId: row.dispatch_movement_group_id ?? null,
    receiveMovementGroupId: row.receive_movement_group_id ?? null, version: positiveId(row.version, "version")
  };
}

function sourceProjection(row) {
  return {
    module: row.source_module,
    documentType: row.source_document_type,
    documentId: row.source_document_id,
    lineId: row.source_line_id,
    eventId: row.source_event_id
  };
}

function projectMovement(row) {
  return {
    ...movementProjection(row),
    operationId: positiveId(row.operation_request_id, "operationId"),
    source: sourceProjection(row)
  };
}

function notFound() {
  return inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
}

function projectStocktakeCountLine(row) {
  const missing = Number(row.is_not_found);
  const counted = row.counted_quantity === null ? null : nonNegativeInteger(row.counted_quantity, "countedQuantity");
  if (![0, 1].includes(missing) || (missing === 1 && counted !== null) || !STOCK_STATUSES.has(row.stock_status)) {
    throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  }
  return { id: positiveId(row.id, "lineId"), stocktakeId: positiveId(row.stocktake_id, "stocktakeId"),
    stocktakeBinId: positiveId(row.stocktake_bin_id, "stocktakeBinId"), balanceId: positiveId(row.stock_balance_id, "balanceId", { optional: true }),
    binId: positiveId(row.bin_id, "binId"), skuId: positiveId(row.sku_id, "skuId"), lotId: positiveId(row.lot_id, "lotId", { optional: true }),
    stockStatus: row.stock_status, snapshotQuantity: nonNegativeInteger(row.snapshot_quantity, "snapshotQuantity"),
    snapshotBalanceVersion: nonNegativeInteger(row.snapshot_balance_version, "snapshotBalanceVersion"), countedQuantity: counted,
    notFound: missing === 1, actualQuantity: missing === 1 ? 0 : counted, version: positiveId(row.version, "version"),
    countedAt: row.counted_at === null ? null : nonNegativeInteger(row.counted_at, "countedAt"), countedBy: positiveId(row.counted_by, "countedBy", { optional: true }) };
}

export function stocktakeVarianceStage(header) {
  if (header.status === "DRAFT") return "NOT_STARTED";
  if (header.status === "COUNTING") return "PREVIEW";
  if (["READY_TO_POST", "POSTED"].includes(header.status)) return "FROZEN";
  if (header.status === "CANCELLED") return header.ready_at != null ? "FROZEN" : header.started_at != null ? "PREVIEW" : "NOT_STARTED";
  throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
}

function stocktakeInteger(value, { signed = false, positive = false } = {}) {
  const number = Number(value);
  if (value == null || !["number", "string"].includes(typeof value) || (typeof value === "string" && !/^-?(0|[1-9][0-9]*)$/u.test(value)) ||
      !Number.isSafeInteger(number) || (!signed && number < 0) || (positive && number <= 0)) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  return number;
}

export function projectStocktakeLine(row, header) {
  const stage = stocktakeVarianceStage(header), missing = stocktakeInteger(row.is_not_found);
  const snapshot = stocktakeInteger(row.snapshot_quantity), counted = row.counted_quantity === null ? null : stocktakeInteger(row.counted_quantity);
  const actual = missing === 1 ? 0 : counted;
  if (![0, 1].includes(missing) || (missing === 1 && counted !== null) || !STOCK_STATUSES.has(row.stock_status) ||
      stocktakeInteger(row.stocktake_id, { positive: true }) !== stocktakeInteger(header.id, { positive: true })) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  const variance = stage === "FROZEN" ? stocktakeInteger(row.variance_quantity, { signed: true }) : actual === null ? null : actual - snapshot;
  if ((stage === "FROZEN" && (actual === null || variance !== actual - snapshot)) ||
      (stage !== "FROZEN" && row.variance_quantity !== null)) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  const result = { id: stocktakeInteger(row.id, { positive: true }), stocktakeId: Number(header.id),
    stocktakeBinId: stocktakeInteger(row.stocktake_bin_id, { positive: true }), binId: stocktakeInteger(row.bin_id, { positive: true }),
    skuId: stocktakeInteger(row.sku_id, { positive: true }), lotId: row.lot_id === null ? null : stocktakeInteger(row.lot_id, { positive: true }),
    stockStatus: row.stock_status, snapshotBalanceId: row.stock_balance_id === null ? null : stocktakeInteger(row.stock_balance_id, { positive: true }),
    snapshotQuantity: snapshot, snapshotBalanceVersion: stocktakeInteger(row.snapshot_balance_version), countedQuantity: counted,
    actualQuantity: actual, notFound: missing === 1, countState: missing === 1 ? "NOT_FOUND" : counted === null ? "UNCOUNTED" : "COUNTED",
    varianceQuantity: variance, varianceStage: stage, cancelled: header.status === "CANCELLED", version: stocktakeInteger(row.version, { positive: true }),
    movementId: row.movement_id === null ? null : stocktakeInteger(row.movement_id, { positive: true }),
    countedAt: row.counted_at === null ? null : stocktakeInteger(row.counted_at), countedBy: row.counted_by === null ? null : stocktakeInteger(row.counted_by, { positive: true }),
    binCodeSnapshot: row.bin_code_snapshot, binCodeCurrent: row.bin_code, skuCodeCurrent: row.sku_code, skuNameCurrent: row.sku_name,
    lotNumberCurrent: row.lot_number ?? null, baseUom: { uomId: stocktakeInteger(row.base_uom_id, { positive: true }), uomCode: row.base_uom_code } };
  if (result.version > 4294967295 || result.snapshotBalanceVersion > 4294967295) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  return result;
}

const STOCKTAKE_LINE_FROM = `FROM inventory_stocktake_lines l
  JOIN inventory_stocktake_bins scope ON scope.id=l.stocktake_bin_id AND scope.stocktake_id=l.stocktake_id AND scope.bin_id=l.bin_id
  JOIN inventory_bins bin ON bin.id=l.bin_id
  JOIN item_skus sku ON sku.id=l.sku_id
  JOIN item_sku_uoms su ON su.sku_id=l.sku_id AND su.is_base=1
  JOIN item_uoms u ON u.id=su.uom_id
  LEFT JOIN inventory_lots lot ON lot.id=l.lot_id AND lot.sku_id=l.sku_id`;
const STOCKTAKE_LINE_SELECT = `SELECT l.*,scope.bin_code_snapshot,bin.bin_code,sku.sku_code,sku.sku_name,
  lot.lot_number,su.uom_id AS base_uom_id,u.code AS base_uom_code ${STOCKTAKE_LINE_FROM}`;
const STOCKTAKE_ACTUAL = "CASE WHEN l.is_not_found=1 THEN 0 ELSE CAST(l.counted_quantity AS SIGNED) END";
const STOCKTAKE_DIFFERENCE = `(${STOCKTAKE_ACTUAL} - CAST(l.snapshot_quantity AS SIGNED))`;
const STOCKTAKE_SUMMARY_FIELDS = ["totalLines", "countedLines", "notFoundLines", "uncountedLines", "gainLines", "lossLines", "zeroLines"];

export function stocktakeLineFilters(input, header) {
  const filters = ["l.stocktake_id = ?"], params = [positiveId(header.id, "stocktakeId")];
  if (input.q !== undefined) {
    if (typeof input.q !== "string" || [...input.q].length > 190 || Buffer.byteLength(input.q, "utf8") > 760 || /\p{Cc}/u.test(input.q)) invalid("q");
    const q = input.q.trim();
    if (q) {
      const pattern = "%" + q.replace(/[!%_]/gu, "!$&") + "%";
      // Correlate inside owned candidates so keyset batches and summaries share the same filter.
      filters.push("EXISTS (SELECT 1 FROM item_skus lookup_sku WHERE lookup_sku.id=l.sku_id AND (lookup_sku.sku_code LIKE ? ESCAPE '!' OR lookup_sku.sku_name LIKE ? ESCAPE '!'))");
      params.push(pattern, pattern);
    }
  }
  for (const [field, column] of [["binId", "bin_id"], ["skuId", "sku_id"], ["lotId", "lot_id"]]) {
    const value = positiveId(input[field], field, { optional: true });
    if (value !== null) { filters.push(`l.${column} = ?`); params.push(value); }
  }
  const stockStatus = input.stockStatus ?? "ALL", progress = input.progress ?? "ALL", variance = input.variance ?? "ALL";
  if (stockStatus !== "ALL" && !STOCK_STATUSES.has(stockStatus)) invalid("stockStatus");
  if (stockStatus !== "ALL") { filters.push("l.stock_status = ?"); params.push(stockStatus); }
  const states = { ALL: "", COUNTED: "l.counted_quantity IS NOT NULL AND l.is_not_found=0",
    NOT_FOUND: "l.is_not_found=1", UNCOUNTED: "l.counted_quantity IS NULL AND l.is_not_found=0" };
  if (typeof progress !== "string" || !Object.hasOwn(states, progress)) invalid("progress");
  if (states[progress]) filters.push(states[progress]);
  const signs = { ALL: "", GAIN: "> 0", LOSS: "< 0", ZERO: "= 0" };
  if (typeof variance !== "string" || !Object.hasOwn(signs, variance)) invalid("variance");
  const expression = stocktakeVarianceStage(header) === "FROZEN" ? "l.variance_quantity" : STOCKTAKE_DIFFERENCE;
  if (signs[variance]) filters.push(`${expression} ${signs[variance]}`);
  return { clause: " WHERE " + filters.join(" AND "), params };
}

export async function stocktakeLineBatch(tx, header, input, afterId, limit = 500) {
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) invalid("cursor");
  const { clause, params } = stocktakeLineFilters(input, header);
  // Bound owned line candidates before display joins; LIMIT prevents derived-table merging.
  // Joining/sorting the full remaining stocktake for every keyset page is unbounded database work.
  const candidates = `SELECT * FROM inventory_stocktake_lines l${clause} AND l.id>? ORDER BY l.id ASC LIMIT ?`;
  const select = STOCKTAKE_LINE_SELECT.replace("FROM inventory_stocktake_lines l", `FROM (${candidates}) l`);
  const [rows] = await tx.query(`${select} ORDER BY l.id ASC`, [...params, afterId, limit]);
  if (rows.length > limit) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  return rows.map(row => projectStocktakeLine(row, header));
}

export async function stocktakeSummary(tx, header, input = {}) {
  const { clause, params } = stocktakeLineFilters(input, header), stage = stocktakeVarianceStage(header);
  const variance = stage === "FROZEN" ? "l.variance_quantity" : STOCKTAKE_DIFFERENCE;
  const consistency = stage === "FROZEN"
    ? `(${STOCKTAKE_ACTUAL} IS NULL OR l.variance_quantity IS NULL OR l.variance_quantity <> ${STOCKTAKE_DIFFERENCE})`
    : "l.variance_quantity IS NOT NULL";
  const [[row]] = await tx.query(`SELECT COUNT(*) AS totalLines,
    COALESCE(SUM(l.counted_quantity IS NOT NULL AND l.is_not_found=0),0) AS countedLines,
    COALESCE(SUM(l.is_not_found=1),0) AS notFoundLines,
    COALESCE(SUM(l.counted_quantity IS NULL AND l.is_not_found=0),0) AS uncountedLines,
    COALESCE(SUM(${variance}>0),0) AS gainLines,COALESCE(SUM(${variance}<0),0) AS lossLines,COALESCE(SUM(${variance}=0),0) AS zeroLines,
    COALESCE(SUM(l.is_not_found NOT IN (0,1) OR (l.is_not_found=1 AND l.counted_quantity IS NOT NULL)
      OR l.counted_quantity>9007199254740991 OR l.snapshot_quantity>9007199254740991 OR ${consistency}),0) AS corruptLines
    FROM inventory_stocktake_lines l${clause}`, params);
  if (!row || stocktakeInteger(row.corruptLines) || (stage === "NOT_STARTED" && stocktakeInteger(row.totalLines))) throw inventoryError("STOCKTAKE_SNAPSHOT_MISMATCH");
  return Object.fromEntries(STOCKTAKE_SUMMARY_FIELDS.map(field => [field, stocktakeInteger(row[field])]));
}

export class InventoryInquiryService {
  constructor({ database, time, operationService } = {}) {
    if (!database || typeof database.query !== "function" || !time || typeof time.fileDate !== "function") {
      throw new TypeError("InventoryInquiryService requires database and time services");
    }
    this.database = database;
    this.time = time;
    this.operationService = operationService ?? new InventoryOperationService();
  }

  async listStocktakes(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid("query");
    for (const field of Object.keys(input)) if (!["warehouseId", "binId", "status", "dateFrom", "dateTo", "page", "pageSize"].includes(field)) invalid(field);
    const { page, pageSize, offset } = pageInput(input, { id: "t.id" }, "id"), filters = [], params = [];
    const warehouseId = positiveId(input.warehouseId, "warehouseId", { optional: true }), binId = positiveId(input.binId, "binId", { optional: true });
    if (warehouseId !== null) { filters.push("t.warehouse_id=?"); params.push(warehouseId); }
    if (binId !== null) { filters.push("EXISTS (SELECT 1 FROM inventory_stocktake_bins scope WHERE scope.stocktake_id=t.id AND scope.bin_id=?)"); params.push(binId); }
    const status = input.status ?? "ALL";
    if (typeof status !== "string" || !["ALL", "DRAFT", "COUNTING", "READY_TO_POST", "POSTED", "CANCELLED"].includes(status)) invalid("status");
    if (status !== "ALL") { filters.push("t.status=?"); params.push(status); }
    const from = dateOnly(input.dateFrom, "dateFrom"), to = dateOnly(input.dateTo, "dateTo");
    if (from && to && from > to) invalid("dateFrom");
    // Find the first millisecond of the company-local calendar day without assuming a fixed UTC offset.
    const boundary = day => {
      const utc = Date.parse(`${day}T00:00:00Z`); let low = utc - 86400000, high = utc + 86400000;
      while (high - low > 1) { const mid = low + Math.floor((high - low) / 2);
        if (this.time.fileDate(new Date(mid)) < day) low = mid; else high = mid; }
      return high;
    };
    if (from) { filters.push("t.created_at>=?"); params.push(boundary(from)); }
    if (to) { filters.push("t.created_at<?"); params.push(boundary(addDays(to, 1))); }
    const clause = whereClause(filters);
    return this.database.withTransaction(async tx => {
      const asOf = nonNegativeInteger(this.time.nowMs(), "asOf");
      const [[count]] = await tx.query(`SELECT COUNT(*) AS total FROM inventory_stocktakes t${clause}`, params);
      const [rows] = await tx.query(`SELECT t.* FROM inventory_stocktakes t${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
      return { items: rows.map(header => {
        stocktakeVarianceStage(header);
        return { id: stocktakeInteger(header.id, { positive: true }), number: header.stocktake_number,
          warehouseId: stocktakeInteger(header.warehouse_id, { positive: true }), status: header.status, version: stocktakeInteger(header.version, { positive: true }),
          reason: header.reason, createdAt: stocktakeInteger(header.created_at), updatedAt: stocktakeInteger(header.updated_at),
          startedAt: header.started_at == null ? null : stocktakeInteger(header.started_at), readyAt: header.ready_at == null ? null : stocktakeInteger(header.ready_at),
          postedAt: header.posted_at == null ? null : stocktakeInteger(header.posted_at), cancelledAt: header.cancelled_at == null ? null : stocktakeInteger(header.cancelled_at) };
      }), total: stocktakeInteger(count.total), page, pageSize, asOf };
    }, { isolationLevel: "REPEATABLE READ" });
  }

  async listStocktakeLines(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid("query");
    for (const field of Object.keys(input)) if (!["stocktakeId", "page", "pageSize", "q", "binId", "skuId", "lotId", "stockStatus", "progress", "variance"].includes(field)) invalid(field);
    const id = positiveId(input.stocktakeId, "stocktakeId"), { page, pageSize, offset } = pageInput(input, { id: "l.id" }, "id");
    return this.database.withTransaction(async tx => {
      const asOf = nonNegativeInteger(this.time.nowMs(), "asOf");
      const [[header]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [id]);
      if (!header) throw notFound();
      const globalSummary = await stocktakeSummary(tx, header), filteredSummary = await stocktakeSummary(tx, header, input);
      const { clause, params } = stocktakeLineFilters(input, header);
      const [rows] = await tx.query(`${STOCKTAKE_LINE_SELECT}${clause} ORDER BY l.id ASC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
      return { id, status: header.status, version: stocktakeInteger(header.version, { positive: true }), asOf,
        varianceStage: stocktakeVarianceStage(header), cancelled: header.status === "CANCELLED", items: rows.map(row => projectStocktakeLine(row, header)),
        total: filteredSummary.totalLines, page, pageSize, globalSummary, filteredSummary };
    }, { isolationLevel: "REPEATABLE READ" });
  }

  async getStocktake(stocktakeId, input = {}) {
    const id = positiveId(stocktakeId, "stocktakeId");
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid("query");
    for (const field of Object.keys(input)) if (!["scopePage", "scopePageSize"].includes(field)) invalid(field);
    const { page, pageSize, offset } = pageInput({ page: input.scopePage, pageSize: input.scopePageSize }, { id: "scope.id" }, "id");
    return this.database.withTransaction(async tx => {
      const asOf = nonNegativeInteger(this.time.nowMs(), "asOf");
      const [[header]] = await tx.query("SELECT * FROM inventory_stocktakes WHERE id = ?", [id]);
      if (!header) throw notFound();
      const summary = await stocktakeSummary(tx, header);
      const [[count]] = await tx.query("SELECT COUNT(*) AS total FROM inventory_stocktake_bins WHERE stocktake_id = ?", [id]);
      const [scopes] = await tx.query(`SELECT scope.*,bin.bin_code,bin.status FROM inventory_stocktake_bins scope
        JOIN inventory_bins bin ON bin.id=scope.bin_id WHERE scope.stocktake_id = ? ORDER BY scope.id ASC LIMIT ? OFFSET ?`, [id, pageSize, offset]);
      return { id, number: header.stocktake_number, warehouseId: stocktakeInteger(header.warehouse_id, { positive: true }), status: header.status,
        version: stocktakeInteger(header.version, { positive: true }), reason: header.reason, asOf, varianceStage: stocktakeVarianceStage(header), cancelled: header.status === "CANCELLED",
        createdAt: stocktakeInteger(header.created_at), updatedAt: stocktakeInteger(header.updated_at),
        startedAt: header.started_at == null ? null : stocktakeInteger(header.started_at), readyAt: header.ready_at == null ? null : stocktakeInteger(header.ready_at),
        postedAt: header.posted_at == null ? null : stocktakeInteger(header.posted_at), cancelledAt: header.cancelled_at == null ? null : stocktakeInteger(header.cancelled_at),
        scope: { items: scopes.map(row => ({ id: stocktakeInteger(row.id, { positive: true }), binId: stocktakeInteger(row.bin_id, { positive: true }),
          binCodeSnapshot: row.bin_code_snapshot, binCodeCurrent: row.bin_code, statusCurrent: row.status })), total: stocktakeInteger(count.total), page, pageSize },
        progress: { totalLines: summary.totalLines, countedLines: summary.countedLines, notFoundLines: summary.notFoundLines, uncountedLines: summary.uncountedLines }, varianceSummary: summary };
    }, { isolationLevel: "REPEATABLE READ" });
  }

  async listStocktakeCountLines(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid("query");
    for (const field of Object.keys(input)) if (!["stocktakeId", "page", "pageSize", "progress"].includes(field)) invalid(field);
    const stocktakeId = positiveId(input.stocktakeId, "stocktakeId");
    const { page, pageSize, offset } = pageInput(input, { id: "id" }, "id");
    const progress = input.progress ?? "ALL";
    const filters = { ALL: "", UNCOUNTED: "counted_quantity IS NULL AND is_not_found = 0",
      COUNTED: "counted_quantity IS NOT NULL AND is_not_found = 0", NOT_FOUND: "is_not_found = 1" };
    if (typeof progress !== "string" || !Object.hasOwn(filters, progress)) invalid("progress");
    if (typeof this.database.withTransaction !== "function") throw new TypeError("Stocktake progress requires transactional database");
    return this.database.withTransaction(async tx => {
      const [[header]] = await tx.query("SELECT id,status,version FROM inventory_stocktakes WHERE id = ?", [stocktakeId]);
      if (!header) throw notFound();
      const [[totals]] = await tx.query(`SELECT COUNT(*) AS totalLines,
        COALESCE(SUM(counted_quantity IS NOT NULL AND is_not_found = 0),0) AS countedLines,
        COALESCE(SUM(is_not_found = 1),0) AS notFoundLines,
        COALESCE(SUM(counted_quantity IS NULL AND is_not_found = 0),0) AS uncountedLines
        FROM inventory_stocktake_lines WHERE stocktake_id = ?`, [stocktakeId]);
      const summary = Object.fromEntries(["totalLines", "countedLines", "notFoundLines", "uncountedLines"].map(field => [field, nonNegativeInteger(totals[field], field)]));
      const [rows] = await tx.query(`SELECT * FROM inventory_stocktake_lines WHERE stocktake_id = ?${filters[progress] ? " AND " + filters[progress] : ""}
        ORDER BY id ASC LIMIT ? OFFSET ?`, [stocktakeId, pageSize, offset]);
      const countKey = { ALL: "totalLines", UNCOUNTED: "uncountedLines", COUNTED: "countedLines", NOT_FOUND: "notFoundLines" }[progress];
      return { id: positiveId(header.id, "stocktakeId"), status: header.status, version: positiveId(header.version, "version"),
        items: rows.map(projectStocktakeCountLine), total: summary[countKey], page, pageSize, summary };
    });
  }

  async listTransfers(input = {}) {
    const { page, pageSize, sortColumn, direction, offset } = pageInput(input, TRANSFER_SORTS, "updatedAt");
    const filters = [], params = [];
    for (const [field, column] of [["sourceWarehouseId", "t.source_warehouse_id"], ["destinationWarehouseId", "t.destination_warehouse_id"]]) {
      const value = positiveId(input[field], field, { optional: true });
      if (value !== null) { filters.push(`${column} = ?`); params.push(value); }
    }
    const number = boundedText(input.number, "number", 100);
    if (number) { filters.push("t.transfer_number LIKE ? ESCAPE '!'"); params.push(`%${escapeLike(number)}%`); }
    const status = input.status ?? "ALL";
    if (status !== "ALL" && !TRANSFER_STATUSES.has(status)) invalid("status");
    if (status !== "ALL") { filters.push("t.status = ?"); params.push(status); }
    // Like Movement postedFrom/postedTo, internal time filters are epoch milliseconds.
    // The future HTTP/UI boundary owns company-timezone calendar conversion.
    const from = nonNegativeInteger(input.createdFrom, "createdFrom");
    const to = input.createdTo == null ? null : nonNegativeInteger(input.createdTo, "createdTo");
    if (to !== null && from > to) invalid("createdFrom");
    if (input.createdFrom !== undefined) { filters.push("t.created_at >= ?"); params.push(from); }
    if (to !== null) { filters.push("t.created_at <= ?"); params.push(to); }
    const clause = whereClause(filters);
    const [[count]] = await this.database.query(`SELECT COUNT(*) AS total FROM inventory_transfers t${clause}`, params);
    const [rows] = await this.database.query(`SELECT t.*,
      (SELECT COALESCE(SUM(l.in_transit_quantity), 0) FROM inventory_transfer_lines l WHERE l.transfer_id = t.id) AS in_transit_quantity
      FROM inventory_transfers t${clause} ORDER BY ${sortColumn} ${direction}, t.id ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]);
    return { items: rows.map(projectTransfer), total: nonNegativeInteger(count.total, "total"), page, pageSize };
  }

  async getTransfer(transferId) {
    const id = positiveId(transferId, "transferId");
    if (typeof this.database.withTransaction !== "function") throw new TypeError("Transfer detail requires transactional database");
    // Read header, full child set and history from the same consistent transaction snapshot.
    return this.database.withTransaction(async (tx) => {
      const [[header]] = await tx.query("SELECT * FROM inventory_transfers WHERE id = ?", [id]);
      if (!header) throw notFound();
      const [rows] = await tx.query(`SELECT *, DATE_FORMAT(expiry_date_snapshot, '%Y-%m-%d') AS expiry_date_snapshot
        FROM inventory_transfer_lines WHERE transfer_id = ? ORDER BY line_number, id`, [id]);
      const lines = rows.map(projectTransferLine);
      const inTransitQuantity = nonNegativeInteger(lines.reduce((sum, line) => sum + line.inTransitQuantity, 0), "inTransitQuantity");
      const [movements] = await tx.query(`${MOVEMENT_SELECT} WHERE m.transfer_id = ? ORDER BY m.posted_at, m.id`, [id]);
      return { ...projectTransfer({ ...header, in_transit_quantity: inTransitQuantity }), lines, movements: movements.map(projectMovement) };
    });
  }

  async listReservations(input = {}) {
    const { page, pageSize, sortColumn, direction, offset } = pageInput(input, RESERVATION_SORTS, "updatedAt");
    const filters = [];
    const params = [];
    for (const [field, column] of [["warehouseId", "v.warehouse_id"], ["skuId", "v.sku_id"]]) {
      const id = positiveId(input[field], field, { optional: true });
      if (id !== null) { filters.push(`${column} = ?`); params.push(id); }
    }
    for (const [field, column, length] of [
      ["sourceModule", "v.source_module", 40],
      ["sourceDocumentType", "v.source_document_type", 50],
      ["sourceDocumentId", "v.source_document_id", 100]
    ]) {
      const value = boundedText(input[field], field, length, { ascii: field !== "sourceDocumentId" });
      if (value) { filters.push(`${column} = ?`); params.push(value); }
    }
    const status = input.status ?? "ALL";
    if (status !== "ALL" && !RESERVATION_STATUSES.has(status)) invalid("status");
    if (status !== "ALL") { filters.push("v.status = ?"); params.push(status); }
    if (input.uncovered !== undefined && typeof input.uncovered !== "boolean") invalid("uncovered");
    if (input.uncovered === true) filters.push("v.uncovered_reserved > 0");
    if (input.uncovered === false) filters.push("v.uncovered_reserved = 0");
    const q = boundedText(input.q, "q", 190);
    if (q) {
      filters.push("(v.sku_code LIKE ? ESCAPE '!' OR v.sku_name LIKE ? ESCAPE '!' OR v.source_document_id LIKE ? ESCAPE '!')");
      params.push(...Array(3).fill(`%${escapeLike(q)}%`));
    }
    const clause = whereClause(filters);
    const currentDate = this.time.fileDate();
    const [[count]] = await this.database.query(
      `${RESERVATION_VIEW} SELECT COUNT(*) AS total FROM reservation_view v${clause}`,
      [currentDate, ...params]
    );
    const [rows] = await this.database.query(
      `${RESERVATION_VIEW} SELECT * FROM reservation_view v${clause}
        ORDER BY ${sortColumn} ${direction}, v.id ${direction} LIMIT ? OFFSET ?`,
      [currentDate, ...params, pageSize, offset]
    );
    return { items: rows.map(projectReservation), total: Number(count.total), page, pageSize };
  }

  async getReservation(reservationId) {
    const id = positiveId(reservationId, "reservationId");
    const [rows] = await this.database.query(
      `${RESERVATION_VIEW} SELECT * FROM reservation_view v WHERE v.id = ?`,
      [this.time.fileDate(), id]
    );
    if (!rows[0]) throw notFound();
    const [allocations] = await this.database.query(
      `SELECT a.*, b.bin_id, b.lot_id, b.version AS balance_version,
              DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS expiry_date
         FROM inventory_allocations a
         JOIN inventory_stock_balances b ON b.id = a.stock_balance_id
         LEFT JOIN inventory_lots l ON l.id = b.lot_id
        WHERE a.reservation_id = ? ORDER BY a.id`,
      [id]
    );
    return { ...projectReservation(rows[0]), allocations: allocations.map((row) => ({
      id: positiveId(row.id, "allocationId"), balanceId: positiveId(row.stock_balance_id, "balanceId"),
      binId: positiveId(row.bin_id, "binId"), lotId: positiveId(row.lot_id, "lotId", { optional: true }),
      expiryDate: row.expiry_date ?? null,
      allocatedQuantity: nonNegativeInteger(row.allocated_quantity, "allocatedQuantity"),
      consumedQuantity: nonNegativeInteger(row.consumed_quantity, "consumedQuantity"),
      releasedQuantity: nonNegativeInteger(row.released_quantity, "releasedQuantity"),
      outstandingQuantity: nonNegativeInteger(row.outstanding_quantity, "outstandingQuantity"),
      selectionStrategy: row.selection_strategy, isSequenceOverride: Boolean(row.is_sequence_override),
      overrideReason: row.override_reason, status: row.status,
      version: positiveId(row.version, "version"), balanceVersion: positiveId(row.balance_version, "balanceVersion")
    })) };
  }

  async listStocks(input = {}) {
    const currentDate = this.time.fileDate();
    const { page, pageSize, sortColumn, direction, offset } = pageInput(input, STOCK_SORTS, "skuCode");
    const { filters, params, search } = stockFilters(input, currentDate);
    const clause = whereClause(filters);
    const [[count]] = await this.database.query(`SELECT COUNT(*) AS total${STOCK_FROM}${clause}`, params);
    const rank = search ? `, CASE WHEN s.sku_code = ? OR EXISTS (
      SELECT 1 FROM item_sku_barcodes barcode
       WHERE barcode.sku_id = s.id AND barcode.normalized_barcode = ?
    ) THEN 0 ELSE 1 END AS search_rank` : "";
    const order = `${search ? "search_rank ASC, " : ""}${sortColumn} ${direction}, b.id ${direction}`;
    const [rows] = await this.database.query(
      `${STOCK_SELECT}${rank}${STOCK_FROM}${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...(search ? [search, normalizedBarcode(search)] : []), ...params, pageSize, offset]
    );
    return { items: rows.map((row) => projectStock(row, currentDate)), total: Number(count.total), page, pageSize };
  }

  async listStockAggregates(input = {}) {
    const currentDate = this.time.fileDate();
    const { page, pageSize, sortColumn, direction, offset } = pageInput(input, STOCK_AGGREGATE_SORTS, "skuCode");
    const { filters, params, search } = stockFilters(input, currentDate);
    const warehouseId = positiveId(input.warehouseId, "warehouseId", { optional: true });
    const clause = whereClause(filters);
    const [[count]] = await this.database.query(
      `SELECT COUNT(DISTINCT b.sku_id) AS total${STOCK_FROM}${clause}`,
      params
    );
    const rank = search ? `, CASE WHEN s.sku_code = ? OR EXISTS (
      SELECT 1 FROM item_sku_barcodes barcode
       WHERE barcode.sku_id = s.id AND barcode.normalized_barcode = ?
    ) THEN 0 ELSE 1 END AS search_rank` : "";
    const reservedWarehouse = warehouseId === null ? "" : " AND c2.warehouse_id = ?";
    const order = `${search ? "search_rank ASC, " : ""}${sortColumn} ${direction}, b.sku_id ${direction}`;
    const [rows] = await this.database.query(
      `SELECT b.sku_id, s.sku_code, s.sku_name, su.uom_id AS base_uom_id, u.code AS base_uom_code,
              COALESCE(SUM(b.on_hand_quantity), 0) AS total_on_hand,
              COALESCE(SUM(CASE WHEN b.stock_status = 'AVAILABLE' THEN b.on_hand_quantity ELSE 0 END), 0) AS available_on_hand,
              COALESCE(SUM(CASE WHEN b.stock_status = 'AVAILABLE'
                                  AND (l.expiry_date IS NULL OR l.expiry_date >= ?)
                                THEN b.on_hand_quantity ELSE 0 END), 0) AS eligible_on_hand,
              (SELECT COALESCE(SUM(c2.reserved_quantity), 0)
                 FROM inventory_stock_controls c2
                WHERE c2.sku_id = b.sku_id${reservedWarehouse}) AS reserved_quantity,
              COALESCE(SUM(CASE WHEN b.stock_status = 'QUARANTINED' THEN b.on_hand_quantity ELSE 0 END), 0) AS quarantined_quantity,
              COALESCE(SUM(CASE WHEN b.stock_status = 'DAMAGED' THEN b.on_hand_quantity ELSE 0 END), 0) AS damaged_quantity
              ${rank}
         ${STOCK_FROM}${clause}
        GROUP BY b.sku_id, s.sku_code, s.sku_name, su.uom_id, u.code
        ORDER BY ${order} LIMIT ? OFFSET ?`,
      [currentDate, ...(warehouseId === null ? [] : [warehouseId]),
        ...(search ? [search, normalizedBarcode(search)] : []), ...params, pageSize, offset]
    );
    return {
      items: rows.map((row) => {
        const summary = stockSummaryProjection({
          ...row,
          atp: Math.max(Number(row.eligible_on_hand) - Number(row.reserved_quantity), 0),
          uncovered_reserved: Math.max(Number(row.reserved_quantity) - Number(row.eligible_on_hand), 0),
          in_transit_quantity: 0
        });
        return {
          sku: { skuId: positiveId(row.sku_id, "skuId"), code: row.sku_code, name: row.sku_name },
          baseUom: { uomId: positiveId(row.base_uom_id, "baseUomId"), uomCode: row.base_uom_code },
          ...summary
        };
      }),
      total: Number(count.total), page, pageSize
    };
  }

  async getStock(balanceId) {
    const id = positiveId(balanceId, "balanceId");
    const [rows] = await this.database.query(`${STOCK_SELECT}${STOCK_FROM} WHERE b.id = ?`, [id]);
    if (!rows[0]) throw notFound();
    const stock = projectStock(rows[0], this.time.fileDate());
    const [movements] = await this.database.query(
      `${MOVEMENT_SELECT}
        WHERE m.warehouse_id = ? AND m.bin_id = ? AND m.sku_id = ?
          AND (m.lot_id <=> ?) AND m.stock_status = ?
        ORDER BY m.posted_at DESC, m.id DESC LIMIT 20`,
      [stock.warehouse.warehouseId, stock.bin.binId, stock.sku.skuId, stock.lot?.lotId ?? null, stock.stockStatus]
    );
    // ponytail: allocation rows arrive with migration 0061; the current Balance total is the only truthful pre-0061 summary.
    return { ...stock, allocationSummary: { allocated: stock.allocated }, recentMovements: movements.map(projectMovement) };
  }

  async getStockSummary(input = {}) {
    const skuId = positiveId(input.skuId, "skuId");
    const warehouseId = positiveId(input.warehouseId, "warehouseId", { optional: true });
    boundedText(input.purpose, "purpose", 40, { ascii: true });
    const minimumRemainingDays = nonNegativeInteger(input.minimumRemainingDays, "minimumRemainingDays");
    if (minimumRemainingDays > 36_500) invalid("minimumRemainingDays");
    const currentDate = this.time.fileDate();
    const cutoff = addDays(currentDate, minimumRemainingDays);
    const warehouseControl = warehouseId === null ? "" : " AND c.warehouse_id = ?";
    const warehouseBalance = warehouseId === null ? "" : " AND b.warehouse_id = ?";
    const params = [cutoff, skuId, ...(warehouseId === null ? [] : [warehouseId]), skuId,
      ...(warehouseId === null ? [] : [warehouseId])];
    const [[row]] = await this.database.query(
      `SELECT COALESCE(SUM(b.on_hand_quantity), 0) AS total_on_hand,
              COALESCE(SUM(CASE WHEN b.stock_status = 'AVAILABLE' THEN b.on_hand_quantity ELSE 0 END), 0) AS available_on_hand,
              COALESCE(SUM(CASE WHEN b.stock_status = 'AVAILABLE'
                                  AND (l.expiry_date IS NULL OR l.expiry_date >= ?)
                                THEN b.on_hand_quantity ELSE 0 END), 0) AS eligible_on_hand,
              (SELECT COALESCE(SUM(c.reserved_quantity), 0) FROM inventory_stock_controls c
                WHERE c.sku_id = ?${warehouseControl}) AS reserved_quantity,
              COALESCE(SUM(CASE WHEN b.stock_status = 'QUARANTINED' THEN b.on_hand_quantity ELSE 0 END), 0) AS quarantined_quantity,
              COALESCE(SUM(CASE WHEN b.stock_status = 'DAMAGED' THEN b.on_hand_quantity ELSE 0 END), 0) AS damaged_quantity
         FROM inventory_stock_balances b
         LEFT JOIN inventory_lots l ON l.id = b.lot_id
        WHERE b.sku_id = ?${warehouseBalance}`,
      params
    );
    const availability = calculateInventoryAvailability({
      eligibleOnHand: Number(row.eligible_on_hand),
      reserved: Number(row.reserved_quantity)
    });
    return stockSummaryProjection({
      ...row,
      eligible_on_hand: availability.eligibleOnHand,
      reserved_quantity: availability.reserved,
      atp: availability.atp,
      uncovered_reserved: availability.uncoveredReserved,
      // ponytail: replace with active transfer-line aggregation when migration 0062 introduces that current-state table.
      in_transit_quantity: 0
    });
  }

  async listLots(input = {}) {
    const currentDate = this.time.fileDate();
    const { page, pageSize, sortColumn, direction, offset } = pageInput(input, LOT_SORTS, "lot");
    const filters = [];
    const params = [];
    const skuId = positiveId(input.skuId, "skuId", { optional: true });
    const warehouseId = positiveId(input.warehouseId, "warehouseId", { optional: true });
    if (skuId !== null) { filters.push("l.sku_id = ?"); params.push(skuId); }
    if (warehouseId !== null) { filters.push("b.warehouse_id = ?"); params.push(warehouseId); }
    if (input.lot) { filters.push("l.normalized_lot_number LIKE ? ESCAPE '!'"); params.push(`%${escapeLike(boundedText(input.lot, "lot", 100))}%`); }
    const status = input.status ?? "ALL";
    if (status !== "ALL" && !STOCK_STATUSES.has(status)) invalid("status");
    if (status !== "ALL") { filters.push("b.stock_status = ?"); params.push(status); }
    const expiryFrom = dateOnly(input.expiryFrom, "expiryFrom");
    const expiryTo = dateOnly(input.expiryTo, "expiryTo");
    if (expiryFrom && expiryTo && expiryFrom > expiryTo) invalid("expiryFrom");
    if (expiryFrom) { filters.push("l.expiry_date >= ?"); params.push(expiryFrom); }
    if (expiryTo) { filters.push("l.expiry_date <= ?"); params.push(expiryTo); }
    const expiryState = input.expiryState ?? "ALL";
    if (!EXPIRY_STATES.has(expiryState)) invalid("expiryState");
    const withinDays = nonNegativeInteger(input.withinDays, "withinDays", 30);
    if (withinDays > 36_500) invalid("withinDays");
    if (expiryState === "EXPIRED") { filters.push("l.expiry_date < ?"); params.push(currentDate); }
    if (expiryState === "UNEXPIRED") { filters.push("(l.expiry_date IS NULL OR l.expiry_date >= ?)"); params.push(currentDate); }
    if (expiryState === "WITHIN_DAYS") {
      filters.push("l.expiry_date >= ? AND l.expiry_date <= ?");
      params.push(currentDate, addDays(currentDate, withinDays));
    }
    const from = ` FROM inventory_lots l
      JOIN item_skus s ON s.id = l.sku_id
      JOIN item_sku_uoms su ON su.sku_id = s.id AND su.is_base = 1
      JOIN item_uoms u ON u.id = su.uom_id
      LEFT JOIN inventory_stock_balances b ON b.lot_id = l.id AND b.sku_id = l.sku_id`;
    const clause = whereClause(filters);
    const [[count]] = await this.database.query(`SELECT COUNT(DISTINCT l.id) AS total${from}${clause}`, params);
    const [rows] = await this.database.query(
      `SELECT l.id, l.sku_id, s.sku_code, s.sku_name, l.lot_number,
              DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS expiry_date,
              DATE_FORMAT(l.manufacture_date, '%Y-%m-%d') AS manufacture_date,
              DATE_FORMAT(l.first_receipt_date, '%Y-%m-%d') AS first_receipt_date,
              su.uom_id AS base_uom_id,
              u.code AS base_uom_code, COALESCE(SUM(b.on_hand_quantity), 0) AS total_on_hand,
              COALESCE(SUM(CASE WHEN b.stock_status = 'AVAILABLE' THEN b.on_hand_quantity ELSE 0 END), 0) AS available_on_hand,
              COALESCE(SUM(CASE WHEN b.stock_status = 'QUARANTINED' THEN b.on_hand_quantity ELSE 0 END), 0) AS quarantined_quantity,
              COALESCE(SUM(CASE WHEN b.stock_status = 'DAMAGED' THEN b.on_hand_quantity ELSE 0 END), 0) AS damaged_quantity
         ${from}${clause}
        GROUP BY l.id, l.sku_id, s.sku_code, s.sku_name, l.lot_number, l.normalized_lot_number,
                 l.expiry_date, l.manufacture_date, l.first_receipt_date, su.uom_id, u.code
        ORDER BY ${sortColumn} ${direction}, l.id ${direction} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return {
      items: rows.map((row) => ({
        lotId: positiveId(row.id, "lotId"),
        sku: { skuId: positiveId(row.sku_id, "skuId"), code: row.sku_code, name: row.sku_name },
        lotNumber: row.lot_number,
        expiryDate: row.expiry_date ?? null,
        manufactureDate: row.manufacture_date ?? null,
        firstReceiptDate: row.first_receipt_date,
        isExpired: row.expiry_date === null ? false : isInventoryLotExpired(row.expiry_date, currentDate),
        remainingLifeDays: row.expiry_date === null ? null : inventoryRemainingLifeDays(row.expiry_date, currentDate),
        totalOnHand: nonNegativeInteger(row.total_on_hand, "totalOnHand"),
        availableOnHand: nonNegativeInteger(row.available_on_hand, "availableOnHand"),
        quarantined: nonNegativeInteger(row.quarantined_quantity, "quarantined"),
        damaged: nonNegativeInteger(row.damaged_quantity, "damaged"),
        baseUom: { uomId: positiveId(row.base_uom_id, "baseUomId"), uomCode: row.base_uom_code }
      })),
      total: Number(count.total), page, pageSize
    };
  }

  listExpiry(input = {}) {
    return this.listLots({ ...input, expiryState: input.expiryState ?? "EXPIRED" });
  }

  async listMovements(input = {}) {
    const page = positiveId(input.page ?? 1, "page");
    const pageSize = positiveId(input.pageSize ?? 20, "pageSize");
    if (pageSize > 100 || page - 1 > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) invalid("page");
    const offset = (page - 1) * pageSize;
    const filters = [];
    const params = [];
    const addId = (field, column) => {
      const id = positiveId(input[field], field, { optional: true });
      if (id !== null) { filters.push(`${column} = ?`); params.push(id); }
    };
    addId("skuId", "m.sku_id");
    addId("warehouseId", "m.warehouse_id");
    addId("binId", "m.bin_id");
    addId("lotId", "m.lot_id");
    addId("actorId", "m.posted_by");
    const postedFrom = nonNegativeInteger(input.postedFrom, "postedFrom", 0);
    const postedTo = input.postedTo === undefined ? null : nonNegativeInteger(input.postedTo, "postedTo");
    if (postedTo !== null && postedFrom > postedTo) invalid("postedFrom");
    if (input.postedFrom !== undefined) { filters.push("m.posted_at >= ?"); params.push(postedFrom); }
    if (postedTo !== null) { filters.push("m.posted_at <= ?"); params.push(postedTo); }
    let sourceFilter = false;
    for (const [field, column, max, ascii] of [
      ["movementType", "m.movement_type", 40, true],
      ["sourceModule", "o.source_module", 40, true],
      ["sourceDocumentType", "o.source_document_type", 50, true],
      ["sourceDocumentId", "o.source_document_id", 100, false]
    ]) {
      const value = boundedText(input[field], field, max, { ascii });
      if (value) {
        filters.push(`${column} = ?`);
        params.push(value);
        sourceFilter ||= column.startsWith("o.");
      }
    }
    const clause = whereClause(filters);
    const from = ` FROM inventory_movements m JOIN inventory_operation_requests o ON o.id = m.operation_request_id`;
    const countFrom = sourceFilter ? from : " FROM inventory_movements m";
    const [[count]] = await this.database.query(`SELECT COUNT(*) AS total${countFrom}${clause}`, params);
    const [rows] = await this.database.query(
      `${MOVEMENT_SELECT}${clause} ORDER BY m.posted_at DESC, m.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return { items: rows.map(projectMovement), total: Number(count.total), page, pageSize };
  }

  async getMovement(movementId) {
    const id = positiveId(movementId, "movementId");
    const [rows] = await this.database.query(`${MOVEMENT_SELECT} WHERE m.id = ?`, [id]);
    if (!rows[0]) throw notFound();
    const [groupRows] = await this.database.query(
      `${MOVEMENT_SELECT} WHERE m.movement_group_id = ? ORDER BY m.id ASC`,
      [rows[0].movement_group_id]
    );
    return {
      movement: projectMovement(rows[0]),
      groupLegs: groupRows.map(projectMovement),
      reversal: {
        reversalOfMovementId: rows[0].reversal_of_movement_id === null ? null : positiveId(rows[0].reversal_of_movement_id, "reversalOfMovementId"),
        reversedByMovementId: rows[0].reversed_by_movement_id === null ? null : positiveId(rows[0].reversed_by_movement_id, "reversedByMovementId")
      }
    };
  }

  findOperationBySource({ source }) {
    return this.operationService.findBySource(this.database, { source });
  }
}
