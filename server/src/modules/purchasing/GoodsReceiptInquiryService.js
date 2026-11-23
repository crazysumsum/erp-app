import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { purchasingError } from "./purchasingErrors.js";
import { positiveId } from "./purchasingValidation.js";

const STATUSES = ["DRAFT", "CONFIRMED", "PARTIALLY_REVERSED", "REVERSED", "CANCELLED"];
const date = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${column}`;
const HEADER = `gr.id, gr.gr_number, gr.status, gr.version, gr.purchase_order_id, po.po_number, gr.supplier_id, gr.supplier_code_snapshot,
  gr.supplier_name_snapshot, DATE_FORMAT(gr.business_receipt_date, '%Y-%m-%d') AS business_receipt_date, gr.supplier_delivery_note, gr.notes, gr.supplier_status_at_confirm,
  gr.supplier_exception_reason, gr.total_received_base_quantity, gr.has_over_receipt, gr.has_expiry_override, gr.has_sku_exception,
  gr.created_by_label, gr.updated_by_label, gr.created_at, gr.updated_at, gr.confirmed_at, gr.cancelled_at, gr.cancel_reason`;
const FROM = "FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.purchase_order_id";

const flag = (value) => Number(value) === 1;
const stamp = (value) => (value === null ? null : Number(value));
function header(row) {
  return { id: Number(row.id), number: row.gr_number, status: row.status, version: Number(row.version), purchaseOrderId: Number(row.purchase_order_id),
    purchaseOrderNumber: row.po_number, supplierId: Number(row.supplier_id), supplierCode: row.supplier_code_snapshot, supplierName: row.supplier_name_snapshot,
    businessReceiptDate: row.business_receipt_date, supplierDeliveryNote: row.supplier_delivery_note, totalReceivedBaseQuantity: String(row.total_received_base_quantity),
    hasOverReceipt: flag(row.has_over_receipt), hasExpiryOverride: flag(row.has_expiry_override), hasSkuException: flag(row.has_sku_exception),
    updatedAt: Number(row.updated_at), confirmedAt: stamp(row.confirmed_at) };
}

/**
 * 收貨單最小 list／detail（設計 §5.3、§8.9 子集；PM 00108ad7：只做頁面要嘅欄位）。只讀，要 purchasing.view；
 * allowedActions 用交易內重讀嘅權限，唔信 JWT。Reversal、CSV、風險 filter 屬之後嘅 Task。
 */
export class GoodsReceiptInquiryService {
  constructor({ database }) {
    if (!database) throw new TypeError("GoodsReceiptInquiryService requires a database");
    this.database = database;
  }

  list({ claims, query = {} }) {
    const page = query.page === undefined ? 1 : positiveId(Number(query.page), "page");
    const pageSize = query.pageSize === undefined ? 20 : positiveId(Number(query.pageSize), "pageSize");
    if (pageSize > 100) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "pageSize" });
    const where = [], values = [];
    if (query.status !== undefined) {
      if (!STATUSES.includes(query.status)) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "status" });
      where.push("gr.status = ?"); values.push(query.status);
    }
    if (query.purchaseOrderId !== undefined) { where.push("gr.purchase_order_id = ?"); values.push(positiveId(Number(query.purchaseOrderId), "purchaseOrderId")); }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    return this.database.withTransaction(async (tx) => {
      await this.#actor(tx, claims);
      const [[{ total }]] = await tx.query(`SELECT COUNT(*) AS total FROM goods_receipts gr${clause}`, values);
      const [rows] = await tx.query(`SELECT ${HEADER} ${FROM}${clause} ORDER BY gr.id DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
      return { items: rows.map(header), total: Number(total), page, pageSize };
    });
  }

  get({ claims, id }) {
    positiveId(id, "id");
    return this.database.withTransaction(async (tx) => {
      const { permissions } = await this.#actor(tx, claims);
      const [[row]] = await tx.query(`SELECT ${HEADER} ${FROM} WHERE gr.id = ?`, [id]);
      if (!row) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
      const [lines] = await tx.query(`SELECT id, purchase_order_line_id, line_number, sku_id, sku_code_snapshot, sku_name_snapshot, received_base_quantity,
        over_received_base_quantity, over_receipt_reason, sku_exception_reason, sku_warning_codes FROM goods_receipt_lines WHERE goods_receipt_id = ? ORDER BY line_number`, [id]);
      const [details] = await tx.query(`SELECT id, goods_receipt_line_id, detail_number, input_uom_id, input_uom_code_snapshot, received_quantity,
        received_base_quantity, warehouse_id, bin_id, warehouse_code_snapshot, bin_code_snapshot, lot_number, ${date("expiry_date")}, ${date("manufacture_date")},
        stock_status, expiry_override_reason, inventory_movement_id FROM goods_receipt_details WHERE goods_receipt_id = ? ORDER BY detail_number`, [id]);
      const writable = row.status === "DRAFT" && ["purchasing.view", "receiving.operation"].every((name) => permissions.includes(name));
      return { ...header(row), notes: row.notes, supplierStatusAtConfirm: row.supplier_status_at_confirm, supplierExceptionReason: row.supplier_exception_reason,
        createdByLabel: row.created_by_label, updatedByLabel: row.updated_by_label, createdAt: Number(row.created_at), cancelledAt: stamp(row.cancelled_at),
        cancelReason: row.cancel_reason, allowedActions: writable ? ["update", "cancel", "confirm"] : [],
        lines: lines.map((line) => ({ id: Number(line.id), purchaseOrderLineId: Number(line.purchase_order_line_id), lineNumber: Number(line.line_number),
          skuId: Number(line.sku_id), skuCode: line.sku_code_snapshot, skuName: line.sku_name_snapshot, receivedBaseQuantity: String(line.received_base_quantity),
          overReceivedBaseQuantity: String(line.over_received_base_quantity), overReceiptReason: line.over_receipt_reason, skuExceptionReason: line.sku_exception_reason,
          skuWarningCodes: line.sku_warning_codes === null ? [] : typeof line.sku_warning_codes === "string" ? JSON.parse(line.sku_warning_codes) : line.sku_warning_codes,
          details: details.filter((detail) => Number(detail.goods_receipt_line_id) === Number(line.id)).map((detail) => ({ id: Number(detail.id),
            detailNumber: Number(detail.detail_number), inputUomId: Number(detail.input_uom_id), inputUomCode: detail.input_uom_code_snapshot,
            receivedQuantity: detail.received_quantity, receivedBaseQuantity: String(detail.received_base_quantity), warehouseId: Number(detail.warehouse_id),
            binId: Number(detail.bin_id), warehouseCode: detail.warehouse_code_snapshot, binCode: detail.bin_code_snapshot, lotNumber: detail.lot_number,
            expiryDate: detail.expiry_date, manufactureDate: detail.manufacture_date, stockStatus: detail.stock_status,
            expiryOverrideReason: detail.expiry_override_reason, inventoryMovementId: stamp(detail.inventory_movement_id) })) })) };
    });
  }

  async #actor(tx, claims) {
    const fresh = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
    if (!fresh.permissions.includes("purchasing.view")) throw permissionStaleError();
    return fresh;
  }
}
