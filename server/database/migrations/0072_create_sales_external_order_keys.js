import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
const CONTRACT = {
  table: "sales_external_order_keys",
  columns: {
    id: ["bigint unsigned", false, null, null, "auto_increment"], channel_code: ["varchar(50)", false, null, "ascii_bin"],
    external_order_id: ["varchar(190)"], external_order_id_hash: ["binary(32)"], source_type: ["varchar(20)", false, null, "ascii_bin"],
    payload_hash: ["char(64)", false, null, "ascii_bin"], status: ["varchar(20)", false, null, "ascii_bin"], sales_order_id: ["bigint unsigned", true],
    sales_order_number: ["varchar(20)", false, "", "ascii_bin"], is_order_archived: ["tinyint(1)", false, "0"],
    claimed_at: ["bigint unsigned"], updated_at: ["bigint unsigned"]
  },
  indexes: { PRIMARY: [0, "id"], uq_sales_external_key: [0, "channel_code,external_order_id_hash"],
    uq_sales_external_order_sales_order: [0, "sales_order_id"], idx_sales_external_order_id: [1, "external_order_id_hash,id"] },
  foreignKeys: {}, checks: { chk_sales_external_key_status: "status IN ('PROCESSING','SUCCEEDED')",
    chk_sales_external_key_source: "source_type IN ('CSV','CHANNEL')", chk_sales_external_key_routing: "is_order_archived IN (0,1)" }
};
export const inspectSalesExternalKeySchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
