import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

// Approved TABLES-RETURNS.md at 375b3a1b (sha256 1cd4be1d…).
const ASCII = "CHARACTER SET ascii COLLATE ascii_bin";
const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
const LIFECYCLE = `
      return_date       DATE          NOT NULL,
      reason            VARCHAR(500)  NOT NULL,
      version           INT UNSIGNED  NOT NULL DEFAULT 1,
      posted_event_id   CHAR(36)       ${ASCII} NULL,
      created_by        BIGINT UNSIGNED NULL,
      created_by_label  VARCHAR(190)  NOT NULL,
      created_at        BIGINT UNSIGNED NOT NULL,
      posted_by         BIGINT UNSIGNED NULL,
      posted_by_label   VARCHAR(190)  NOT NULL DEFAULT '',
      posted_at         BIGINT UNSIGNED NULL,
      cancelled_by      BIGINT UNSIGNED NULL,
      cancelled_at      BIGINT UNSIGNED NULL,
      updated_at        BIGINT UNSIGNED NOT NULL`;

const HEADER_CHECKS = `
      CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
      CHECK (status <> 'POSTED' OR posted_at IS NOT NULL),
      CHECK (version >= 1)`;

const ACTOR_FOREIGN_KEYS = `
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL`;

function refuseWhen(condition) {
  return `BEGIN
    IF ${condition} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted customer return is immutable';
    END IF;
  END`;
}

const postedParent = row => `EXISTS (
  SELECT 1 FROM customer_returns WHERE id = ${row}.return_id AND status = 'POSTED'
)`;

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS returns_operation_requests (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_id        CHAR(36) ${ASCII} NOT NULL,
      command_type    VARCHAR(40) ${ASCII} NOT NULL,
      target_type     VARCHAR(20) ${ASCII} NOT NULL,
      target_id       BIGINT UNSIGNED NOT NULL DEFAULT 0,
      request_hash    CHAR(64) ${ASCII} NOT NULL,
      actor_user_id   BIGINT UNSIGNED NULL,
      actor_label     VARCHAR(190) NOT NULL,
      result_summary  JSON NULL,
      created_at      BIGINT UNSIGNED NOT NULL,
      completed_at    BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_returns_operation_event (event_id),
      KEY idx_returns_operation_target (target_type, target_id, id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_returns (
      id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      status                  VARCHAR(20) ${ASCII} NOT NULL DEFAULT 'DRAFT',
      shipment_id             BIGINT UNSIGNED NOT NULL,
      customer_id             BIGINT UNSIGNED NOT NULL,
      customer_code_snapshot  VARCHAR(100) NOT NULL,
      customer_name_snapshot  VARCHAR(190) NOT NULL,${LIFECYCLE},
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_return_source (id, shipment_id),
      KEY idx_customer_return_shipment (shipment_id, status, id),
      KEY idx_customer_return_customer (customer_id, return_date, id),
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,${ACTOR_FOREIGN_KEYS},${HEADER_CHECKS}
    ) ${TABLE_OPTIONS}
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_return_lines (
      id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      return_id                BIGINT UNSIGNED NOT NULL,
      shipment_id              BIGINT UNSIGNED NOT NULL,
      line_no                  SMALLINT UNSIGNED NOT NULL,
      shipment_issue_detail_id BIGINT UNSIGNED NOT NULL,
      base_quantity            BIGINT UNSIGNED NOT NULL,
      bin_id                   BIGINT UNSIGNED NOT NULL,
      inventory_movement_id    BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_return_line_no (return_id, line_no),
      UNIQUE KEY uq_customer_return_movement (inventory_movement_id),
      KEY idx_customer_return_issue (shipment_issue_detail_id, id),
      FOREIGN KEY (return_id, shipment_id) REFERENCES customer_returns(id, shipment_id) ON DELETE RESTRICT,
      FOREIGN KEY (shipment_issue_detail_id, shipment_id) REFERENCES shipment_issue_details(id, shipment_id) ON DELETE RESTRICT,
      FOREIGN KEY (bin_id) REFERENCES inventory_bins(id) ON DELETE RESTRICT,
      FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements(id) ON DELETE RESTRICT,
      CHECK (base_quantity > 0)
    ) ${TABLE_OPTIONS}
  `);
  await ensureTriggers(connection, "customer_returns", {
    trg_customer_returns_update: ["UPDATE", refuseWhen("OLD.status = 'POSTED'")],
    trg_customer_returns_delete: ["DELETE", refuseWhen("OLD.status = 'POSTED'")]
  });
  await ensureTriggers(connection, "customer_return_lines", {
    trg_customer_return_lines_insert: ["INSERT", refuseWhen(postedParent("NEW"))],
    trg_customer_return_lines_update: ["UPDATE", refuseWhen(`${postedParent("OLD")} OR ${postedParent("NEW")}`)],
    trg_customer_return_lines_delete: ["DELETE", refuseWhen(postedParent("OLD"))]
  });

  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_returns (
      id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      status                  VARCHAR(20) ${ASCII} NOT NULL DEFAULT 'DRAFT',
      goods_receipt_id        BIGINT UNSIGNED NOT NULL,
      purchase_order_id       BIGINT UNSIGNED NOT NULL,
      supplier_id             BIGINT UNSIGNED NOT NULL,
      supplier_code_snapshot  VARCHAR(64) NOT NULL,
      supplier_name_snapshot  VARCHAR(190) NOT NULL,${LIFECYCLE},
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_return_source (id, goods_receipt_id),
      KEY idx_supplier_return_receipt (goods_receipt_id, status, id),
      KEY idx_supplier_return_supplier (supplier_id, return_date, id),
      FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts(id) ON DELETE RESTRICT,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,${ACTOR_FOREIGN_KEYS},${HEADER_CHECKS}
    ) ${TABLE_OPTIONS}
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_return_lines (
      id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      return_id               BIGINT UNSIGNED NOT NULL,
      goods_receipt_id         BIGINT UNSIGNED NOT NULL,
      line_no                 SMALLINT UNSIGNED NOT NULL,
      goods_receipt_detail_id  BIGINT UNSIGNED NOT NULL,
      base_quantity           BIGINT UNSIGNED NOT NULL,
      bin_id                  BIGINT UNSIGNED NOT NULL,
      stock_status            VARCHAR(20) ${ASCII} NOT NULL,
      inventory_movement_id   BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_return_line_no (return_id, line_no),
      UNIQUE KEY uq_supplier_return_movement (inventory_movement_id),
      KEY idx_supplier_return_detail (goods_receipt_detail_id, id),
      FOREIGN KEY (return_id, goods_receipt_id) REFERENCES supplier_returns(id, goods_receipt_id) ON DELETE RESTRICT,
      FOREIGN KEY (goods_receipt_detail_id) REFERENCES goods_receipt_details(id) ON DELETE RESTRICT,
      FOREIGN KEY (bin_id) REFERENCES inventory_bins(id) ON DELETE RESTRICT,
      FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements(id) ON DELETE RESTRICT,
      CHECK (base_quantity > 0)
    ) ${TABLE_OPTIONS}
  `);
}
