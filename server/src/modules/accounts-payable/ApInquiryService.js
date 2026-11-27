import { asciiPredicate } from "../../services/mysqldatabase/asciiPredicate.js";
import { formatUnits, localDate, storedUnits } from "./apCommand.js";
import { apError } from "./apErrors.js";
import { invoiceUnitPrice, sourceId } from "./apInvoiceDraft.js";

const date = (column, alias = column) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${alias}`;
const PAYMENT = `id, payment_number, status, version, supplier_id, supplier_code_snapshot, supplier_name_snapshot, currency_code, currency_decimal_places,
  ${date("payment_date")}, amount, allocated_amount, available_amount, payment_method, reference, created_at, updated_at`;
const INVOICE = `id, invoice_number, status, version, supplier_id, supplier_code_snapshot, supplier_name_snapshot,
  currency_code, currency_decimal_places, supplier_invoice_number, ${date("invoice_date")}, ${date("due_date")},
  supplier_total_amount, total_amount, allocated_amount, outstanding_amount, created_at, updated_at`;
const BUCKETS = ["notDue", "days1To30", "days31To60", "days61To90", "over90"];
// 帳齡分桶：以到期日計的逾期日數；未到期（含今日到期）歸 notDue。
const BUCKET_SQL = ["d <= 0", "d BETWEEN 1 AND 30", "d BETWEEN 31 AND 60", "d BETWEEN 61 AND 90", "d > 90"]
  .map((condition, index) => `SUM(CASE WHEN ${condition} THEN outstanding_amount ELSE 0 END) AS ${BUCKETS[index]}`).join(", ");

function paymentActions(row, permissions) {
  if (!permissions.includes("ap.payment.mgmt")) return [];
  if (row.status === "DRAFT") return ["confirm", "cancel"];
  if (row.status !== "CONFIRMED") return [];
  return [...(storedUnits(row.available_amount) > 0n ? ["allocate"] : []), ...(storedUnits(row.allocated_amount) === 0n ? ["void"] : [])];
}

const paymentSummary = (row, permissions) => ({
  id: Number(row.id), number: row.payment_number, status: row.status, version: Number(row.version), supplierId: Number(row.supplier_id),
  supplierCode: row.supplier_code_snapshot, supplierName: row.supplier_name_snapshot, currencyCode: row.currency_code,
  currencyDecimalPlaces: Number(row.currency_decimal_places), paymentDate: row.payment_date, amount: row.amount, allocatedAmount: row.allocated_amount,
  availableAmount: row.available_amount, paymentMethod: row.payment_method, reference: row.reference, createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at), allowedActions: paymentActions(row, permissions)
});

function invoiceActions(row, permissions) {
  if (!permissions.includes("ap.invoice.mgmt")) return [];
  if (row.status === "DRAFT") return ["update", "confirm", "cancel"];
  return row.status === "CONFIRMED" && storedUnits(row.allocated_amount) === 0n ? ["void"] : [];
}

const invoiceSummary = (row, permissions) => ({
  id: Number(row.id), number: row.invoice_number, status: row.status, version: Number(row.version),
  supplierId: Number(row.supplier_id), supplierCode: row.supplier_code_snapshot, supplierName: row.supplier_name_snapshot,
  currencyCode: row.currency_code, currencyDecimalPlaces: Number(row.currency_decimal_places), supplierInvoiceNumber: row.supplier_invoice_number,
  invoiceDate: row.invoice_date, dueDate: row.due_date, supplierTotalAmount: row.supplier_total_amount,
  totalAmount: row.total_amount, allocatedAmount: row.allocated_amount, outstandingAmount: row.outstanding_amount,
  createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), allowedActions: invoiceActions(row, permissions)
});

function invoiceLine(row) {
  const receipt = row.line_type === "RECEIPT";
  return {
    id: Number(row.id), lineNo: Number(row.line_no), lineType: row.line_type, goodsReceiptId: row.goods_receipt_id,
    goodsReceiptLineId: row.goods_receipt_line_id, goodsReceiptNumber: row.goods_receipt_number_snapshot,
    purchaseOrderId: row.purchase_order_id, purchaseOrderLineId: row.purchase_order_line_id, purchaseOrderNumber: row.purchase_order_number_snapshot,
    skuCode: row.sku_code_snapshot, skuName: row.sku_name_snapshot,
    baseUomCode: row.base_uom_code_snapshot, purchaseUomCode: row.purchase_uom_code_snapshot,
    toBaseFactor: Number(row.to_base_factor_snapshot), quantity: row.quantity, poUnitPrice: row.po_unit_price_snapshot, poLineAmount: row.po_line_amount,
    invoiceUnitPrice: receipt ? invoiceUnitPrice(row.line_amount, row.quantity, row.to_base_factor_snapshot) : null,
    lineAmount: row.line_amount, amountOverrideReason: row.amount_override_reason, description: row.description
  };
}

// SUM(DECIMAL(19,4)) 保留四位小數，但總額可超過單張發票的 15 位整數上限。
const summedUnits = (value) => BigInt(String(value).replace(".", ""));
/** LIKE 前綴：! 作 escape。 */
const prefix = (value) => `${value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;

/** 付款查詢及帳齡表（唯讀；權限由 route 的 ap.view 把關）。 */
export class ApInquiryService {
  constructor({ database, time }) {
    if (!database || !time) throw new TypeError("ApInquiryService requires database and time");
    Object.assign(this, { database, time });
  }

  async listInvoices({ claims, query = {} }) {
    const { page = 1, pageSize = 20 } = query, where = [], values = [];
    for (const [field, column] of [["status", "status"], ["supplierId", "supplier_id"], ["currencyCode", "currency_code"]]) {
      if (query[field] !== undefined) { where.push(`${column} = ?`); values.push(query[field]); }
    }
    for (const [field, operator] of [["invoiceDateFrom", ">="], ["invoiceDateTo", "<="]]) {
      if (query[field] !== undefined) { where.push(`invoice_date ${operator} ?`); values.push(localDate(query[field], field)); }
    }
    if (query.outstandingOnly) where.push("status = 'CONFIRMED'", "outstanding_amount > 0");
    if (query.q) {
      const pattern = prefix(query.q);
      const number = asciiPredicate("invoice_number LIKE ? ESCAPE '!'", pattern);
      where.push(`(${number.sql} OR supplier_invoice_number LIKE ? ESCAPE '!' OR supplier_code_snapshot LIKE ? ESCAPE '!' OR supplier_name_snapshot LIKE ? ESCAPE '!')`);
      values.push(...number.params, pattern, pattern, pattern);
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM ap_invoices ${filter}`, values);
    const [rows] = await this.database.query(`SELECT ${INVOICE} FROM ap_invoices ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize]);
    return { items: rows.map((row) => invoiceSummary(row, claims?.permissions ?? [])), total: Number(total), page, pageSize };
  }

  async getInvoice({ claims, id }) {
    return this.database.withTransaction(async (tx) => {
      const [[row]] = await tx.query(`SELECT ${INVOICE}, payment_term_code_snapshot, payment_term_name_snapshot, due_date_overridden,
        due_date_reason, no_po_reason, notes, void_reason, created_by_label, confirmed_by_label, confirmed_at, voided_by_label, voided_at
        FROM ap_invoices WHERE id = ?`, [id]);
      if (!row) throw apError("AP_INVOICE_NOT_FOUND");
      const [lines] = await tx.query(`SELECT id, line_no, line_type, CAST(goods_receipt_id AS CHAR) AS goods_receipt_id,
        CAST(goods_receipt_line_id AS CHAR) AS goods_receipt_line_id, goods_receipt_number_snapshot, CAST(purchase_order_id AS CHAR) AS purchase_order_id,
        CAST(purchase_order_line_id AS CHAR) AS purchase_order_line_id, purchase_order_number_snapshot, sku_code_snapshot, sku_name_snapshot,
        base_uom_code_snapshot, purchase_uom_code_snapshot, to_base_factor_snapshot, CAST(quantity AS CHAR) AS quantity, po_unit_price_snapshot,
        po_line_amount, line_amount, amount_override_reason, description
        FROM ap_invoice_lines WHERE invoice_id = ? ORDER BY line_no`, [id]);
      const [allocations] = await tx.query(`SELECT a.id, a.payment_id, a.amount, a.status, a.created_at, p.payment_number,
          ${date("p.payment_date", "payment_date")} FROM ap_payment_allocations a
        JOIN ap_payments p ON p.id = a.payment_id WHERE a.invoice_id = ? ORDER BY a.id`, [id]);
      return {
        ...invoiceSummary(row, claims?.permissions ?? []),
        paymentTermCode: row.payment_term_code_snapshot, paymentTermName: row.payment_term_name_snapshot,
        dueDateOverridden: Boolean(Number(row.due_date_overridden)), dueDateReason: row.due_date_reason, noPoReason: row.no_po_reason,
        notes: row.notes, voidReason: row.void_reason, createdByLabel: row.created_by_label, confirmedByLabel: row.confirmed_by_label,
        confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
        voidedByLabel: row.voided_by_label, voidedAt: row.voided_at === null ? null : Number(row.voided_at),
        lines: lines.map(invoiceLine),
        allocations: allocations.map((item) => ({ id: Number(item.id), paymentId: Number(item.payment_id),
          paymentNumber: item.payment_number, paymentDate: item.payment_date, amount: item.amount, status: item.status, createdAt: Number(item.created_at) }))
      };
    }, { isolationLevel: "REPEATABLE READ" });
  }

  async invoicedReceipts({ goodsReceiptIds }) {
    const ids = [...new Set(goodsReceiptIds.split(",").map((id) => sourceId(id, "goodsReceiptIds")))];
    const [rows] = await this.database.query(`
      SELECT DISTINCT CAST(l.goods_receipt_id AS CHAR) AS receipt_id, i.id AS invoice_id, i.invoice_number, i.status
        FROM ap_invoice_lines l JOIN ap_invoices i ON i.id = l.invoice_id
       WHERE l.goods_receipt_id IN (${ids.map(() => "CAST(? AS UNSIGNED)").join(", ")})
         AND l.active_goods_receipt_line_id IS NOT NULL AND i.status IN ('DRAFT', 'CONFIRMED')
       ORDER BY receipt_id, invoice_id`, ids);
    return { items: rows.map((row) => ({ goodsReceiptId: row.receipt_id, invoiceId: Number(row.invoice_id),
      invoiceNumber: row.invoice_number, invoiceStatus: row.status })) };
  }

  /** 付款列表：新到舊。`q` 以前綴找付款編號、參考號、供應商代碼或名稱。 */
  async listPayments({ claims, query = {} }) {
    const { page = 1, pageSize = 20 } = query, where = [], values = [];
    for (const [field, column] of [["status", "status"], ["supplierId", "supplier_id"], ["currencyCode", "currency_code"]]) {
      if (query[field] !== undefined) { where.push(`${column} = ?`); values.push(query[field]); }
    }
    for (const [field, operator] of [["paymentDateFrom", ">="], ["paymentDateTo", "<="]]) {
      if (query[field] !== undefined) { where.push(`payment_date ${operator} ?`); values.push(localDate(query[field], field)); }
    }
    if (query.q) {
      const pattern = prefix(query.q);
      const number = asciiPredicate("payment_number LIKE ? ESCAPE '!'", pattern);
      where.push(`(${number.sql} OR reference LIKE ? ESCAPE '!' OR supplier_code_snapshot LIKE ? ESCAPE '!' OR supplier_name_snapshot LIKE ? ESCAPE '!')`);
      values.push(...number.params, pattern, pattern, pattern);
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM ap_payments ${filter}`, values);
    const [rows] = await this.database.query(`SELECT ${PAYMENT} FROM ap_payments ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
    return { items: rows.map((row) => paymentSummary(row, claims?.permissions ?? [])), total: Number(total), page, pageSize };
  }

  /** 付款詳情連同其核銷（含已解除的記錄）及每張發票目前的未付額。 */
  async getPayment({ claims, id }) {
    return this.database.withTransaction(async (tx) => {
      const [[row]] = await tx.query(`SELECT ${PAYMENT}, notes, void_reason, created_by_label, confirmed_by_label, confirmed_at, voided_by_label, voided_at
        FROM ap_payments WHERE id = ?`, [id]);
      if (!row) throw apError("AP_PAYMENT_NOT_FOUND");
      const [allocations] = await tx.query(`SELECT a.id, a.invoice_id, a.amount, a.status, a.created_by_label, a.created_at, a.unapplied_by_label, a.unapplied_at,
          i.invoice_number, ${date("i.invoice_date", "invoice_date")}, ${date("i.due_date", "due_date")}, i.total_amount, i.outstanding_amount
        FROM ap_payment_allocations a JOIN ap_invoices i ON i.id = a.invoice_id WHERE a.payment_id = ? ORDER BY a.id`, [id]);
      const canUnapply = row.status === "CONFIRMED" && (claims?.permissions ?? []).includes("ap.payment.mgmt");
      return {
        ...paymentSummary(row, claims?.permissions ?? []), notes: row.notes, voidReason: row.void_reason, createdByLabel: row.created_by_label,
        confirmedByLabel: row.confirmed_by_label, confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
        voidedByLabel: row.voided_by_label, voidedAt: row.voided_at === null ? null : Number(row.voided_at),
        allocations: allocations.map((item) => ({
          id: Number(item.id), invoiceId: Number(item.invoice_id), invoiceNumber: item.invoice_number, invoiceDate: item.invoice_date, dueDate: item.due_date,
          invoiceTotalAmount: item.total_amount, invoiceOutstandingAmount: item.outstanding_amount, amount: item.amount, status: item.status,
          createdByLabel: item.created_by_label, createdAt: Number(item.created_at), unappliedByLabel: item.unapplied_by_label,
          unappliedAt: item.unapplied_at === null ? null : Number(item.unapplied_at), allowedActions: canUnapply && item.status === "ACTIVE" ? ["unapply"] : []
        }))
      };
    }, { isolationLevel: "REPEATABLE READ" });
  }

  /**
   * 帳齡表：只做今日的現況。只讀已確認而且仍有未付額的發票（Draft 及作廢的發票也有未付額數字，所以必須篩狀態），
   * 按供應商及幣別分桶；不同幣別不相加，`totals` 亦是每個幣別一列。「今日」取應用時區的日期，不用資料庫的 CURDATE()。
   */
  async aging({ query = {} }) {
    const asOfDate = this.time.fileDate(this.time.at(this.time.nowMs())), where = ["status = 'CONFIRMED'", "outstanding_amount > 0"], values = [asOfDate];
    for (const [field, column] of [["supplierId", "supplier_id"], ["currencyCode", "currency_code"]]) {
      if (query[field] !== undefined) { where.push(`${column} = ?`); values.push(query[field]); }
    }
    const [rows] = await this.database.query(`SELECT supplier_id, currency_code, MAX(supplier_code_snapshot) AS supplier_code, MAX(supplier_name_snapshot) AS supplier_name,
        MAX(currency_decimal_places) AS decimal_places, COUNT(*) AS invoice_count, SUM(outstanding_amount) AS total, ${BUCKET_SQL}
      FROM (SELECT ap_invoices.*, DATEDIFF(?, due_date) AS d FROM ap_invoices WHERE ${where.join(" AND ")}) aged
      GROUP BY supplier_id, currency_code ORDER BY supplier_code, supplier_id, currency_code`, values);
    const amounts = (row) => Object.fromEntries([...BUCKETS, "total"].map((key) => [key, formatUnits(summedUnits(row[key]))]));
    const totals = new Map();
    for (const row of rows) {
      const sum = totals.get(row.currency_code) ?? { currencyCode: row.currency_code, invoiceCount: 0, ...Object.fromEntries([...BUCKETS, "total"].map((key) => [key, 0n])) };
      sum.invoiceCount += Number(row.invoice_count);
      for (const key of [...BUCKETS, "total"]) sum[key] += summedUnits(row[key]);
      totals.set(row.currency_code, sum);
    }
    return {
      asOfDate,
      items: rows.map((row) => ({ supplierId: Number(row.supplier_id), supplierCode: row.supplier_code, supplierName: row.supplier_name, currencyCode: row.currency_code,
        currencyDecimalPlaces: Number(row.decimal_places), invoiceCount: Number(row.invoice_count), ...amounts(row) })),
      totals: [...totals.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode))
        .map((sum) => ({ ...sum, ...Object.fromEntries([...BUCKETS, "total"].map((key) => [key, formatUnits(sum[key])])) }))
    };
  }
}
