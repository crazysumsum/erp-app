import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";

const CONTRACT={
  table:"sales_intake_errors",
  columns:{id:["bigint unsigned",false,null,null,"auto_increment"],intake_order_id:["bigint unsigned"],row_no:["int unsigned"],field_path:["varchar(190)",false,""],error_code:["varchar(80)",false,null,"ascii_bin"],safe_message:["varchar(500)"],value_summary:["varchar(190)",false,""],created_at:["bigint unsigned"]},
  indexes:{PRIMARY:[0,"id"],idx_sales_intake_error_owner:[1,"intake_order_id,row_no,id"],idx_sales_intake_error_code:[1,"error_code,created_at,id"]},
  foreignKeys:{intake_order_id:["sales_intake_orders","id","CASCADE"]},checks:{chk_sales_intake_error_row:"row_no >= 1"},
  triggers:{trg_sales_intake_error_insert:["INSERT",`BEGIN DECLARE parent_id BIGINT UNSIGNED DEFAULT NULL; DECLARE error_count INT UNSIGNED;
    SELECT id INTO parent_id FROM sales_intake_orders WHERE id=NEW.intake_order_id FOR UPDATE;
    IF parent_id IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Sales Intake error owner missing'; END IF;
    SELECT COUNT(*) INTO error_count FROM sales_intake_errors WHERE intake_order_id=parent_id FOR SHARE;
    IF error_count >= 200 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Sales Intake error limit exceeded'; END IF; END`],
    trg_sales_intake_error_update:["UPDATE",`BEGIN IF NOT (NEW.intake_order_id <=> OLD.intake_order_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Sales Intake error owner is immutable'; END IF; END`]}
};
export const inspectSalesIntakeErrorSchema=connection=>inspectSalesTable(connection,CONTRACT);
export const up=connection=>createSalesTable(connection,CONTRACT);
