// Purchasing audit（設計 §4.15；TASK-012）：只准 INSERT／SELECT，trigger 拒絕 UPDATE／DELETE，保留 7 年。
// Schema 冇任何敏感欄（password、token、Supplier 銀行資料）；detail 上限 8192 bytes 同 auditDetailMaxBytes 一致。
// 刪 user 時 actor_user_id 嘅 ON DELETE SET NULL 照樣生效：MySQL 嘅 FK action 唔會觸發 trigger。
// 純新增。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

export const AUDIT_TRIGGERS = Object.freeze({
  trg_purchasing_audit_update: ["UPDATE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchasing_audit_logs is immutable'"],
  trg_purchasing_audit_delete: ["DELETE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchasing_audit_logs is immutable'"]
});

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchasing_audit_logs (
      id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      occurred_at       BIGINT UNSIGNED NOT NULL,
      actor_user_id     BIGINT UNSIGNED NULL,
      actor_label       VARCHAR(190)    NOT NULL,
      action            VARCHAR(80)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      outcome           VARCHAR(20)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_type       VARCHAR(30)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_id         BIGINT UNSIGNED NULL,
      purchase_order_id BIGINT UNSIGNED NULL,
      goods_receipt_id  BIGINT UNSIGNED NULL,
      target_label      VARCHAR(190)    NOT NULL DEFAULT '',
      reason            VARCHAR(500)    NOT NULL DEFAULT '',
      detail            JSON            NULL,
      request_id        VARCHAR(64)     NOT NULL DEFAULT '',
      correlation_id    VARCHAR(64)     NOT NULL DEFAULT '',
      ip                VARCHAR(45)     NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      KEY idx_purchasing_audit_time (occurred_at, id),
      KEY idx_purchasing_audit_po (purchase_order_id, occurred_at, id),
      KEY idx_purchasing_audit_gr (goods_receipt_id, occurred_at, id),
      KEY idx_purchasing_audit_actor (actor_user_id, occurred_at, id),
      KEY idx_purchasing_audit_action (action, outcome, occurred_at, id),
      CONSTRAINT chk_purchasing_audit_outcome CHECK (outcome IN ('SUCCEEDED', 'REJECTED', 'FAILED')),
      CONSTRAINT chk_purchasing_audit_target CHECK (target_type IN ('PO', 'PO_LINE', 'APPROVAL', 'SETTING', 'GR', 'GR_DETAIL',
        'REVERSAL', 'EXPORT')),
      CONSTRAINT chk_purchasing_audit_detail CHECK (detail IS NULL OR LENGTH(CAST(detail AS CHAR CHARSET utf8mb4)) <= 8192),
      CONSTRAINT fk_purchasing_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "purchasing_audit_logs", AUDIT_TRIGGERS);
}
