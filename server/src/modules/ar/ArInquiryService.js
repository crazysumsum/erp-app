import { formatUnits, localDate, storedUnits } from "./arCommand.js";
import { arError } from "./arErrors.js";

const date = (column, alias = column) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${alias}`;
const RECEIPT = `id, receipt_number, status, version, customer_id, customer_code_snapshot, customer_name_snapshot, currency_code, currency_decimal_places,
  ${date("receipt_date")}, amount, allocated_amount, available_amount, payment_method, reference, created_at, updated_at`;
const BUCKETS = ["notDue", "days1To30", "days31To60", "days61To90", "over90"];
// 帳齡分桶：以到期日計的逾期日數；未到期（含今日到期）歸 notDue。
const BUCKET_SQL = ["d <= 0", "d BETWEEN 1 AND 30", "d BETWEEN 31 AND 60", "d BETWEEN 61 AND 90", "d > 90"]
  .map((condition, index) => `SUM(CASE WHEN ${condition} THEN outstanding_amount ELSE 0 END) AS ${BUCKETS[index]}`).join(", ");

const INVOICE = `id, invoice_number, opening_reference, status, version, customer_id, customer_code_snapshot, customer_name_snapshot, currency_code, currency_decimal_places,
  ${date("invoice_date")}, ${date("due_date")}, total_amount, allocated_amount, outstanding_amount, created_at, updated_at`;

function invoiceActions(row, permissions) {
  if (!permissions.includes("ar.invoice.mgmt")) return [];
  if (row.status === "DRAFT") return ["confirm", "cancel"];
  return row.status === "CONFIRMED" && storedUnits(row.allocated_amount) === 0n ? ["void"] : [];
}

const invoiceSummary = (row, permissions) => ({
  id: Number(row.id), number: row.invoice_number, openingReference: row.opening_reference, status: row.status, version: Number(row.version), customerId: Number(row.customer_id),
  customerCode: row.customer_code_snapshot, customerName: row.customer_name_snapshot, currencyCode: row.currency_code,
  currencyDecimalPlaces: Number(row.currency_decimal_places), invoiceDate: row.invoice_date, dueDate: row.due_date, totalAmount: row.total_amount,
  allocatedAmount: row.allocated_amount, outstandingAmount: row.outstanding_amount, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  allowedActions: invoiceActions(row, permissions)
});

/** allowedActions 只是介面提示；命令在交易內會再驗。 */
function receiptActions(row, permissions) {
  if (!permissions.includes("ar.receipt.mgmt")) return [];
  if (row.status === "DRAFT") return ["confirm", "cancel"];
  if (row.status !== "CONFIRMED") return [];
  return [...(storedUnits(row.available_amount) > 0n ? ["allocate"] : []), ...(storedUnits(row.allocated_amount) === 0n ? ["void"] : [])];
}

const receiptSummary = (row, permissions) => ({
  id: Number(row.id), number: row.receipt_number, status: row.status, version: Number(row.version), customerId: Number(row.customer_id),
  customerCode: row.customer_code_snapshot, customerName: row.customer_name_snapshot, currencyCode: row.currency_code,
  currencyDecimalPlaces: Number(row.currency_decimal_places), receiptDate: row.receipt_date, amount: row.amount, allocatedAmount: row.allocated_amount,
  availableAmount: row.available_amount, paymentMethod: row.payment_method, reference: row.reference, createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at), allowedActions: receiptActions(row, permissions)
});

/** LIKE 前綴：! 作 escape。 */
const prefix = (value) => `${value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;

/** 發票及收款查詢、帳齡表（唯讀；權限由 route 的 ar.view 把關）。 */
export class ArInquiryService {
  constructor({ database, time }) {
    if (!database || !time) throw new TypeError("ArInquiryService requires database and time");
    Object.assign(this, { database, time });
  }

  /** 發票列表：新到舊。`outstandingOnly` 只列已確認而仍有未收額的發票（核銷時選取用）；`q` 以前綴找本系統或舊發票編號、客戶代碼或名稱。 */
  async listInvoices({ claims, query = {} }) {
    const { page = 1, pageSize = 20 } = query, where = [], values = [];
    for (const [field, column] of [["status", "status"], ["customerId", "customer_id"], ["currencyCode", "currency_code"]]) {
      if (query[field] !== undefined) { where.push(`${column} = ?`); values.push(query[field]); }
    }
    for (const [field, operator] of [["invoiceDateFrom", ">="], ["invoiceDateTo", "<="]]) {
      if (query[field] !== undefined) { where.push(`invoice_date ${operator} ?`); values.push(localDate(query[field], field)); }
    }
    if (query.outstandingOnly) where.push("status = 'CONFIRMED' AND outstanding_amount > 0");
    if (query.q) {
      where.push(`(${["invoice_number", "opening_reference", "customer_code_snapshot", "customer_name_snapshot"].map((column) => `${column} LIKE ? ESCAPE '!'`).join(" OR ")})`);
      values.push(...Array(4).fill(prefix(query.q.trim() || query.q)));
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM ar_invoices ${filter}`, values);
    const [rows] = await this.database.query(`SELECT ${INVOICE} FROM ar_invoices ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
    return { items: rows.map((row) => invoiceSummary(row, claims?.permissions ?? [])), total: Number(total), page, pageSize };
  }

  /** 發票詳情連同發票行及其核銷記錄。 */
  async getInvoice({ claims, id }) {
    const [[row]] = await this.database.query(`SELECT ${INVOICE}, payment_term_code_snapshot, payment_term_name_snapshot, due_date_overridden, due_date_reason, notes,
      void_reason, created_by_label, confirmed_by_label, confirmed_at, voided_by_label, voided_at FROM ar_invoices WHERE id = ?`, [id]);
    if (!row) throw arError("AR_INVOICE_NOT_FOUND");
    const [lines] = await this.database.query(`SELECT id, line_no, shipment_id, shipment_line_id, sales_order_id, sales_order_line_id, sku_code_snapshot, sku_name_snapshot,
      base_uom_code_snapshot, sales_uom_code_snapshot, to_base_factor_snapshot, quantity, unit_price_snapshot, line_amount
      FROM ar_invoice_lines WHERE invoice_id = ? ORDER BY line_no`, [id]);
    const [allocations] = await this.database.query(`SELECT a.id, a.receipt_id, a.amount, a.status, a.created_at, r.receipt_number, ${date("r.receipt_date", "receipt_date")}
      FROM ar_receipt_allocations a JOIN ar_receipts r ON r.id = a.receipt_id WHERE a.invoice_id = ? ORDER BY a.id`, [id]);
    const time = (value) => value === null ? null : Number(value);
    return {
      ...invoiceSummary(row, claims?.permissions ?? []), paymentTermCode: row.payment_term_code_snapshot, paymentTermName: row.payment_term_name_snapshot,
      dueDateOverridden: Boolean(row.due_date_overridden), dueDateReason: row.due_date_reason, notes: row.notes, voidReason: row.void_reason,
      createdByLabel: row.created_by_label, confirmedByLabel: row.confirmed_by_label, confirmedAt: time(row.confirmed_at), voidedByLabel: row.voided_by_label, voidedAt: time(row.voided_at),
      lines: lines.map((line) => ({ id: Number(line.id), lineNo: Number(line.line_no), shipmentId: Number(line.shipment_id), shipmentLineId: Number(line.shipment_line_id),
        salesOrderId: Number(line.sales_order_id), salesOrderLineId: Number(line.sales_order_line_id), skuCode: line.sku_code_snapshot, skuName: line.sku_name_snapshot,
        baseUomCode: line.base_uom_code_snapshot, salesUomCode: line.sales_uom_code_snapshot, toBaseFactor: Number(line.to_base_factor_snapshot),
        quantity: String(line.quantity), unitPrice: line.unit_price_snapshot, lineAmount: line.line_amount })),
      allocations: allocations.map((item) => ({ id: Number(item.id), receiptId: Number(item.receipt_id), receiptNumber: item.receipt_number, receiptDate: item.receipt_date,
        amount: item.amount, status: item.status, createdAt: Number(item.created_at) }))
    };
  }

  /** 所問的出貨之中，哪些已在一張未作廢、未取消的發票上（「由出貨建立發票」頁用來排除已開票的出貨）。只讀 AR 自己的表。 */
  async invoicedShipments({ shipmentIds }) {
    const ids = [...new Set(shipmentIds.split(",").map(Number))];
    const [rows] = await this.database.query(`SELECT DISTINCT l.shipment_id, i.id, i.invoice_number, i.status FROM ar_invoice_lines l JOIN ar_invoices i ON i.id = l.invoice_id
      WHERE l.shipment_id IN (${ids.map(() => "?").join(",")}) AND l.active_shipment_line_id IS NOT NULL ORDER BY l.shipment_id`, ids);
    return { items: rows.map((row) => ({ shipmentId: Number(row.shipment_id), invoiceId: Number(row.id), invoiceNumber: row.invoice_number, invoiceStatus: row.status })) };
  }

  /** 收款列表：新到舊。`q` 以前綴找收款編號、參考號、客戶代碼或名稱。 */
  async listReceipts({ claims, query = {} }) {
    const { page = 1, pageSize = 20 } = query, where = [], values = [];
    for (const [field, column] of [["status", "status"], ["customerId", "customer_id"], ["currencyCode", "currency_code"]]) {
      if (query[field] !== undefined) { where.push(`${column} = ?`); values.push(query[field]); }
    }
    for (const [field, operator] of [["receiptDateFrom", ">="], ["receiptDateTo", "<="]]) {
      if (query[field] !== undefined) { where.push(`receipt_date ${operator} ?`); values.push(localDate(query[field], field)); }
    }
    if (query.q) {
      where.push(`(${["receipt_number", "reference", "customer_code_snapshot", "customer_name_snapshot"].map((column) => `${column} LIKE ? ESCAPE '!'`).join(" OR ")})`);
      values.push(...Array(4).fill(prefix(query.q)));
    }
    const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM ar_receipts ${filter}`, values);
    const [rows] = await this.database.query(`SELECT ${RECEIPT} FROM ar_receipts ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
    return { items: rows.map((row) => receiptSummary(row, claims?.permissions ?? [])), total: Number(total), page, pageSize };
  }

  /** 收款詳情連同其核銷（含已解除的記錄）及每張發票目前的未收額。 */
  async getReceipt({ claims, id }) {
    const [[row]] = await this.database.query(`SELECT ${RECEIPT}, notes, void_reason, created_by_label, confirmed_by_label, confirmed_at, voided_by_label, voided_at
      FROM ar_receipts WHERE id = ?`, [id]);
    if (!row) throw arError("AR_RECEIPT_NOT_FOUND");
    const [allocations] = await this.database.query(`SELECT a.id, a.invoice_id, a.amount, a.status, a.created_by_label, a.created_at, a.unapplied_by_label, a.unapplied_at,
        i.invoice_number, i.opening_reference, ${date("i.invoice_date", "invoice_date")}, ${date("i.due_date", "due_date")}, i.total_amount, i.outstanding_amount
      FROM ar_receipt_allocations a JOIN ar_invoices i ON i.id = a.invoice_id WHERE a.receipt_id = ? ORDER BY a.id`, [id]);
    const canUnapply = row.status === "CONFIRMED" && (claims?.permissions ?? []).includes("ar.receipt.mgmt");
    return {
      ...receiptSummary(row, claims?.permissions ?? []), notes: row.notes, voidReason: row.void_reason, createdByLabel: row.created_by_label,
      confirmedByLabel: row.confirmed_by_label, confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
      voidedByLabel: row.voided_by_label, voidedAt: row.voided_at === null ? null : Number(row.voided_at),
      allocations: allocations.map((item) => ({
        id: Number(item.id), invoiceId: Number(item.invoice_id), invoiceNumber: item.invoice_number, invoiceOpeningReference: item.opening_reference, invoiceDate: item.invoice_date, dueDate: item.due_date,
        invoiceTotalAmount: item.total_amount, invoiceOutstandingAmount: item.outstanding_amount, amount: item.amount, status: item.status,
        createdByLabel: item.created_by_label, createdAt: Number(item.created_at), unappliedByLabel: item.unapplied_by_label,
        unappliedAt: item.unapplied_at === null ? null : Number(item.unapplied_at), allowedActions: canUnapply && item.status === "ACTIVE" ? ["unapply"] : []
      }))
    };
  }

  /**
   * 帳齡表：只做今日的現況。只讀已確認而且仍有未收額的發票（Draft 及作廢的發票也有未收額數字，所以必須篩狀態），
   * 按客戶及幣別分桶；不同幣別不相加，`totals` 亦是每個幣別一列。「今日」取應用時區的日期，不用資料庫的 CURDATE()。
   * ponytail: 不分頁，一次回全部有未收額的客戶；客戶數過千時再加分頁。客戶名稱取該客戶發票快照中的最大值。
   * ponytail: 沒有可用的選擇性索引（幾乎所有發票都是 CONFIRMED），會掃整張 ar_invoices；發票累積到數十萬張後會變慢，
   * 到時要加索引（屬結構改動，須先交 Sam 批准）。
   */
  async aging({ query = {} }) {
    const asOfDate = this.time.fileDate(this.time.at(this.time.nowMs())), where = ["status = 'CONFIRMED'", "outstanding_amount > 0"], values = [asOfDate];
    for (const [field, column] of [["customerId", "customer_id"], ["currencyCode", "currency_code"]]) {
      if (query[field] !== undefined) { where.push(`${column} = ?`); values.push(query[field]); }
    }
    const [rows] = await this.database.query(`SELECT customer_id, currency_code, MAX(customer_code_snapshot) AS customer_code, MAX(customer_name_snapshot) AS customer_name,
        MAX(currency_decimal_places) AS decimal_places, COUNT(*) AS invoice_count, SUM(outstanding_amount) AS total, ${BUCKET_SQL}
      FROM (SELECT ar_invoices.*, DATEDIFF(?, due_date) AS d FROM ar_invoices WHERE ${where.join(" AND ")}) aged
      GROUP BY customer_id, currency_code ORDER BY customer_code, customer_id, currency_code`, values);
    const amounts = (row) => Object.fromEntries([...BUCKETS, "total"].map((key) => [key, formatUnits(storedUnits(row[key]))]));
    const totals = new Map();
    for (const row of rows) {
      const sum = totals.get(row.currency_code) ?? { currencyCode: row.currency_code, invoiceCount: 0, ...Object.fromEntries([...BUCKETS, "total"].map((key) => [key, 0n])) };
      sum.invoiceCount += Number(row.invoice_count);
      for (const key of [...BUCKETS, "total"]) sum[key] += storedUnits(row[key]);
      totals.set(row.currency_code, sum);
    }
    return {
      asOfDate,
      items: rows.map((row) => ({ customerId: Number(row.customer_id), customerCode: row.customer_code, customerName: row.customer_name, currencyCode: row.currency_code,
        currencyDecimalPlaces: Number(row.decimal_places), invoiceCount: Number(row.invoice_count), ...amounts(row) })),
      totals: [...totals.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode))
        .map((sum) => ({ ...sum, ...Object.fromEntries([...BUCKETS, "total"].map((key) => [key, formatUnits(sum[key])])) }))
    };
  }
}
