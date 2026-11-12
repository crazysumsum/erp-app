// Goods Receipt Line（設計 §4.10、§4.16；TASK-027）。Sam 2026-11-12 按名批准 SCHEMA.md fcb8f876（call_cb2041d1）。
// 一張 GR 對一條 PO Line 嘅合計同例外記錄，唔係實際庫位（嗰個係 detail，0121）。
// - 照 §4.10 欄位、兩個 UNIQUE、三個 composite FK 同兩個 index；全部 FK RESTRICT（MySQL 預設，同 0119）。
// - 加一個 §4.10 冇列嘅 UNIQUE(id, goods_receipt_id)（TL fe6897bd 裁定）：0121 嘅 (goods_receipt_line_id, goods_receipt_id) FK
//   要 parent 有以呢兩欄開頭嘅 unique key，單靠 PK(id) 唔夠；同 uq_gr_id_po、uq_po_lines_id_po 同一做法。
// - §4.16：parent GR 曾經確認（confirmed_at IS NOT NULL，完全 Reversal 之後都係）就全部凍結：唔准 INSERT、UPDATE、DELETE，
//   亦唔准把 line 搬去已確認嘅 GR；INSERT 都擋係同 HD-014 對 PO lines 一樣，防止刪咗再加或者直接加行繞過凍結。
// 純新增；CREATE TABLE 喺 MySQL 8.0 係原子 DDL，IF NOT EXISTS 令重跑係 no-op。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

const parentConfirmed = (row) => `(SELECT confirmed_at FROM goods_receipts WHERE id = ${row}.goods_receipt_id) IS NOT NULL`;

export const GR_LINE_TRIGGERS = Object.freeze({
  trg_gr_lines_insert: ["INSERT", `BEGIN
    IF ${parentConfirmed("NEW")} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt lines cannot be added after confirmation';
    END IF;
  END`],
  trg_gr_lines_update: ["UPDATE", `BEGIN
    IF ${parentConfirmed("OLD")} OR ${parentConfirmed("NEW")} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt lines are immutable after confirmation';
    END IF;
  END`],
  trg_gr_lines_delete: ["DELETE", `BEGIN
    IF ${parentConfirmed("OLD")} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt lines cannot be removed after confirmation';
    END IF;
  END`]
});

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS goods_receipt_lines (
      id                                    BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
      goods_receipt_id                      BIGINT UNSIGNED   NOT NULL,
      purchase_order_id                     BIGINT UNSIGNED   NOT NULL,
      purchase_order_line_id                BIGINT UNSIGNED   NOT NULL,
      line_number                           SMALLINT UNSIGNED NOT NULL,
      sku_id                                BIGINT UNSIGNED   NOT NULL,
      sku_code_snapshot                     VARCHAR(190)      NOT NULL,
      sku_name_snapshot                     VARCHAR(190)      NOT NULL,
      received_base_quantity                BIGINT UNSIGNED   NOT NULL,
      po_outstanding_before_base_quantity   BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      over_received_base_quantity           BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      over_receipt_reason                   VARCHAR(500)      NOT NULL DEFAULT '',
      item_status_at_confirm                VARCHAR(20)       NOT NULL DEFAULT '',
      sku_status_at_confirm                 VARCHAR(20)       NOT NULL DEFAULT '',
      purchasable_at_confirm                TINYINT(1)        NULL,
      inventory_tracked_at_confirm          TINYINT(1)        NULL,
      current_tracking_policy               VARCHAR(20)       NOT NULL DEFAULT '',
      sku_warning_codes                     JSON              NULL,
      sku_exception_reason                  VARCHAR(500)      NOT NULL DEFAULT '',
      po_net_received_after_base_quantity   BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      created_at                            BIGINT UNSIGNED   NOT NULL,
      updated_at                            BIGINT UNSIGNED   NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_gr_lines_po_line (goods_receipt_id, purchase_order_line_id),
      UNIQUE KEY uq_gr_lines_number (goods_receipt_id, line_number),
      UNIQUE KEY uq_gr_lines_id_gr (id, goods_receipt_id),
      KEY idx_gr_lines_po_line (purchase_order_line_id, goods_receipt_id, id),
      KEY idx_gr_lines_sku (sku_id, goods_receipt_id, id),
      CONSTRAINT fk_gr_lines_gr_po FOREIGN KEY (goods_receipt_id, purchase_order_id) REFERENCES goods_receipts (id, purchase_order_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_lines_po_line FOREIGN KEY (purchase_order_line_id, purchase_order_id) REFERENCES purchase_order_lines (id, purchase_order_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_lines_po_line_sku FOREIGN KEY (purchase_order_line_id, sku_id) REFERENCES purchase_order_lines (id, sku_id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "goods_receipt_lines", GR_LINE_TRIGGERS);
}
