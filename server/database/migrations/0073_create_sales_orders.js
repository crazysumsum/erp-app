import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
const CONTRACT = {
  table: "sales_orders",
  columns: {
    id: ["bigint unsigned", false, null, null, "auto_increment"], sales_order_number: ["varchar(20)", false, null, "ascii_bin"],
    status: ["varchar(30)", false, null, "ascii_bin"], source_type: ["varchar(20)", false, null, "ascii_bin"],
    source_quotation_id: ["bigint unsigned", true], source_intake_order_id: ["bigint unsigned", true], external_order_key_id: ["bigint unsigned", true],
    channel_code_snapshot: ["varchar(50)", false, "", "ascii_bin"], external_order_id_snapshot: ["varchar(190)", false, ""],
    customer_id: ["bigint unsigned"], customer_code_snapshot: ["varchar(100)"], customer_name_snapshot: ["varchar(190)"],
    currency_code: ["char(3)", false, null, "ascii_bin"], payment_term_id: ["bigint unsigned", true],
    payment_term_code_snapshot: ["varchar(50)", false, ""], payment_term_name_snapshot: ["varchar(190)", false, ""],
    credit_status_snapshot: ["varchar(20)", false, "NOT_CONFIGURED", "ascii_bin"], credit_limit_snapshot: ["decimal(19,4)", true],
    credit_currency_snapshot: ["char(3)", true, null, "ascii_bin"], credit_policy_version_snapshot: ["int unsigned", true],
    fulfillment_warehouse_id: ["bigint unsigned"], warehouse_code_snapshot: ["varchar(100)"], warehouse_name_snapshot: ["varchar(190)"],
    order_date: ["date"], requested_delivery_date: ["date", true], customer_po_reference: ["varchar(190)", false, ""], notes: ["varchar(2000)", false, ""],
    line_count: ["smallint unsigned"], total_amount: ["decimal(19,4)"], has_backorder: ["tinyint(1)", false, "0"],
    backorder_line_count: ["smallint unsigned", false, "0"], version: ["int unsigned", false, "1"],
    confirmation_event_id: ["char(36)", true, null, "ascii_bin"], confirmed_at: ["bigint unsigned", true], cancelled_at: ["bigint unsigned", true], closed_at: ["bigint unsigned", true],
    confirmed_by: ["bigint unsigned", true], cancelled_by: ["bigint unsigned", true], closed_by: ["bigint unsigned", true],
    cancel_reason: ["varchar(500)", false, ""], close_reason: ["varchar(500)", false, ""], created_at: ["bigint unsigned"], updated_at: ["bigint unsigned"],
    last_business_updated_at: ["bigint unsigned"], created_by: ["bigint unsigned", true], updated_by: ["bigint unsigned", true]
  },
  indexes: { PRIMARY: [0, "id"], uq_sales_order_number: [0, "sales_order_number"], uq_sales_order_confirmation_event: [0, "confirmation_event_id"],
    uq_sales_order_source_quotation: [0, "source_quotation_id"], uq_sales_order_external_key: [0, "external_order_key_id"],
    idx_sales_orders_status_date: [1, "status,order_date,id"], idx_sales_orders_customer: [1, "customer_id,order_date,id"],
    idx_sales_orders_warehouse: [1, "fulfillment_warehouse_id,status,order_date,id"], idx_sales_orders_source: [1, "source_type,order_date,id"],
    idx_sales_orders_backorder: [1, "has_backorder,status,confirmed_at,id"], idx_sales_orders_customer_po: [1, "customer_id,customer_po_reference,id"],
    idx_sales_orders_archive_eligibility: [1, "status,last_business_updated_at,id"] },
  // Intake UNIQUE/FK is added after its parent tables in Phase 3 (Design §4.8).
  foreignKeys: { source_quotation_id: ["sales_quotations", "id", "RESTRICT"], external_order_key_id: ["sales_external_order_keys", "id", "RESTRICT"],
    customer_id: ["customers", "id", "RESTRICT"], currency_code: ["currencies", "code", "RESTRICT"], payment_term_id: ["payment_terms", "id", "RESTRICT"],
    fulfillment_warehouse_id: ["inventory_warehouses", "id", "RESTRICT"], confirmed_by: ["users", "id", "SET NULL"], cancelled_by: ["users", "id", "SET NULL"],
    closed_by: ["users", "id", "SET NULL"], created_by: ["users", "id", "SET NULL"], updated_by: ["users", "id", "SET NULL"] },
  checks: { chk_sales_order_status: "status IN ('DRAFT','CONFIRMING','CONFIRMED','PARTIALLY_FULFILLED','COMPLETED','CANCELLED','CLOSED')",
    chk_sales_order_source: "source_type IN ('MANUAL','QUOTATION','CSV','CHANNEL')", chk_sales_order_dates: "requested_delivery_date >= order_date",
    chk_sales_order_values: "line_count BETWEEN 1 AND 100 AND version >= 1 AND total_amount >= 0 AND has_backorder IN (0,1) AND backorder_line_count <= line_count" }
};
export const inspectSalesOrderSchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
