const COLUMNS = Object.freeze([
  "id", "movement_group_id", "operation_request_id", "movement_type", "location_kind",
  "warehouse_id", "bin_id", "sku_id", "lot_id", "stock_status", "direction", "quantity",
  "balance_before", "balance_after", "balance_version_after", "reservation_id", "allocation_id",
  "transfer_id", "transfer_line_id", "stocktake_id", "stocktake_line_id",
  "reversal_of_movement_id", "reason_category", "reason_text", "sku_code_snapshot",
  "sku_name_snapshot", "warehouse_code_snapshot", "bin_code_snapshot", "lot_number_snapshot",
  "expiry_date_snapshot", "posted_at", "posted_by", "posted_by_label"
]);

const INDEXES = new Set([
  "PRIMARY:0:id",
  "idx_inventory_movements_time:1:posted_at,id",
  "idx_inventory_movements_sku:1:sku_id,posted_at,id",
  "idx_inventory_movements_bin:1:bin_id,posted_at,id",
  "idx_inventory_movements_warehouse:1:warehouse_id,posted_at,id",
  "idx_inventory_movements_lot:1:lot_id,posted_at,id",
  "idx_inventory_movements_actor:1:posted_by,posted_at,id",
  "idx_inventory_movements_type:1:movement_type,posted_at,id",
  "idx_inventory_movements_group:1:movement_group_id,id",
  "idx_inventory_movements_operation:1:operation_request_id,id",
  "idx_inventory_movements_bin_owner:1:bin_id,warehouse_id",
  "idx_inventory_movements_lot_owner:1:lot_id,sku_id",
  "uq_inventory_movement_reversal:0:reversal_of_movement_id"
]);

const FOREIGN_KEYS = new Map([
  ["fk_inventory_movements_operation", "inventory_operation_requests:RESTRICT"],
  ["fk_inventory_movements_warehouse", "inventory_warehouses:RESTRICT"],
  ["fk_inventory_movements_bin", "inventory_bins:RESTRICT"],
  ["fk_inventory_movements_sku", "item_skus:RESTRICT"],
  ["fk_inventory_movements_lot", "inventory_lots:RESTRICT"],
  ["fk_inventory_movements_reversal", "inventory_movements:RESTRICT"],
  ["fk_inventory_movements_posted_by", "users:SET NULL"]
]);

const TRIGGERS = Object.freeze([
  ["trg_inventory_movements_immutable_update", "UPDATE"],
  ["trg_inventory_movements_immutable_delete", "DELETE"]
]);

