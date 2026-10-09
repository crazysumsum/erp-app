import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
const COLUMNS = { id: ["bigint unsigned", false, null, null, "auto_increment"], quotation_id: ["bigint unsigned"], sales_order_id: ["bigint unsigned"],
  sales_order_number_snapshot: ["varchar(20)", false, null, "ascii_bin"], difference_summary: ["json"], difference_hash: ["char(64)", false, null, "ascii_bin"],
  event_id: ["char(36)", false, null, "ascii_bin"], is_order_archived: ["tinyint(1)", false, "0"], converted_at: ["bigint unsigned"], converted_by: ["bigint unsigned", true] };
const unchanged = Object.keys(COLUMNS).filter(field => field !== "is_order_archived").map(field =>
  /^(?:var)?char\(|^json$/u.test(COLUMNS[field][0]) ? `(CAST(NEW.${field} AS BINARY) <=> CAST(OLD.${field} AS BINARY))` : `(NEW.${field} <=> OLD.${field})`).join(" AND ");
const CONTRACT = {
  table: "sales_quotation_conversions", columns: COLUMNS,
  indexes: { PRIMARY: [0, "id"], uq_sales_conversion_quote: [0, "quotation_id"], uq_sales_conversion_order: [0, "sales_order_id"], uq_sales_conversion_event: [0, "event_id"] },
  foreignKeys: { quotation_id: ["sales_quotations", "id", "RESTRICT"], converted_by: ["users", "id", "SET NULL"] },
  checks: { chk_sales_conversion_routing: "is_order_archived IN (0,1)", chk_sales_conversion_difference: "LENGTH(CAST(difference_summary AS CHAR CHARSET utf8mb4)) <= 65536" },
  triggers: { trg_sales_conversion_update: ["UPDATE", `BEGIN IF NOT (${unchanged}) OR NEW.is_order_archived < OLD.is_order_archived THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sales conversion is immutable'; END IF; END`] }
};
export const inspectSalesConversionSchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
