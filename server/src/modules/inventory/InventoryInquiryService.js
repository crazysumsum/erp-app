import { InventoryOperationService } from "./InventoryOperationService.js";
import { INVENTORY_RESERVATION_STATUSES } from "./inventoryConstants.js";
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

export class InventoryInquiryService {
  constructor({ database, time, operationService } = {}) {
    if (!database || typeof database.query !== "function" || !time || typeof time.fileDate !== "function") {
      throw new TypeError("InventoryInquiryService requires database and time services");
    }
    this.database = database;
    this.time = time;
    this.operationService = operationService ?? new InventoryOperationService();
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
