// Goods Receipt Detail（設計 §4.11、§4.16；TASK-027）。Sam 2026-11-12 按名批准 SCHEMA.md fcb8f876（call_cb2041d1）。
// Physical bucket：SKU、Lot、Warehouse、Bin、Stock status；Inventory 入庫嘅 sourceLineId。
// - 照 §4.11 欄位、三個 UNIQUE、四個 composite FK、(bin_id, warehouse_id) FK、單欄 FK 同三個 index；全部 RESTRICT，
//   只有 expiry_override_by 係 SET NULL（刪 user 唔觸發 trigger，同 0119 一樣）。stock_status 唔加 CHECK（設計冇列，由 service 保證）。
// - §4.11／§4.16：parent GR 曾經確認（confirmed_at IS NOT NULL）之後，UPDATE 只准 reversed_base_quantity 同 updated_at 變
//   （TL fe6897bd 裁定，同 0119 header 准 updated_* 一致），其餘任何一欄變就 SIGNAL；唔准 DELETE，亦唔准 INSERT（同 HD-014）。
//   「只有 Reversal 可以改 reversed_base_quantity」係 service 規則，trigger 分唔到係邊個 transaction。
// 純新增；IF NOT EXISTS 令重跑係 no-op。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

const parentConfirmed = (row) => `(SELECT confirmed_at FROM goods_receipts WHERE id = ${row}.goods_receipt_id) IS NOT NULL`;
// 曾經確認之後凍結嘅欄位：除咗 reversed_base_quantity 同 updated_at 之外全部。
export const GR_DETAIL_FROZEN = ["id", "goods_receipt_id", "goods_receipt_line_id", "purchase_order_id", "purchase_order_line_id", "detail_number",
  "sku_id", "sku_code_snapshot", "sku_name_snapshot", "input_uom_id", "input_uom_code_snapshot", "uom_to_base_factor_snapshot", "received_quantity",
  "received_base_quantity", "warehouse_id", "bin_id", "warehouse_code_snapshot", "bin_code_snapshot", "tracking_policy_applied", "lot_number",
  "normalized_lot_number", "expiry_date", "manufacture_date", "stock_status", "minimum_life_days_applied", "actual_remaining_life_days",
  "expiry_override_reason", "expiry_override_by", "inventory_operation_request_id", "inventory_movement_id", "inventory_movement_group_id",
  "confirmed_at", "created_at"];
const same = (columns) => columns.map((column) => `NEW.${column} <=> OLD.${column}`).join(" AND ");

export const GR_DETAIL_TRIGGERS = Object.freeze({
  trg_gr_details_insert: ["INSERT", `BEGIN
    IF ${parentConfirmed("NEW")} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt details cannot be added after confirmation';
    END IF;
  END`],
  trg_gr_details_update: ["UPDATE", `BEGIN
    IF ${parentConfirmed("OLD")} AND NOT (${same(GR_DETAIL_FROZEN)}) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt detail physical facts are immutable after confirmation';
    END IF;
  END`],
  trg_gr_details_delete: ["DELETE", `BEGIN
    IF ${parentConfirmed("OLD")} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Goods receipt details cannot be removed after confirmation';
    END IF;
  END`]
});

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS goods_receipt_details (
      id                              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
      goods_receipt_id                BIGINT UNSIGNED   NOT NULL,
      goods_receipt_line_id           BIGINT UNSIGNED   NOT NULL,
      purchase_order_id               BIGINT UNSIGNED   NOT NULL,
      purchase_order_line_id          BIGINT UNSIGNED   NOT NULL,
      detail_number                   SMALLINT UNSIGNED NOT NULL,
      sku_id                          BIGINT UNSIGNED   NOT NULL,
      sku_code_snapshot               VARCHAR(190)      NOT NULL,
      sku_name_snapshot               VARCHAR(190)      NOT NULL,
      input_uom_id                    BIGINT UNSIGNED   NOT NULL,
      input_uom_code_snapshot         VARCHAR(50)       NOT NULL,
      uom_to_base_factor_snapshot     INT UNSIGNED      NOT NULL,
      received_quantity               DECIMAL(20,6)     NOT NULL,
      received_base_quantity          BIGINT UNSIGNED   NOT NULL,
      warehouse_id                    BIGINT UNSIGNED   NOT NULL,
      bin_id                          BIGINT UNSIGNED   NOT NULL,
      warehouse_code_snapshot         VARCHAR(50)       NOT NULL,
      bin_code_snapshot               VARCHAR(50)       NOT NULL,
      tracking_policy_applied         VARCHAR(20)       NOT NULL,
      lot_number                      VARCHAR(100)      NOT NULL DEFAULT '',
      normalized_lot_number           VARCHAR(100)      NOT NULL DEFAULT '',
      expiry_date                     DATE              NULL,
      manufacture_date                DATE              NULL,
      stock_status                    VARCHAR(20)       NOT NULL,
      minimum_life_days_applied       INT UNSIGNED      NULL,
      actual_remaining_life_days      INT               NULL,
      expiry_override_reason          VARCHAR(500)      NOT NULL DEFAULT '',
      expiry_override_by              BIGINT UNSIGNED   NULL,
      reversed_base_quantity          BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      inventory_operation_request_id  BIGINT UNSIGNED   NULL,
      inventory_movement_id           BIGINT UNSIGNED   NULL,
      inventory_movement_group_id     CHAR(36)          NOT NULL DEFAULT '',
      confirmed_at                    BIGINT UNSIGNED   NULL,
      created_at                      BIGINT UNSIGNED   NOT NULL,
      updated_at                      BIGINT UNSIGNED   NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_gr_details_number (goods_receipt_id, detail_number),
      UNIQUE KEY uq_gr_detail_dimension (goods_receipt_id, purchase_order_line_id, warehouse_id, bin_id, sku_id, normalized_lot_number, stock_status),
      UNIQUE KEY uq_gr_details_movement (inventory_movement_id),
      KEY idx_gr_details_sku (sku_id, goods_receipt_id, id),
      KEY idx_gr_details_location (warehouse_id, bin_id, goods_receipt_id, id),
      KEY idx_gr_details_lot (sku_id, normalized_lot_number, id),
      CONSTRAINT fk_gr_details_line FOREIGN KEY (goods_receipt_line_id, goods_receipt_id) REFERENCES goods_receipt_lines (id, goods_receipt_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_gr_po FOREIGN KEY (goods_receipt_id, purchase_order_id) REFERENCES goods_receipts (id, purchase_order_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_po_line FOREIGN KEY (purchase_order_line_id, purchase_order_id) REFERENCES purchase_order_lines (id, purchase_order_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_po_line_sku FOREIGN KEY (purchase_order_line_id, sku_id) REFERENCES purchase_order_lines (id, sku_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_bin FOREIGN KEY (bin_id, warehouse_id) REFERENCES inventory_bins (id, warehouse_id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_sku FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_uom FOREIGN KEY (input_uom_id) REFERENCES item_uoms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_warehouse FOREIGN KEY (warehouse_id) REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_override_by FOREIGN KEY (expiry_override_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_gr_details_operation FOREIGN KEY (inventory_operation_request_id) REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
      CONSTRAINT fk_gr_details_movement FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "goods_receipt_details", GR_DETAIL_TRIGGERS);
}
