import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

// Sam approved TABLES-RECEIPT-REVERSAL.md at 375b3a1b (SHA-256 ded03165…).
const immutable = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt reversals are immutable'";

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS goods_receipt_reversals (
      id                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      goods_receipt_id             BIGINT UNSIGNED NOT NULL,
      reversal_sequence            SMALLINT UNSIGNED NOT NULL,
      reversal_reference           VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status                       VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'POSTED',
      event_id                     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason                       VARCHAR(500) NOT NULL,
      total_reversed_base_quantity BIGINT UNSIGNED NOT NULL,
      inventory_result_summary     JSON NOT NULL,
      confirmed_at                 BIGINT UNSIGNED NOT NULL,
      confirmed_by                 BIGINT UNSIGNED NULL,
      confirmed_by_label           VARCHAR(190) NOT NULL,
      request_id                   VARCHAR(64) NOT NULL DEFAULT '',
      correlation_id               VARCHAR(64) NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      UNIQUE KEY uq_gr_reversal_sequence (goods_receipt_id, reversal_sequence),
      UNIQUE KEY uq_gr_reversal_reference (reversal_reference),
      UNIQUE KEY uq_gr_reversal_event (event_id),
      UNIQUE KEY uq_gr_reversal_id_receipt (id, goods_receipt_id),
      CONSTRAINT fk_gr_reversal_receipt FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_gr_reversal_actor FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT chk_gr_reversal_status CHECK (status = 'POSTED'),
      CONSTRAINT chk_gr_reversal_quantity CHECK (total_reversed_base_quantity > 0),
      CONSTRAINT chk_gr_reversal_sequence CHECK (reversal_sequence >= 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS goods_receipt_reversal_details (
      id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      reversal_id                    BIGINT UNSIGNED NOT NULL,
      goods_receipt_id               BIGINT UNSIGNED NOT NULL,
      goods_receipt_detail_id        BIGINT UNSIGNED NOT NULL,
      purchase_order_line_id         BIGINT UNSIGNED NOT NULL,
      sku_id                         BIGINT UNSIGNED NOT NULL,
      reversed_base_quantity         BIGINT UNSIGNED NOT NULL,
      original_inventory_movement_id BIGINT UNSIGNED NOT NULL,
      reversal_inventory_movement_id BIGINT UNSIGNED NOT NULL,
      reversal_inventory_operation_id BIGINT UNSIGNED NOT NULL,
      created_at                     BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_gr_reversal_detail_movement (reversal_inventory_movement_id),
      UNIQUE KEY uq_gr_reversal_detail_source (reversal_id, goods_receipt_detail_id),
      KEY idx_gr_reversal_detail_source (goods_receipt_detail_id, id),
      CONSTRAINT fk_gr_reversal_detail_owner FOREIGN KEY (reversal_id, goods_receipt_id)
        REFERENCES goods_receipt_reversals (id, goods_receipt_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_gr_reversal_detail_receipt_detail FOREIGN KEY (goods_receipt_detail_id)
        REFERENCES goods_receipt_details (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_gr_reversal_detail_po_line FOREIGN KEY (purchase_order_line_id)
        REFERENCES purchase_order_lines (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_gr_reversal_detail_original_movement FOREIGN KEY (original_inventory_movement_id)
        REFERENCES inventory_movements (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_gr_reversal_detail_reversal_movement FOREIGN KEY (reversal_inventory_movement_id)
        REFERENCES inventory_movements (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_gr_reversal_detail_operation FOREIGN KEY (reversal_inventory_operation_id)
        REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT chk_gr_reversal_detail_quantity CHECK (reversed_base_quantity > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "goods_receipt_reversals", {
    trg_gr_reversals_update: ["UPDATE", immutable],
    trg_gr_reversals_delete: ["DELETE", immutable]
  });
  await ensureTriggers(connection, "goods_receipt_reversal_details", {
    trg_gr_reversal_details_update: ["UPDATE", immutable],
    trg_gr_reversal_details_delete: ["DELETE", immutable]
  });
}
