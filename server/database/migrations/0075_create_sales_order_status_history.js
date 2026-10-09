import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
const CONTRACT = {
  table: "sales_order_status_history",
  columns: { id: ["bigint unsigned", false, null, null, "auto_increment"], sales_order_id: ["bigint unsigned"], sequence_no: ["int unsigned"],
    from_status: ["varchar(30)", true, null, "ascii_bin"], to_status: ["varchar(30)", false, null, "ascii_bin"], action: ["varchar(50)", false, null, "ascii_bin"],
    reason: ["varchar(500)", false, ""], order_version_after: ["int unsigned"], event_id: ["char(36)", false, null, "ascii_bin"],
    actor_user_id: ["bigint unsigned", true], actor_label: ["varchar(190)"], occurred_at: ["bigint unsigned"] },
  indexes: { PRIMARY: [0, "id"], uq_sales_history_sequence: [0, "sales_order_id,sequence_no"], uq_sales_history_event: [0, "sales_order_id,event_id,action"],
    idx_sales_history_order: [1, "sales_order_id,occurred_at,id"] },
  foreignKeys: { sales_order_id: ["sales_orders", "id", "CASCADE"], actor_user_id: ["users", "id", "SET NULL"] },
  checks: { chk_sales_history_values: "sequence_no >= 1 AND order_version_after >= 1" },
  triggers: { trg_sales_history_update: ["UPDATE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sales history is append-only'"] }
};
export const inspectSalesStatusHistorySchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
