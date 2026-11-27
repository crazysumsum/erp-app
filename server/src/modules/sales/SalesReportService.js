import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { requireSalesActor } from "./salesAuthorization.js";
import { salesError } from "./salesErrors.js";
import { salesDate } from "./salesValidation.js";

const exportLimit = 5000;
const orderColumns = `
  CAST(l.id AS CHAR) AS id, CAST(o.id AS CHAR) AS orderId, o.sales_order_number AS orderNumber,
  DATE_FORMAT(o.order_date, '%Y-%m-%d') AS orderDate, o.status,
  o.customer_code_snapshot AS customerCode, o.customer_name_snapshot AS customerName,
  o.warehouse_code_snapshot AS warehouseCode, o.currency_code AS currencyCode,
  l.sku_code_snapshot AS skuCode, l.sku_name_snapshot AS skuName, l.uom_code_snapshot AS salesUomCode,
  CAST(l.ordered_quantity AS CHAR) AS quantity, CAST(l.unit_selling_price AS CHAR) AS unitSellingPrice,
  CAST(l.line_amount AS CHAR) AS lineAmount,
  CAST(l.fulfilled_base_quantity AS CHAR) AS fulfilledBaseQuantity,
  CAST(l.cancelled_base_quantity AS CHAR) AS cancelledBaseQuantity`;

function reportSelection({ dateFrom, dateTo, customerCode, skuCode }) {
  salesDate(dateFrom, "dateFrom");
  salesDate(dateTo, "dateTo");
  if (dateTo < dateFrom) throw salesError("SALES_DATE_INVALID", { field: "dateTo" });
  const clauses = [
    "o.order_date BETWEEN ? AND ?",
    "o.status IN ('CONFIRMED', 'PARTIALLY_FULFILLED', 'COMPLETED', 'CLOSED')"
  ];
  const values = [dateFrom, dateTo];
  if (customerCode?.trim()) {
    clauses.push("o.customer_code_snapshot = ?");
    values.push(customerCode.trim());
  }
  if (skuCode?.trim()) {
    clauses.push("l.sku_code_snapshot = ?");
    values.push(skuCode.trim());
  }
  return {
    from: `FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id = o.id WHERE ${clauses.join(" AND ")}`,
    values
  };
}

export class SalesReportService {
  constructor({ database }) {
    this.database = database;
  }

  list({ claims, query, signal }) {
    const { page = 1, pageSize = 20 } = query;
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw salesError("SALES_INPUT_INVALID", { field: "page" });
    return this.database.withTransaction(async tx => {
      await requireSalesActor(tx, claims, "sales.view");
      const { from, values } = reportSelection(query);
      const [[{ total }]] = await tx.query(`SELECT COUNT(*) AS total ${from}`, values);
      const items = await this.#rows(tx, from, values, pageSize, offset);
      return { items, total: Number(total) };
    }, { signal });
  }

  exportRows({ claims, query, signal }) {
    return this.database.withTransaction(async tx => {
      await requireSalesActor(tx, claims, "sales.view");
      const { from, values } = reportSelection(query);
      const rows = await this.#rows(tx, from, values, exportLimit + 1, 0);
      if (rows.length > exportLimit) {
        throw new ApplicationError("Sales report export limit exceeded", {
          code: "SALES_REPORT_EXPORT_LIMIT_EXCEEDED",
          statusCode: 422,
          publicMessage: "匯出超過 5,000 筆明細，請縮短日期範圍或加上篩選條件。"
        });
      }
      return rows;
    }, { signal });
  }

  async #rows(tx, from, values, limit, offset) {
    const [rows] = await tx.query(
      `SELECT ${orderColumns} ${from} ORDER BY o.order_date DESC, o.id DESC, l.line_no ASC LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    return rows;
  }
}
