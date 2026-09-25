const TABLES = Object.freeze({
  inventory_lots: {
    columns: [
      "id", "sku_id", "lot_number", "normalized_lot_number", "expiry_date",
      "manufacture_date", "first_receipt_date", "sku_code_snapshot", "created_at", "created_by"
    ],
    indexes: new Set([
      "PRIMARY:0:id",
      "uq_inventory_lots_sku_number:0:sku_id,normalized_lot_number",
      "uq_inventory_lots_id_sku:0:id,sku_id",
      "idx_inventory_lots_expiry:1:expiry_date,sku_id,id",
      "idx_inventory_lots_sku_receipt:1:sku_id,first_receipt_date,id"
    ])
  },
  inventory_stock_controls: {
    columns: [
      "id", "warehouse_id", "sku_id", "reserved_quantity", "version", "created_at", "updated_at"
    ],
    indexes: new Set([
      "PRIMARY:0:id",
      "uq_inventory_stock_controls_scope:0:warehouse_id,sku_id",
      "idx_inventory_stock_controls_sku:1:sku_id,warehouse_id"
    ])
  },
  inventory_stock_balances: {
    columns: [
      "id", "warehouse_id", "bin_id", "sku_id", "lot_id", "lot_scope", "stock_status",
      "on_hand_quantity", "allocated_quantity", "fifo_anchor_date", "version", "created_at", "updated_at"
    ],
    indexes: new Set([
      "PRIMARY:0:id",
      "uq_inventory_stock_bucket:0:warehouse_id,bin_id,sku_id,lot_scope,stock_status",
      "idx_inventory_stock_sku:1:warehouse_id,sku_id,stock_status,lot_id,bin_id,id",
      "idx_inventory_stock_fifo:1:warehouse_id,sku_id,stock_status,fifo_anchor_date,bin_id,id",
      "idx_inventory_stock_bin:1:bin_id,sku_id,lot_id,stock_status,id",
      "idx_inventory_stock_bin_owner:1:bin_id,warehouse_id",
      "idx_inventory_stock_lot_owner:1:lot_id,sku_id",
      "idx_inventory_stock_nonzero:1:sku_id,on_hand_quantity,id"
    ])
  }
});

const FOREIGN_KEYS = new Map([
  ["inventory_lots:fk_inventory_lots_sku", "item_skus:RESTRICT"],
  ["inventory_lots:fk_inventory_lots_created_by", "users:SET NULL"],
  ["inventory_stock_controls:fk_inventory_stock_controls_warehouse", "inventory_warehouses:RESTRICT"],
  ["inventory_stock_controls:fk_inventory_stock_controls_sku", "item_skus:RESTRICT"],
  ["inventory_stock_balances:fk_inventory_stock_balances_bin", "inventory_bins:RESTRICT"],
  ["inventory_stock_balances:fk_inventory_stock_balances_sku", "item_skus:RESTRICT"],
  ["inventory_stock_balances:fk_inventory_stock_balances_lot", "inventory_lots:RESTRICT"]
]);

export async function inspectInventoryStockSchema(connection) {
  const tableNames = Object.keys(TABLES);
  const [columns] = await connection.query(
    `SELECT table_name AS table_name, column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_lots', 'inventory_stock_controls', 'inventory_stock_balances')
      ORDER BY table_name, ordinal_position`
  );
  if (columns.length === 0) return false;

  const foundTables = new Set(columns.map(({ table_name }) => table_name));
  for (const table of foundTables) {
    const actual = columns.filter((row) => row.table_name === table).map((row) => row.column_name);
    const expected = TABLES[table]?.columns;
    if (!expected || actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      throw new Error(`Incompatible existing Inventory stock schema: ${table} columns`);
    }
  }
  if (!tableNames.every((table) => foundTables.has(table))) return false;

  const [indexRows] = await connection.query(
    `SELECT table_name AS table_name, index_name AS index_name,
            non_unique AS non_unique, seq_in_index AS seq_in_index,
            column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_lots', 'inventory_stock_controls', 'inventory_stock_balances')
      ORDER BY table_name, index_name, seq_in_index`
  );
  const groupedIndexes = new Map();
  for (const row of indexRows) {
    const key = `${row.table_name}:${row.index_name}:${Number(row.non_unique)}`;
    if (!groupedIndexes.has(key)) groupedIndexes.set(key, []);
    groupedIndexes.get(key).push(row.column_name);
  }
  const indexes = new Set([...groupedIndexes].map(([key, names]) => `${key}:${names.join(",")}`));
  for (const [table, definition] of Object.entries(TABLES)) {
    for (const index of definition.indexes) {
      if (!indexes.has(`${table}:${index}`)) {
        throw new Error(`Incompatible existing Inventory stock index: ${table}:${index}`);
      }
    }
  }

  const [foreignKeyRows] = await connection.query(
    `SELECT table_name AS table_name, constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('inventory_lots', 'inventory_stock_controls', 'inventory_stock_balances')`
  );
  const foreignKeys = new Map(foreignKeyRows.map((row) => [
    `${row.table_name}:${row.constraint_name}`,
    `${row.referenced_table_name}:${row.delete_rule}`
  ]));
  for (const [name, rule] of FOREIGN_KEYS) {
    if (foreignKeys.get(name) !== rule) {
      throw new Error(`Incompatible existing Inventory stock foreign key: ${name}`);
    }
  }
  return true;
}

