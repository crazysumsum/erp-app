// Purchase Order lines（設計 §4.6；TASK-011；HD-012）。
//
// 同設計原文嘅分別（Sam 2026-11-02 批准）：has_outstanding 預設 1、is_over_received 預設 0；
// 加 CHECK：行號 1～100、換算因子 1～1,000,000、數量 > 0、單價／行金額 ≥ 0、tracking 三個值，
// 以及收貨恆等式 gross = net + reversed（反向量永遠唔會超過已收量）。
// Composite FK (purchase_sku_uom_id, sku_id) → item_sku_uoms(id, sku_id) 確保 Purchase UOM 屬於呢個 SKU。
// tracking 用 ascii_bin，令 CHECK 分大小寫。
//
// gross／reversed／net／closed 只由 Lifecycle／Posting／Reversal service 更新，client 唔可以輸入。
// 純新增；CREATE TABLE 喺 MySQL 8.0 係原子 DDL，IF NOT EXISTS 令重跑係 no-op。
export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id                                 BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
      purchase_order_id                  BIGINT UNSIGNED   NOT NULL,
      line_number                        SMALLINT UNSIGNED NOT NULL,
      sku_id                             BIGINT UNSIGNED   NOT NULL,
      sku_code_snapshot                  VARCHAR(190)      NOT NULL,
      sku_name_snapshot                  VARCHAR(190)      NOT NULL,
      tracking_policy_snapshot           VARCHAR(20)       CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      inventory_tracked_snapshot         TINYINT(1)        NOT NULL,
      minimum_receipt_life_days_snapshot INT UNSIGNED      NULL,
      base_uom_id                        BIGINT UNSIGNED   NOT NULL,
      base_uom_code_snapshot             VARCHAR(50)       NOT NULL,
      purchase_sku_uom_id                BIGINT UNSIGNED   NOT NULL,
      purchase_uom_code_snapshot         VARCHAR(50)       NOT NULL,
      uom_to_base_factor_snapshot        INT UNSIGNED      NOT NULL,
      supplier_sku_ref_id                BIGINT UNSIGNED   NULL,
      supplier_item_code_snapshot        VARCHAR(190)      NOT NULL DEFAULT '',
      ordered_quantity                   DECIMAL(20,6)     NOT NULL,
      ordered_base_quantity              BIGINT UNSIGNED   NOT NULL,
      unit_price                         DECIMAL(19,4)     NOT NULL,
      line_amount                        DECIMAL(25,4)     NOT NULL,
      zero_price_reason                  VARCHAR(500)      NOT NULL DEFAULT '',
      expected_delivery_date             DATE              NULL,
      line_note                          VARCHAR(1000)     NOT NULL DEFAULT '',
      gross_received_base_quantity       BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      reversed_base_quantity             BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      net_received_base_quantity         BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      closed_remaining_base_quantity     BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      has_outstanding                    TINYINT(1)        NOT NULL DEFAULT 1,
      is_over_received                   TINYINT(1)        NOT NULL DEFAULT 0,
      close_reason                       VARCHAR(500)      NOT NULL DEFAULT '',
      closed_at                          BIGINT UNSIGNED   NULL,
      closed_by                          BIGINT UNSIGNED   NULL,
      version                            INT UNSIGNED      NOT NULL DEFAULT 1,
      created_at                         BIGINT UNSIGNED   NOT NULL,
      updated_at                         BIGINT UNSIGNED   NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_po_lines_number (purchase_order_id, line_number),
      UNIQUE KEY uq_po_lines_id_po (id, purchase_order_id),
      UNIQUE KEY uq_po_lines_id_sku (id, sku_id),
      KEY idx_po_lines_sku (sku_id, purchase_order_id, id),
      KEY idx_po_lines_outstanding (purchase_order_id, has_outstanding, id),
      KEY idx_po_lines_purchase_uom (purchase_sku_uom_id, sku_id),
      CONSTRAINT chk_po_lines_number CHECK (line_number BETWEEN 1 AND 100),
      CONSTRAINT chk_po_lines_tracking CHECK (tracking_policy_snapshot IN ('none', 'batch', 'batch_expiry')),
      CONSTRAINT chk_po_lines_factor CHECK (uom_to_base_factor_snapshot BETWEEN 1 AND 1000000),
      CONSTRAINT chk_po_lines_quantity CHECK (ordered_quantity > 0 AND ordered_base_quantity > 0),
      CONSTRAINT chk_po_lines_amounts CHECK (unit_price >= 0 AND line_amount >= 0),
      CONSTRAINT chk_po_lines_received CHECK (gross_received_base_quantity = net_received_base_quantity + reversed_base_quantity),
      CONSTRAINT chk_po_lines_flags CHECK (inventory_tracked_snapshot IN (0, 1) AND has_outstanding IN (0, 1)
        AND is_over_received IN (0, 1) AND version >= 1),
      CONSTRAINT fk_po_lines_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_lines_sku FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_lines_base_uom FOREIGN KEY (base_uom_id) REFERENCES item_uoms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_lines_purchase_uom FOREIGN KEY (purchase_sku_uom_id, sku_id)
        REFERENCES item_sku_uoms (id, sku_id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_lines_supplier_sku_ref FOREIGN KEY (supplier_sku_ref_id)
        REFERENCES supplier_sku_refs (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_lines_closed_by FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
