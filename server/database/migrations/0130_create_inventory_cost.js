// TABLES-COST.md e942f90c…96ee, Sam approved 2026-11-25 (r6).
// Additive schema. Deployment keeps inventory writers stopped until every writer supports cost.
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

const ASCII = "CHARACTER SET ascii COLLATE ascii_bin";
const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
const INBOUND = "'ENABLEMENT','OPENING','RECEIPT','ISSUE_REVERSAL','CUSTOMER_RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT_REVERSAL'";
const OUTBOUND = "'ISSUE','RECEIPT_REVERSAL','SUPPLIER_RETURN','ADJUSTMENT_OUT','ADJUSTMENT_IN_REVERSAL'";
const REVERSED = "'ISSUE_REVERSAL','CUSTOMER_RETURN','RECEIPT_REVERSAL','SUPPLIER_RETURN','ADJUSTMENT_IN_REVERSAL','ADJUSTMENT_OUT_REVERSAL'";
const IMMUTABLE = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Inventory cost entries are immutable'";

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_cost_pools (
      sku_id BIGINT UNSIGNED NOT NULL,
      costed_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
      value_hkd DECIMAL(19,4) NOT NULL DEFAULT 0,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      updated_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (sku_id),
      CONSTRAINT fk_inventory_cost_pool_sku FOREIGN KEY (sku_id) REFERENCES item_skus(id) ON DELETE RESTRICT,
      CONSTRAINT chk_inventory_cost_pool_value CHECK (value_hkd >= 0),
      CONSTRAINT chk_inventory_cost_pool_empty CHECK (costed_quantity <> 0 OR value_hkd = 0),
      CONSTRAINT chk_inventory_cost_pool_version CHECK (version >= 1)
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_cost_entries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      movement_id BIGINT UNSIGNED NULL DEFAULT NULL,
      sku_id BIGINT UNSIGNED NOT NULL,
      entry_kind VARCHAR(30) ${ASCII} NOT NULL,
      enablement_sku_id BIGINT UNSIGNED GENERATED ALWAYS AS
        (CASE WHEN entry_kind = 'ENABLEMENT' THEN sku_id END) STORED,
      quantity_delta BIGINT NOT NULL,
      value_delta_hkd DECIMAL(19,4) NOT NULL,
      original_entry_id BIGINT UNSIGNED NULL DEFAULT NULL,
      original_value_hkd DECIMAL(19,4) NULL DEFAULT NULL,
      unit_cost_source VARCHAR(20) ${ASCII} NOT NULL DEFAULT 'POOL',
      pool_quantity_after BIGINT UNSIGNED NOT NULL,
      pool_value_after_hkd DECIMAL(19,4) NOT NULL,
      posted_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_cost_entry_movement (movement_id),
      UNIQUE KEY uq_inventory_cost_entry_enablement (enablement_sku_id),
      KEY idx_inventory_cost_entry_sku_time (sku_id, posted_at, id),
      KEY idx_inventory_cost_entry_original (original_entry_id, id),
      CONSTRAINT fk_inventory_cost_entry_movement FOREIGN KEY (movement_id)
        REFERENCES inventory_movements(id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_cost_entry_sku FOREIGN KEY (sku_id) REFERENCES item_skus(id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_cost_entry_original FOREIGN KEY (original_entry_id)
        REFERENCES inventory_cost_entries(id) ON DELETE RESTRICT,
      CONSTRAINT chk_inventory_cost_entry_kind CHECK (entry_kind IN (${INBOUND},${OUTBOUND})),
      CONSTRAINT chk_inventory_cost_entry_source CHECK (unit_cost_source IN
        ('PURCHASE_PRICE','OPENING_FILE','POOL','ORIGINAL','LAST_KNOWN','ENTERED','ENABLEMENT_FILE')),
      CONSTRAINT chk_inventory_cost_entry_movement CHECK ((movement_id IS NULL) = (entry_kind = 'ENABLEMENT')),
      CONSTRAINT chk_inventory_cost_entry_quantity CHECK (quantity_delta <> 0),
      CONSTRAINT chk_inventory_cost_entry_direction CHECK (
        (entry_kind IN (${INBOUND}) AND quantity_delta > 0 AND value_delta_hkd >= 0) OR
        (entry_kind IN (${OUTBOUND}) AND quantity_delta < 0 AND value_delta_hkd <= 0)),
      CONSTRAINT chk_inventory_cost_entry_reversal CHECK (
        (entry_kind IN (${REVERSED}) AND original_entry_id IS NOT NULL
          AND original_value_hkd IS NOT NULL AND original_value_hkd >= 0) OR
        (entry_kind NOT IN (${REVERSED}) AND original_entry_id IS NULL AND original_value_hkd IS NULL)),
      CONSTRAINT chk_inventory_cost_entry_pool_value CHECK (pool_value_after_hkd >= 0),
      CONSTRAINT chk_inventory_cost_entry_empty_pool CHECK (pool_quantity_after <> 0 OR pool_value_after_hkd = 0)
    ) ${TABLE_OPTIONS}
  `);

  await ensureTriggers(connection, "inventory_cost_entries", {
    trg_inventory_cost_entry_update: ["UPDATE", IMMUTABLE],
    trg_inventory_cost_entry_delete: ["DELETE", IMMUTABLE]
  });
}
