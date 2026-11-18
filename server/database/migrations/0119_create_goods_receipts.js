// Goods Receipt header（設計 §4.9、§4.16；TASK-045 = TASK-027 早期完整 header）。Sam 2026-11-09 批准撰寫（approval package A1），
// 功能驗證（C5）另外批准；編號喺真正基線再確認。goods_receipt_lines／details 仍屬 TASK-027。
//
// - 完整 §4.9 欄位；owner FK：purchase_order_id → purchase_orders RESTRICT，(purchase_order_id, supplier_id) → purchase_orders(id, supplier_id)。
// - CHECK 跟 0112：狀態、flag／version、編號同 document_year_month／sequence_no 一致、真 YYYYMM、序號 1～999999、反向 ≤ 已收，
//   同確認一致性：DRAFT／CANCELLED 冇 confirmed_at 同 confirm_event_id，CONFIRMED／PARTIALLY_REVERSED／REVERSED 一定有。
//   confirmed_by 刻意唔入 CHECK：刪 user 會經 FK SET NULL 清空，唔等於冇確認證據。
// - §4.16：曾經確認（OLD.confirmed_at IS NOT NULL）之後，除咗 reversal 狀態、數量／filter projection 同 updated_*／version，
//   其餘現有欄位（GR_CONFIRMED_FACTS）全部唔准改，亦唔准退返 DRAFT／CANCELLED 或者刪除。FK 嘅 SET NULL 唔會觸發 trigger，
//   所以刪 user 清空 actor 欄仍然合法。
// 純新增；CREATE TABLE 喺 MySQL 8.0 係原子 DDL，IF NOT EXISTS 令重跑係 no-op。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

export const GR_STATUSES = "'DRAFT', 'CONFIRMED', 'PARTIALLY_REVERSED', 'REVERSED', 'CANCELLED'";
// 曾經確認之後只准改 reversal 狀態、數量／filter projection 同 updated_*／version；其餘現有欄位全部凍結。
export const GR_CONFIRMED_FACTS = ["purchase_order_id", "supplier_id", "business_receipt_date", "supplier_delivery_note", "notes", "confirmed_at",
  "confirmed_by", "confirm_event_id", "inventory_result_summary", "gr_number", "document_year_month", "sequence_no",
  "id", "supplier_code_snapshot", "supplier_name_snapshot", "supplier_status_at_confirm", "supplier_exception_reason", "created_at", "created_by",
  "created_by_label", "cancelled_at", "cancelled_by", "cancel_reason"];

const same = (columns) => columns.map((column) => `NEW.${column} <=> OLD.${column}`).join(" AND ");

