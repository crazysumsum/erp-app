import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
const CONTRACT = {
  table: "sales_quotation_lines",
  columns: {
    id: ["bigint unsigned", false, null, null, "auto_increment"], quotation_id: ["bigint unsigned"], line_no: ["smallint unsigned"],
    sku_id: ["bigint unsigned"], item_name_snapshot: ["varchar(190)"], sku_code_snapshot: ["varchar(190)"], sku_name_snapshot: ["varchar(190)"],
    sku_uom_id: ["bigint unsigned"], uom_code_snapshot: ["varchar(100)"], uom_name_snapshot: ["varchar(100)"],
    to_base_factor_snapshot: ["int unsigned"], quantity: ["decimal(20,6)"], base_quantity: ["bigint unsigned"],
    unit_selling_price: ["decimal(19,4)"], price_source: ["varchar(20)", false, null, "ascii_bin"], line_amount: ["decimal(19,4)"],
    line_note: ["varchar(500)", false, ""], created_at: ["bigint unsigned"], updated_at: ["bigint unsigned"]
  },
  indexes: { PRIMARY: [0, "id"], uq_sales_quotation_line_number: [0, "quotation_id,line_no"],
    uq_sales_quotation_line_sku_uom: [0, "quotation_id,sku_id,sku_uom_id"], idx_sales_quotation_lines_sku: [1, "sku_id,quotation_id"] },
  foreignKeys: { quotation_id: ["sales_quotations", "id", "CASCADE"], sku_id: ["item_skus", "id", "RESTRICT"], sku_uom_id: ["item_sku_uoms", "id", "RESTRICT"] },
  checks: { chk_sales_quotation_line_values: "line_no BETWEEN 1 AND 100 AND to_base_factor_snapshot BETWEEN 1 AND 1000000 AND quantity > 0 AND base_quantity > 0 AND unit_selling_price >= 0 AND line_amount >= 0",
    chk_sales_quotation_line_price: "price_source IN ('SUGGESTED','MANUAL')" }
};
export const inspectSalesQuotationLineSchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
