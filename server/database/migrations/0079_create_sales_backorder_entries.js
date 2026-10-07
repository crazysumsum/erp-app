import { inspectSalesTable } from "./0070_create_sales_quotations.js";

const scope = `EXISTS (SELECT 1 FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id
  WHERE l.id=NEW.sales_order_line_id AND l.sales_order_id=NEW.sales_order_id AND l.line_no=NEW.line_no
    AND l.sku_id=NEW.sku_id AND o.fulfillment_warehouse_id=NEW.warehouse_id AND NEW.outstanding_base_quantity<=l.ordered_base_quantity)`;
const immutable = ["id", "sales_order_id", "sales_order_line_id", "line_no", "warehouse_id", "sku_id", "priority_at", "created_at"]
  .map(field => `(NEW.${field} <=> OLD.${field})`).join(" AND ");
const CONTRACT = {
  table: "sales_backorder_entries",
  columns: { id: ["bigint unsigned", false, null, null, "auto_increment"], sales_order_id: ["bigint unsigned"], sales_order_line_id: ["bigint unsigned"],
    line_no: ["smallint unsigned"], warehouse_id: ["bigint unsigned"], sku_id: ["bigint unsigned"], outstanding_base_quantity: ["bigint unsigned"],
    status: ["varchar(20)", false, null, "ascii_bin"], priority_at: ["bigint unsigned"], last_allocation_event_id: ["char(36)", true, null, "ascii_bin"],
    next_attempt_at: ["bigint unsigned"], last_attempt_at: ["bigint unsigned", true], attempt_count: ["int unsigned", false, "0"],
    last_error_code: ["varchar(80)", false, "", "ascii_bin"], version: ["int unsigned", false, "1"], created_at: ["bigint unsigned"], updated_at: ["bigint unsigned"] },
  indexes: { PRIMARY: [0, "id"], uq_sales_backorder_line: [0, "sales_order_line_id"],
    idx_sales_backorder_fifo: [1, "status,warehouse_id,sku_id,priority_at,sales_order_id,line_no,id"], idx_sales_backorder_retry: [1, "status,next_attempt_at,id"] },
  foreignKeys: { sales_order_line_id: ["sales_order_lines", "id", "CASCADE"], sales_order_id: ["sales_order_lines", "sales_order_id", "CASCADE"],
    warehouse_id: ["inventory_warehouses", "id", "RESTRICT"], sku_id: ["item_skus", "id", "RESTRICT"] },
  checks: { chk_sales_backorder_status: "status IN ('OPEN','FULFILLED','CANCELLED')",
    chk_sales_backorder_quantity: "(status = 'OPEN') = (outstanding_base_quantity > 0)",
    chk_sales_backorder_version: "version > 0 AND line_no BETWEEN 1 AND 100" },
  triggers: {
    trg_sales_backorder_insert: ["INSERT", `BEGIN IF NOT ${scope} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Sales Backorder scope invalid'; END IF; END`],
    trg_sales_backorder_update: ["UPDATE", `BEGIN IF NOT (${immutable}) OR NOT ${scope} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Sales Backorder FIFO identity or scope invalid'; END IF; END`]
  }
};

async function inspect(connection, options) {
  if (!await inspectSalesTable(connection, CONTRACT, options)) return false;
  const [rows] = await connection.query(`SELECT constraint_name AS name,column_name AS field,ordinal_position AS position
    FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name=? AND referenced_table_name='sales_order_lines'
    ORDER BY ordinal_position`, [CONTRACT.table]);
  if (rows.length !== 2 || rows[0].name !== rows[1].name || rows[0].field !== "sales_order_line_id" || rows[1].field !== "sales_order_id" ||
      Number(rows[0].position) !== 1 || Number(rows[1].position) !== 2) throw new Error("Incompatible existing Sales Backorder composite owner FK");
  return true;
}
export const inspectSalesBackorderSchema = connection => inspect(connection);
export async function up(connection) {
  if (!await inspect(connection, { allowMissingTriggers: true })) {
    await connection.query(`CREATE TABLE IF NOT EXISTS sales_backorder_entries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, sales_order_id BIGINT UNSIGNED NOT NULL, sales_order_line_id BIGINT UNSIGNED NOT NULL,
      line_no SMALLINT UNSIGNED NOT NULL, warehouse_id BIGINT UNSIGNED NOT NULL, sku_id BIGINT UNSIGNED NOT NULL,
      outstanding_base_quantity BIGINT UNSIGNED NOT NULL, status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      priority_at BIGINT UNSIGNED NOT NULL, last_allocation_event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      next_attempt_at BIGINT UNSIGNED NOT NULL, last_attempt_at BIGINT UNSIGNED NULL, attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
      last_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '', version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at BIGINT UNSIGNED NOT NULL, updated_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id), UNIQUE KEY uq_sales_backorder_line (sales_order_line_id),
      KEY idx_sales_backorder_fifo (status,warehouse_id,sku_id,priority_at,sales_order_id,line_no,id),
      KEY idx_sales_backorder_retry (status,next_attempt_at,id),
      CONSTRAINT fk_sales_backorder_owner FOREIGN KEY (sales_order_line_id,sales_order_id) REFERENCES sales_order_lines (id,sales_order_id) ON DELETE CASCADE,
      CONSTRAINT fk_sales_backorder_warehouse FOREIGN KEY (warehouse_id) REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
      CONSTRAINT fk_sales_backorder_sku FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT,
      CONSTRAINT chk_sales_backorder_status CHECK (status IN ('OPEN','FULFILLED','CANCELLED')),
      CONSTRAINT chk_sales_backorder_quantity CHECK ((status='OPEN')=(outstanding_base_quantity>0)),
      CONSTRAINT chk_sales_backorder_version CHECK (version>0 AND line_no BETWEEN 1 AND 100)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  for (const [name, [event, statement]] of Object.entries(CONTRACT.triggers)) {
    const [found] = await connection.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?", [name]);
    if (!found.length) await connection.query(`CREATE TRIGGER ${name} BEFORE ${event} ON sales_backorder_entries FOR EACH ROW ${statement}`);
  }
  if (!await inspect(connection)) throw new Error("Sales Backorder schema was not created");
}
