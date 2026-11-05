// PO 審批記錄（設計 §4.7、§4.16；TASK-022；HD-020）。純新增，唔改任何既有表。
//
// pending_slot + UNIQUE 令每張 PO 最多一個待審批。快照上限係 1MiB（HD-020 A）：設計原本寫 64KiB，但合法嘅 100 行 PO 會超過。
// 「唔可以自批」只可以由 service 驗：MySQL 唔准 CHECK 用有 SET NULL 動作嘅 FK 欄位，所以 decided_by 亦唔入 CHECK。
// 刪 user 時 FK 嘅 SET NULL 照樣生效：FK action 唔會觸發 trigger。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

export const APPROVAL_PROTECTED = ["id", "purchase_order_id", "purchase_order_version", "settings_version", "requested_by", "assigned_approver_id",
  "requested_by_label", "approver_label", "approval_snapshot", "snapshot_hash", "request_note", "requested_at"];

const same = (columns) => columns.map((column) => `NEW.${column} <=> OLD.${column}`).join(" AND ");

export const APPROVAL_TRIGGERS = Object.freeze({
  trg_po_approvals_insert: ["INSERT", `BEGIN
    IF NEW.status <> 'PENDING' OR NEW.decided_at IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decision_reason <> '' OR NEW.version <> 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order approvals must start as PENDING';
    END IF;
  END`],
  trg_po_approvals_update: ["UPDATE", `BEGIN
    IF OLD.status <> 'PENDING' OR NEW.status = 'PENDING' OR NEW.version <> OLD.version + 1 OR NOT (${same(APPROVAL_PROTECTED)}) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order approvals are immutable except for one decision';
    END IF;
  END`],
  trg_po_approvals_delete: ["DELETE",
    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order approvals cannot be deleted'"]
});

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchase_order_approvals (
      id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      purchase_order_id      BIGINT UNSIGNED NOT NULL,
      purchase_order_version INT UNSIGNED    NOT NULL,
      settings_version       INT UNSIGNED    NOT NULL,
      requested_by           BIGINT UNSIGNED NULL,
      assigned_approver_id   BIGINT UNSIGNED NULL,
      requested_by_label     VARCHAR(190)    NOT NULL,
      approver_label         VARCHAR(190)    NOT NULL,
      approval_snapshot      JSON            NOT NULL,
      snapshot_hash          CHAR(64)        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status                 VARCHAR(20)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
      pending_slot           TINYINT         GENERATED ALWAYS AS (IF(status = 'PENDING', 1, NULL)) STORED,
      request_note           VARCHAR(500)    NOT NULL DEFAULT '',
      decision_reason        VARCHAR(500)    NOT NULL DEFAULT '',
      requested_at           BIGINT UNSIGNED NOT NULL,
      decided_at             BIGINT UNSIGNED NULL,
      decided_by             BIGINT UNSIGNED NULL,
      version                INT UNSIGNED    NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_po_approvals_pending (purchase_order_id, pending_slot),
      KEY idx_po_approvals_assignee (assigned_approver_id, status, requested_at, id),
      KEY idx_po_approvals_po (purchase_order_id, requested_at, id),
      CONSTRAINT chk_po_approvals_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'INVALIDATED')),
      CONSTRAINT chk_po_approvals_decided CHECK ((status = 'PENDING') = (decided_at IS NULL)),
      CONSTRAINT chk_po_approvals_reject_reason CHECK (status <> 'REJECTED' OR decision_reason <> ''),
      CONSTRAINT chk_po_approvals_snapshot_size CHECK (JSON_STORAGE_SIZE(approval_snapshot) <= 1048576),
      CONSTRAINT chk_po_approvals_hash CHECK (snapshot_hash REGEXP '^[0-9a-f]{64}$'),
      CONSTRAINT chk_po_approvals_version CHECK (version >= 1),
      CONSTRAINT fk_po_approvals_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_approvals_requested_by FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_po_approvals_approver FOREIGN KEY (assigned_approver_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_po_approvals_decided_by FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "purchase_order_approvals", APPROVAL_TRIGGERS);
}