export async function inspectInventoryMovementSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'inventory_movements'
      ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actualColumns = columns.map((row) => row.column_name);
  if (actualColumns.length !== COLUMNS.length || actualColumns.some((name, index) => name !== COLUMNS[index])) {
    throw new Error("Incompatible existing Inventory movement schema: columns");
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'inventory_movements'
      ORDER BY index_name, seq_in_index`
  );
  const groupedIndexes = new Map();
  for (const row of indexRows) {
    const key = `${row.index_name}:${Number(row.non_unique)}`;
    if (!groupedIndexes.has(key)) groupedIndexes.set(key, []);
    groupedIndexes.get(key).push(row.column_name);
  }
  const indexes = new Set([...groupedIndexes].map(([key, names]) => `${key}:${names.join(",")}`));
  for (const index of INDEXES) {
    if (!indexes.has(index)) {
      throw new Error(`Incompatible existing Inventory movement index: ${index}`);
    }
  }

  const [foreignKeyRows] = await connection.query(
    `SELECT constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'inventory_movements'`
  );
  const foreignKeys = new Map(foreignKeyRows.map((row) => [
    row.constraint_name,
    `${row.referenced_table_name}:${row.delete_rule}`
  ]));
  for (const [name, rule] of FOREIGN_KEYS) {
    if (foreignKeys.get(name) !== rule) {
      throw new Error(`Incompatible existing Inventory movement foreign key: ${name}`);
    }
  }
  return true;
}

async function ensureImmutableTriggers(connection) {
  const [rows] = await connection.query(
    `SELECT trigger_name AS trigger_name, event_manipulation AS event_manipulation,
            action_timing AS action_timing, action_statement AS action_statement
       FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND event_object_table = 'inventory_movements'`
  );
  const found = new Map(rows.map((row) => [row.trigger_name, row]));
  for (const [name, event] of TRIGGERS) {
    const trigger = found.get(name);
    if (trigger) {
      const statement = String(trigger.action_statement).toLowerCase();
      if (trigger.event_manipulation !== event || trigger.action_timing !== "BEFORE" ||
          !statement.includes("signal sqlstate '45000'") || !statement.includes("immutable")) {
        throw new Error(`Incompatible existing Inventory movement trigger: ${name}`);
      }
      continue;
    }
    await connection.query(`
      CREATE TRIGGER ${name}
      BEFORE ${event} ON inventory_movements
      FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inventory_movements is immutable'
    `);
  }
}

export async function up(connection) {
  if (!(await inspectInventoryMovementSchema(connection))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        movement_group_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        operation_request_id    BIGINT UNSIGNED NOT NULL,
        movement_type           VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        location_kind           VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        warehouse_id            BIGINT UNSIGNED NOT NULL,
        bin_id                  BIGINT UNSIGNED NULL,
        sku_id                  BIGINT UNSIGNED NOT NULL,
        lot_id                  BIGINT UNSIGNED NULL,
        stock_status            VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        direction               VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        quantity                BIGINT UNSIGNED NOT NULL,
        balance_before          BIGINT UNSIGNED NULL,
        balance_after           BIGINT UNSIGNED NULL,
        balance_version_after   INT UNSIGNED NULL,
        reservation_id          BIGINT UNSIGNED NULL,
        allocation_id           BIGINT UNSIGNED NULL,
        transfer_id             BIGINT UNSIGNED NULL,
        transfer_line_id        BIGINT UNSIGNED NULL,
        stocktake_id            BIGINT UNSIGNED NULL,
        stocktake_line_id       BIGINT UNSIGNED NULL,
        reversal_of_movement_id BIGINT UNSIGNED NULL,
        reason_category         VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
        reason_text             VARCHAR(500) NOT NULL DEFAULT '',
        sku_code_snapshot       VARCHAR(190) NOT NULL,
        sku_name_snapshot       VARCHAR(190) NOT NULL,
        warehouse_code_snapshot VARCHAR(50) NOT NULL,
        bin_code_snapshot       VARCHAR(50) NOT NULL DEFAULT '',
        lot_number_snapshot     VARCHAR(100) NOT NULL DEFAULT '',
        expiry_date_snapshot    DATE NULL,
        posted_at               BIGINT UNSIGNED NOT NULL,
        posted_by               BIGINT UNSIGNED NULL,
        posted_by_label         VARCHAR(190) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_inventory_movement_reversal (reversal_of_movement_id),
        KEY idx_inventory_movements_time (posted_at, id),
        KEY idx_inventory_movements_sku (sku_id, posted_at, id),
        KEY idx_inventory_movements_bin (bin_id, posted_at, id),
        KEY idx_inventory_movements_warehouse (warehouse_id, posted_at, id),
        KEY idx_inventory_movements_lot (lot_id, posted_at, id),
        KEY idx_inventory_movements_actor (posted_by, posted_at, id),
        KEY idx_inventory_movements_type (movement_type, posted_at, id),
        KEY idx_inventory_movements_group (movement_group_id, id),
        KEY idx_inventory_movements_operation (operation_request_id, id),
        KEY idx_inventory_movements_bin_owner (bin_id, warehouse_id),
        KEY idx_inventory_movements_lot_owner (lot_id, sku_id),
        CONSTRAINT chk_inventory_movements_location
          CHECK ((location_kind = 'BIN' AND bin_id IS NOT NULL
                    AND balance_before IS NOT NULL AND balance_after IS NOT NULL
                    AND balance_version_after IS NOT NULL)
                 OR (location_kind = 'IN_TRANSIT' AND bin_id IS NULL)),
        CONSTRAINT chk_inventory_movements_status
          CHECK (stock_status IN ('AVAILABLE', 'QUARANTINED', 'DAMAGED')),
        CONSTRAINT chk_inventory_movements_direction CHECK (direction IN ('IN', 'OUT')),
        CONSTRAINT chk_inventory_movements_quantity CHECK (quantity > 0),
        CONSTRAINT fk_inventory_movements_operation FOREIGN KEY (operation_request_id)
          REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movements_warehouse FOREIGN KEY (warehouse_id)
          REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movements_bin FOREIGN KEY (bin_id, warehouse_id)
          REFERENCES inventory_bins (id, warehouse_id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movements_sku FOREIGN KEY (sku_id)
          REFERENCES item_skus (id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movements_lot FOREIGN KEY (lot_id, sku_id)
          REFERENCES inventory_lots (id, sku_id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movements_reversal FOREIGN KEY (reversal_of_movement_id)
          REFERENCES inventory_movements (id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movements_posted_by FOREIGN KEY (posted_by)
          REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await inspectInventoryMovementSchema(connection);
  }
  await ensureImmutableTriggers(connection);
}
