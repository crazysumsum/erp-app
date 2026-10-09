import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";
const CONTRACT = {
  table: "sales_audit_logs",
  columns: { id: ["bigint unsigned", false, null, null, "auto_increment"], occurred_at: ["bigint unsigned"], actor_user_id: ["bigint unsigned", true],
    actor_label: ["varchar(190)"], action: ["varchar(80)", false, null, "ascii_bin"], target_type: ["varchar(30)", false, null, "ascii_bin"],
    target_id: ["bigint unsigned", true], target_number: ["varchar(30)", false, ""], outcome: ["varchar(20)", false, null, "ascii_bin"],
    reason: ["varchar(500)", false, ""], details: ["json", true], event_id: ["char(36)", false, "", "ascii_bin"],
    request_id: ["varchar(64)", false, "", "ascii_bin"], correlation_id: ["varchar(64)", false, "", "ascii_bin"], ip_address: ["varchar(45)", false, "", "ascii_bin"] },
  indexes: { PRIMARY: [0, "id"], idx_sales_audit_target: [1, "target_type,target_id,occurred_at,id"],
    idx_sales_audit_action: [1, "action,occurred_at,id"], idx_sales_audit_actor: [1, "actor_user_id,occurred_at,id"] },
  foreignKeys: { actor_user_id: ["users", "id", "SET NULL"] },
  checks: { chk_sales_audit_outcome: "outcome IN ('SUCCESS','FAILED','WARNING')",
    chk_sales_audit_details: "LENGTH(CAST(details AS CHAR CHARSET utf8mb4)) <= 16384" },
  triggers: { trg_sales_audit_update: ["UPDATE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sales audit is append-only'"] }
};
export const inspectSalesAuditSchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
