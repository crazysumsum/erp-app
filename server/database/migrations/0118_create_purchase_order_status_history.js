// PO 狀態歷史（設計 §4.8、§4.16；TASK-022）。純新增；只准 INSERT／SELECT。
// 刪 user 時 actor_user_id 嘅 ON DELETE SET NULL 照樣生效：FK action 唔會觸發 trigger。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

export const STATUS_HISTORY_TRIGGERS = Object.freeze({
  trg_po_status_history_update: ["UPDATE",
    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order status history is append-only'"],
  trg_po_status_history_delete: ["DELETE",
    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order status history is append-only'"]
});

const STATUSES = "'DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED'";

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchase_order_status_history (
      id                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      purchase_order_id            BIGINT UNSIGNED NOT NULL,
      sequence_no                  INT UNSIGNED    NOT NULL,
      from_status                  VARCHAR(30)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      to_status                    VARCHAR(30)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      action                       VARCHAR(50)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason                       VARCHAR(500)    NOT NULL DEFAULT '',
      purchase_order_version_after INT UNSIGNED    NOT NULL,
      event_id                     CHAR(36)        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_user_id                BIGINT UNSIGNED NULL,
      actor_label                  VARCHAR(190)    NOT NULL,
      occurred_at                  BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_po_status_history_sequence (purchase_order_id, sequence_no),
      KEY idx_po_status_history_po (purchase_order_id, occurred_at, id),
      CONSTRAINT chk_po_status_history_from CHECK (from_status IN ('', ${STATUSES})),
      CONSTRAINT chk_po_status_history_to CHECK (to_status IN (${STATUSES})),
      CONSTRAINT chk_po_status_history_action CHECK (action IN ('CREATE', 'SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW', 'CONFIRM', 'RECEIVE', 'CLOSE', 'CANCEL', 'REVERSE')),
      CONSTRAINT chk_po_status_history_sequence CHECK (sequence_no >= 1),
      CONSTRAINT fk_po_status_history_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_status_history_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "purchase_order_status_history", STATUS_HISTORY_TRIGGERS);
}
