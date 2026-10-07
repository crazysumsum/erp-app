import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
const CONTRACT = {
  table: "sales_order_lines",
  columns: {
    id: ["bigint unsigned", false, null, null, "auto_increment"], sales_order_id: ["bigint unsigned"], line_no: ["smallint unsigned"],
    sku_id: ["bigint unsigned"], item_name_snapshot: ["varchar(190)"], sku_code_snapshot: ["varchar(190)"], sku_name_snapshot: ["varchar(190)"],
    sku_uom_id: ["bigint unsigned"], uom_code_snapshot: ["varchar(100)"], uom_name_snapshot: ["varchar(100)"], to_base_factor_snapshot: ["int unsigned"],
    tracking_policy_snapshot: ["varchar(30)", false, null, "ascii_bin"], minimum_sale_life_days_snapshot: ["int unsigned", false, "0"],
    ordered_quantity: ["decimal(20,6)"], ordered_base_quantity: ["bigint unsigned"], unit_selling_price: ["decimal(19,4)"],
    price_source: ["varchar(20)", false, null, "ascii_bin"], line_amount: ["decimal(19,4)"],
    reserved_outstanding_base_quantity: ["bigint unsigned", false, "0"], backordered_base_quantity: ["bigint unsigned", false, "0"],
    fulfilled_base_quantity: ["bigint unsigned", false, "0"], cancelled_base_quantity: ["bigint unsigned", false, "0"],
    line_note: ["varchar(500)", false, ""], version: ["int unsigned", false, "1"], created_at: ["bigint unsigned"], updated_at: ["bigint unsigned"]
  },
  indexes: { PRIMARY: [0, "id"], uq_sales_order_line_number: [0, "sales_order_id,line_no"],
    uq_sales_order_line_sku_uom: [0, "sales_order_id,sku_id,sku_uom_id"], uq_sales_order_line_owner: [0, "id,sales_order_id"],
    idx_sales_order_lines_sku: [1, "sku_id,sales_order_id,id"] },
  foreignKeys: { sales_order_id: ["sales_orders", "id", "CASCADE"], sku_id: ["item_skus", "id", "RESTRICT"], sku_uom_id: ["item_sku_uoms", "id", "RESTRICT"] },
  checks: { chk_sales_order_line_values: "line_no BETWEEN 1 AND 100 AND to_base_factor_snapshot BETWEEN 1 AND 1000000 AND ordered_quantity > 0 AND ordered_base_quantity > 0 AND unit_selling_price >= 0 AND line_amount >= 0 AND version >= 1",
    chk_sales_order_line_price: "price_source IN ('SUGGESTED','MANUAL','QUOTATION','IMPORT')",
    chk_sales_order_line_projection: "reserved_outstanding_base_quantity + backordered_base_quantity + fulfilled_base_quantity + cancelled_base_quantity <= ordered_base_quantity" }
};
export const inspectSalesOrderLineSchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