export const GR_TRIGGERS = Object.freeze({
  trg_goods_receipts_update: ["UPDATE", `BEGIN
    IF OLD.confirmed_at IS NOT NULL AND NOT (${same(GR_CONFIRMED_FACTS)}) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt confirmation facts are immutable after confirmation';
    END IF;
    IF OLD.confirmed_at IS NOT NULL AND NEW.status IN ('DRAFT', 'CANCELLED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Confirmed goods receipts cannot return to DRAFT or CANCELLED';
    END IF;
  END`],
  trg_goods_receipts_delete: ["DELETE", `BEGIN
    IF OLD.confirmed_at IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Confirmed goods receipts cannot be deleted';
    END IF;
  END`]
});

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS goods_receipts (
      id                            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      gr_number                     VARCHAR(20)      CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      document_year_month           CHAR(6)          CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      sequence_no                   INT UNSIGNED     NOT NULL,
      purchase_order_id             BIGINT UNSIGNED  NOT NULL,
      supplier_id                   BIGINT UNSIGNED  NOT NULL,
      supplier_code_snapshot        VARCHAR(64)      NOT NULL,
      supplier_name_snapshot        VARCHAR(190)     NOT NULL,
      business_receipt_date         DATE             NOT NULL,
      supplier_delivery_note        VARCHAR(190)     NOT NULL DEFAULT '',
      notes                         VARCHAR(2000)    NOT NULL DEFAULT '',
      status                        VARCHAR(30)      CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
      supplier_status_at_confirm    VARCHAR(30)      NOT NULL DEFAULT '',
      supplier_exception_reason     VARCHAR(500)     NOT NULL DEFAULT '',
      total_received_base_quantity  BIGINT UNSIGNED  NOT NULL DEFAULT 0,
      total_reversed_base_quantity  BIGINT UNSIGNED  NOT NULL DEFAULT 0,
      has_over_receipt              TINYINT(1)       NOT NULL DEFAULT 0,
      has_expiry_override           TINYINT(1)       NOT NULL DEFAULT 0,
      has_sku_exception             TINYINT(1)       NOT NULL DEFAULT 0,
      version                       INT UNSIGNED     NOT NULL DEFAULT 1,
      created_at                    BIGINT UNSIGNED  NOT NULL,
      updated_at                    BIGINT UNSIGNED  NOT NULL,
      created_by                    BIGINT UNSIGNED  NULL,
      updated_by                    BIGINT UNSIGNED  NULL,
      created_by_label              VARCHAR(190)     NOT NULL,
      updated_by_label              VARCHAR(190)     NOT NULL,
      confirmed_at                  BIGINT UNSIGNED  NULL,
      confirmed_by                  BIGINT UNSIGNED  NULL,
      confirm_event_id              CHAR(36)         CHARACTER SET ascii COLLATE ascii_bin NULL,
      inventory_result_summary      JSON             NULL,
      cancelled_at                  BIGINT UNSIGNED  NULL,
      cancelled_by                  BIGINT UNSIGNED  NULL,
      cancel_reason                 VARCHAR(500)     NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      UNIQUE KEY uq_goods_receipts_number (gr_number),
      UNIQUE KEY uq_goods_receipts_sequence (document_year_month, sequence_no),
      UNIQUE KEY uq_gr_id_po (id, purchase_order_id),
      UNIQUE KEY uq_goods_receipts_confirm_event (confirm_event_id),
      KEY idx_gr_list (status, business_receipt_date, id),
      KEY idx_gr_po (purchase_order_id, status, id),
      KEY idx_gr_supplier (supplier_id, business_receipt_date, id),
      KEY idx_gr_delivery_note (supplier_id, supplier_delivery_note, business_receipt_date, id),
      KEY idx_gr_flags (has_over_receipt, has_expiry_override, has_sku_exception, business_receipt_date, id),
      CONSTRAINT chk_gr_status CHECK (status IN (${GR_STATUSES})),
      CONSTRAINT chk_gr_flags CHECK (has_over_receipt IN (0, 1) AND has_expiry_override IN (0, 1) AND has_sku_exception IN (0, 1) AND version >= 1),
      CONSTRAINT chk_gr_number CHECK (gr_number = CONCAT('GR-', document_year_month, '-', LPAD(sequence_no, 6, '0'))),
      CONSTRAINT chk_gr_month CHECK (document_year_month REGEXP '^[0-9]{4}(0[1-9]|1[0-2])$'),
      CONSTRAINT chk_gr_sequence CHECK (sequence_no BETWEEN 1 AND 999999),
      CONSTRAINT chk_gr_quantity CHECK (total_reversed_base_quantity <= total_received_base_quantity),
      CONSTRAINT chk_gr_confirmation CHECK (
        (status IN ('DRAFT', 'CANCELLED') AND confirmed_at IS NULL AND confirm_event_id IS NULL)
        OR (status IN ('CONFIRMED', 'PARTIALLY_REVERSED', 'REVERSED') AND confirmed_at IS NOT NULL AND confirm_event_id IS NOT NULL)),
      CONSTRAINT fk_gr_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_po_supplier FOREIGN KEY (purchase_order_id, supplier_id) REFERENCES purchase_orders (id, supplier_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_gr_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_gr_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_gr_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "goods_receipts", GR_TRIGGERS);
}
