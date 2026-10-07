import { createSalesTable, inspectSalesTable } from "./0070_create_sales_quotations.js";

const owner = `EXISTS (SELECT 1 FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id
  JOIN inventory_reservations r ON r.id=NEW.inventory_reservation_id
  JOIN inventory_operation_requests child ON child.id=r.create_operation_id
  JOIN inventory_operation_requests root ON root.id=NEW.inventory_operation_id
  WHERE l.id=NEW.sales_order_line_id AND r.sku_id=l.sku_id AND r.warehouse_id=o.fulfillment_warehouse_id
    AND child.source_module='SALES' AND child.source_document_type='SALES_ORDER'
    AND BINARY child.source_document_id=BINARY CAST(o.id AS CHAR) AND BINARY child.source_line_id=BINARY CAST(l.id AS CHAR)
    AND BINARY child.source_event_id=BINARY NEW.source_event_id
    AND root.source_module='SALES' AND root.source_document_type='SALES_ORDER'
    AND root.source_line_id='' AND r.purpose='SALE'
    AND ((root.command_type='SALES_BATCH_RESERVE' AND child.command_type='SALES_LINE_RESERVE')
      OR (root.command_type='SALES_BACKORDER_BATCH_RESERVE' AND child.command_type='SALES_BACKORDER_LINE_RESERVE'))
    AND BINARY root.source_document_id=BINARY CAST(o.id AS CHAR) AND BINARY root.source_event_id=BINARY NEW.source_event_id
    AND r.original_quantity=NEW.original_base_quantity AND r.consumed_quantity=NEW.consumed_base_quantity
    AND r.released_quantity=NEW.released_base_quantity AND r.outstanding_quantity=NEW.outstanding_base_quantity
    AND r.status=NEW.status AND r.version=NEW.inventory_version)`;
const immutable = ["id", "sales_order_line_id", "inventory_reservation_id", "inventory_operation_id", "original_base_quantity", "created_at"]
  .map(field => `(NEW.${field} <=> OLD.${field})`).concat("(BINARY NEW.source_event_id <=> BINARY OLD.source_event_id)").join(" AND ");
const CONTRACT = {
  table: "sales_order_line_reservations",
  columns: { id: ["bigint unsigned", false, null, null, "auto_increment"], sales_order_line_id: ["bigint unsigned"],
    inventory_reservation_id: ["bigint unsigned"], inventory_operation_id: ["bigint unsigned"], source_event_id: ["char(36)", false, null, "ascii_bin"],
    original_base_quantity: ["bigint unsigned"], consumed_base_quantity: ["bigint unsigned", false, "0"], released_base_quantity: ["bigint unsigned", false, "0"],
    outstanding_base_quantity: ["bigint unsigned"], status: ["varchar(30)", false, null, "ascii_bin"], inventory_version: ["int unsigned"],
    created_at: ["bigint unsigned"], updated_at: ["bigint unsigned"] },
  indexes: { PRIMARY: [0, "id"], uq_sales_mapping_reservation: [0, "inventory_reservation_id"],
    uq_sales_mapping_line_event: [0, "sales_order_line_id,source_event_id"], idx_sales_mapping_line_status: [1, "sales_order_line_id,status,id"] },
  foreignKeys: { sales_order_line_id: ["sales_order_lines", "id", "CASCADE"], inventory_reservation_id: ["inventory_reservations", "id", "RESTRICT"],
    inventory_operation_id: ["inventory_operation_requests", "id", "RESTRICT"] },
  checks: { chk_sales_mapping_quantities: "original_base_quantity > 0 AND original_base_quantity = consumed_base_quantity + released_base_quantity + outstanding_base_quantity",
    chk_sales_mapping_status: "status IN ('ACTIVE','PARTIALLY_CONSUMED','CONSUMED','RELEASED','CANCELLED')", chk_sales_mapping_version: "inventory_version > 0" },
  triggers: {
    trg_sales_mapping_insert: ["INSERT", `BEGIN IF NOT ${owner} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Sales reservation mapping disagrees with Inventory'; END IF; END`],
    trg_sales_mapping_update: ["UPDATE", `BEGIN IF NOT (${immutable}) OR NOT ${owner} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Sales reservation mapping identity or projection invalid'; END IF; END`]
  }
};
export const inspectSalesReservationMappingSchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