export async function up(connection) {
  if (await inspectInventoryStockSchema(connection)) return;

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_lots (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sku_id                BIGINT UNSIGNED NOT NULL,
      lot_number            VARCHAR(100) NOT NULL,
      normalized_lot_number VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
      expiry_date           DATE NULL,
      manufacture_date      DATE NULL,
      first_receipt_date    DATE NOT NULL,
      sku_code_snapshot     VARCHAR(190) NOT NULL,
      created_at            BIGINT UNSIGNED NOT NULL,
      created_by            BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_lots_sku_number (sku_id, normalized_lot_number),
      UNIQUE KEY uq_inventory_lots_id_sku (id, sku_id),
      KEY idx_inventory_lots_expiry (expiry_date, sku_id, id),
      KEY idx_inventory_lots_sku_receipt (sku_id, first_receipt_date, id),
      CONSTRAINT chk_inventory_lots_dates
        CHECK (manufacture_date IS NULL OR expiry_date IS NULL OR manufacture_date <= expiry_date),
      CONSTRAINT fk_inventory_lots_sku FOREIGN KEY (sku_id)
        REFERENCES item_skus (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_lots_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_stock_controls (
      id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      warehouse_id      BIGINT UNSIGNED NOT NULL,
      sku_id            BIGINT UNSIGNED NOT NULL,
      reserved_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
      version           INT UNSIGNED NOT NULL DEFAULT 1,
      created_at        BIGINT UNSIGNED NOT NULL,
      updated_at        BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_stock_controls_scope (warehouse_id, sku_id),
      KEY idx_inventory_stock_controls_sku (sku_id, warehouse_id),
      CONSTRAINT fk_inventory_stock_controls_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_stock_controls_sku FOREIGN KEY (sku_id)
        REFERENCES item_skus (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_stock_balances (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      warehouse_id       BIGINT UNSIGNED NOT NULL,
      bin_id             BIGINT UNSIGNED NOT NULL,
      sku_id             BIGINT UNSIGNED NOT NULL,
      lot_id             BIGINT UNSIGNED NULL,
      lot_scope          BIGINT UNSIGNED GENERATED ALWAYS AS (IFNULL(lot_id, 0)) STORED,
      stock_status       VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      on_hand_quantity   BIGINT UNSIGNED NOT NULL DEFAULT 0,
      allocated_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
      fifo_anchor_date   DATE NULL,
      version            INT UNSIGNED NOT NULL DEFAULT 1,
      created_at         BIGINT UNSIGNED NOT NULL,
      updated_at         BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_stock_bucket (warehouse_id, bin_id, sku_id, lot_scope, stock_status),
      KEY idx_inventory_stock_sku (warehouse_id, sku_id, stock_status, lot_id, bin_id, id),
      KEY idx_inventory_stock_fifo (warehouse_id, sku_id, stock_status, fifo_anchor_date, bin_id, id),
      KEY idx_inventory_stock_bin (bin_id, sku_id, lot_id, stock_status, id),
      KEY idx_inventory_stock_bin_owner (bin_id, warehouse_id),
      KEY idx_inventory_stock_lot_owner (lot_id, sku_id),
      KEY idx_inventory_stock_nonzero (sku_id, on_hand_quantity, id),
      CONSTRAINT chk_inventory_stock_status
        CHECK (stock_status IN ('AVAILABLE', 'QUARANTINED', 'DAMAGED')),
      CONSTRAINT chk_inventory_stock_allocated
        CHECK (allocated_quantity <= on_hand_quantity),
      CONSTRAINT chk_inventory_stock_fifo_zero
        CHECK (on_hand_quantity <> 0 OR fifo_anchor_date IS NULL),
      CONSTRAINT fk_inventory_stock_balances_bin FOREIGN KEY (bin_id, warehouse_id)
        REFERENCES inventory_bins (id, warehouse_id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_stock_balances_sku FOREIGN KEY (sku_id)
        REFERENCES item_skus (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_stock_balances_lot FOREIGN KEY (lot_id, sku_id)
        REFERENCES inventory_lots (id, sku_id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await inspectInventoryStockSchema(connection);
}
