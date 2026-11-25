import { returnError } from "./returnErrors.js";
import { returnSourceId } from "./returnSourceScope.js";
import { returnType } from "./returnTypes.js";

const PARTIES = {
  customer: { name: "customer", table: "shipments", number: "shipment_number", sourceId: "shipmentId", sourceNumber: "shipmentNumber" },
  supplier: { name: "supplier", table: "goods_receipts", number: "gr_number", sourceId: "goodsReceiptId", sourceNumber: "goodsReceiptNumber" }
};

function selectHeaders(type, party) {
  return `SELECT r.*, DATE_FORMAT(r.return_date, '%Y-%m-%d') AS return_day, s.${party.number} AS source_number
            FROM ${type.header} r JOIN ${party.table} s ON s.id = r.${type.source}`;
}

function summary(type, party, row) {
  return {
    id: String(row.id), returnNumber: `${type.prefix}${row.id}`, status: row.status, version: Number(row.version),
    [party.sourceId]: String(row[type.source]), [party.sourceNumber]: row.source_number,
    partyCode: row[`${party.name}_code_snapshot`], partyName: row[`${party.name}_name_snapshot`], returnDate: row.return_day
  };
}

export class ReturnInquiryService {
  constructor(database) {
    this.database = database;
  }

  list(kind, { page = 1, pageSize = 20, salesOrderId, status, returnNumber } = {}) {
    const type = returnType(kind);
    const party = PARTIES[kind];
    const where = [], values = [];
    if (kind === "customer" && salesOrderId !== undefined) {
      where.push("s.sales_order_id = ?");
      values.push(returnSourceId(salesOrderId));
    }
    if (status !== undefined) {
      where.push("r.status = ?");
      values.push(status);
    }
    if (returnNumber !== undefined) {
      if (!returnNumber.startsWith(type.prefix)) return { items: [], total: 0, page, pageSize };
      where.push("r.id = ?");
      values.push(returnSourceId(returnNumber.slice(type.prefix.length)));
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.withTransaction(async tx => {
      const [[{ total }]] = await tx.query(
        `SELECT COUNT(*) AS total FROM ${type.header} r JOIN ${party.table} s ON s.id = r.${type.source} ${filter}`, values);
      const [rows] = await tx.query(
        `${selectHeaders(type, party)} ${filter} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
      return { items: rows.map(row => summary(type, party, row)), total: Number(total), page, pageSize };
    });
  }

  detail(kind, id, permissions) {
    const type = returnType(kind);
    const party = PARTIES[kind];
    return this.database.withTransaction(async tx => {
      const [[row]] = await tx.query(`${selectHeaders(type, party)} WHERE r.id = ?`, [returnSourceId(id)]);
      if (!row) throw returnError("RETURN_NOT_FOUND");
      const [lines] = await tx.query(
        `SELECT l.id, l.line_no, l.${type.detail} AS source_detail_id, l.base_quantity, l.bin_id, l.inventory_movement_id,
                m.sku_code_snapshot, m.lot_number_snapshot, b.bin_code, w.warehouse_code
                ${kind === "supplier" ? ", l.stock_status" : ""}
           FROM ${type.lines} l
           JOIN ${kind === "customer" ? "shipment_issue_details" : "goods_receipt_details"} d ON d.id = l.${type.detail}
           JOIN inventory_movements m ON m.id = d.inventory_movement_id
           JOIN inventory_bins b ON b.id = l.bin_id JOIN inventory_warehouses w ON w.id = b.warehouse_id
          WHERE l.return_id = ? ORDER BY l.line_no`, [id]);
      return {
        ...summary(type, party, row), reason: row.reason, createdBy: row.created_by_label,
        postedBy: row.posted_by_label, postedAt: row.posted_at === null ? null : Number(row.posted_at),
        allowedActions: row.status === "DRAFT" && permissions.includes(type.permission) ? ["post", "cancel"] : [],
        lines: lines.map(line => ({
          id: String(line.id), lineNo: Number(line.line_no), sourceDetailId: String(line.source_detail_id),
          baseQuantity: String(line.base_quantity), binId: String(line.bin_id), binCode: line.bin_code, warehouseCode: line.warehouse_code,
          stockStatus: kind === "customer" ? "QUARANTINED" : line.stock_status,
          skuCode: line.sku_code_snapshot, lotNumber: line.lot_number_snapshot,
          inventoryMovementId: line.inventory_movement_id === null ? null : String(line.inventory_movement_id)
        }))
      };
    });
  }

  source(kind, reference) {
    const type = returnType(kind);
    const party = PARTIES[kind];
    const customer = kind === "customer";
    return this.database.withTransaction(async tx => {
      const byId = /^[1-9][0-9]{0,15}$/u.test(reference) && Number.isSafeInteger(Number(reference));
      const [[header]] = await tx.query(
        `SELECT id, ${party.number} AS source_number, status FROM ${party.table} WHERE ${byId ? "id" : party.number} = ?`, [reference]);
      if (!header) throw returnError("RETURN_SOURCE_NOT_FOUND");
      if (!(customer ? ["SHIPPED"] : ["CONFIRMED", "PARTIALLY_REVERSED"]).includes(header.status)) {
        throw returnError("RETURN_SOURCE_CONFLICT");
      }
      const id = String(header.id);
      const [details] = await tx.query(
        `SELECT d.id, d.warehouse_id, m.sku_code_snapshot, m.sku_name_snapshot, m.lot_number_snapshot, m.stock_status,
                d.${customer ? "issued_base_quantity" : "received_base_quantity"} AS source_quantity,
                ${customer ? "0" : "d.reversed_base_quantity"} AS reversed_quantity
           FROM ${customer ? "shipment_issue_details" : "goods_receipt_details"} d
           JOIN inventory_movements m ON m.id = d.inventory_movement_id
          WHERE d.${type.source} = ? ORDER BY d.id`, [id]);
      const [used] = await tx.query(
        `SELECT ${type.detail} AS source_detail_id, SUM(base_quantity) AS quantity FROM ${type.lines}
          WHERE ${type.source} = ? AND inventory_movement_id IS NOT NULL GROUP BY ${type.detail}`, [id]);
      const posted = new Map(used.map(row => [String(row.source_detail_id), BigInt(row.quantity)]));
      const warehouseIds = [...new Set(details.map(row => String(row.warehouse_id)))];
      const [bins] = warehouseIds.length ? await tx.query(
        `SELECT b.id, b.warehouse_id, b.bin_code, w.warehouse_code FROM inventory_bins b
           JOIN inventory_warehouses w ON w.id = b.warehouse_id
          WHERE b.warehouse_id IN (${warehouseIds.map(() => "?").join(", ")}) AND b.status = 'ACTIVE' AND w.status = 'ACTIVE'
          ORDER BY w.warehouse_code, b.bin_code, b.id`, warehouseIds) : [[]];
      return {
        id, sourceNumber: header.source_number,
        details: details.map(row => ({
          id: String(row.id), warehouseId: String(row.warehouse_id), skuCode: row.sku_code_snapshot, skuName: row.sku_name_snapshot,
          lotNumber: row.lot_number_snapshot, stockStatus: customer ? "QUARANTINED" : row.stock_status,
          remainingBaseQuantity: String(BigInt(row.source_quantity) - BigInt(row.reversed_quantity) - (posted.get(String(row.id)) ?? 0n))
        })),
        bins: bins.map(row => ({
          id: String(row.id), warehouseId: String(row.warehouse_id), binCode: row.bin_code, warehouseCode: row.warehouse_code
        }))
      };
    });
  }
}
