const TABLES = Object.freeze({
  inventory_reservations: {
    columns: [
      "id", "create_operation_id", "warehouse_id", "sku_id", "original_quantity",
      "consumed_quantity", "released_quantity", "outstanding_quantity",
      "minimum_remaining_days", "purpose", "status", "version", "created_at",
      "updated_at", "created_by", "updated_by"
    ],
    indexes: new Set([
      "PRIMARY:0:id",
      "uq_inventory_reservations_operation:0:create_operation_id",
      "idx_inventory_reservations_scope:1:warehouse_id,sku_id,status,id",
      "idx_inventory_reservations_status:1:status,updated_at,id"
    ]),
    foreignKeys: new Map([
      ["fk_inventory_reservations_create_operation", "inventory_operation_requests:RESTRICT"],
      ["fk_inventory_reservations_warehouse", "inventory_warehouses:RESTRICT"],
      ["fk_inventory_reservations_sku", "item_skus:RESTRICT"],
      ["fk_inventory_reservations_created_by", "users:SET NULL"],
      ["fk_inventory_reservations_updated_by", "users:SET NULL"]
    ]),
    checks: new Map([
      ["chk_inventory_reservations_quantity", ["ORIGINAL_QUANTITY", "CONSUMED_QUANTITY", "RELEASED_QUANTITY", "OUTSTANDING_QUANTITY"]],
      ["chk_inventory_reservations_status", ["ACTIVE", "PARTIALLY_CONSUMED", "CONSUMED", "RELEASED", "CANCELLED"]],
      ["chk_inventory_reservations_version", ["VERSION", "> 0"]]
    ])
  },
  inventory_allocations: {
    columns: [
      "id", "create_operation_id", "reservation_id", "stock_balance_id",
      "allocated_quantity", "consumed_quantity", "released_quantity", "outstanding_quantity",
      "selection_strategy", "is_sequence_override", "recommended_rank_snapshot",
      "recommended_summary", "override_reason", "status", "version", "created_at",
      "updated_at", "created_by", "updated_by"
    ],
    indexes: new Set([
      "PRIMARY:0:id",
      "idx_inventory_allocations_reservation:1:reservation_id,status,id",
      "idx_inventory_allocations_balance:1:stock_balance_id,status,id",
      "idx_inventory_allocations_operation:1:create_operation_id,id"
    ]),
    foreignKeys: new Map([
      ["fk_inventory_allocations_create_operation", "inventory_operation_requests:RESTRICT"],
      ["fk_inventory_allocations_reservation", "inventory_reservations:RESTRICT"],
      ["fk_inventory_allocations_stock_balance", "inventory_stock_balances:RESTRICT"],
      ["fk_inventory_allocations_created_by", "users:SET NULL"],
      ["fk_inventory_allocations_updated_by", "users:SET NULL"]
    ]),
    checks: new Map([
      ["chk_inventory_allocations_quantity", ["ALLOCATED_QUANTITY", "CONSUMED_QUANTITY", "RELEASED_QUANTITY", "OUTSTANDING_QUANTITY"]],
      ["chk_inventory_allocations_strategy", ["SELECTION_STRATEGY", "FEFO", "FIFO"]],
      ["chk_inventory_allocations_override", ["IS_SEQUENCE_OVERRIDE", "OVERRIDE_REASON", "RECOMMENDED_SUMMARY"]],
      ["chk_inventory_allocations_rank", ["RECOMMENDED_RANK_SNAPSHOT", "> 0"]],
      ["chk_inventory_allocations_status", ["ACTIVE", "PARTIALLY_CONSUMED", "CONSUMED", "RELEASED"]],
      ["chk_inventory_allocations_version", ["VERSION", "> 0"]]
    ])
  }
});

const MOVEMENT_FOREIGN_KEYS = new Map([
  ["fk_inventory_movements_reservation", "inventory_reservations:RESTRICT"],
  ["fk_inventory_movements_allocation", "inventory_allocations:RESTRICT"]
]);

async function readForeignKeys(connection, tables) {
  const [rows] = await connection.query(
    `SELECT table_name AS table_name, constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN (${tables.map(() => "?").join(", ")})`,
    tables
  );
  return new Map(rows.map((row) => [
    `${row.table_name}:${row.constraint_name}`,
    `${row.referenced_table_name}:${row.delete_rule}`
  ]));
}

export async function inspectInventoryReservationSchema(connection) {
  const tableNames = Object.keys(TABLES);
  const [columns] = await connection.query(
    `SELECT table_name AS table_name, column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_reservations', 'inventory_allocations')
      ORDER BY table_name, ordinal_position`
  );
  if (columns.length === 0) return false;

  const foundTables = new Set(columns.map((row) => row.table_name));
  for (const table of foundTables) {
    const actual = columns.filter((row) => row.table_name === table).map((row) => row.column_name);
    const expected = TABLES[table]?.columns;
    if (!expected || actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      throw new Error(`Incompatible existing Inventory reservation schema: ${table} columns`);
    }
  }
  if (!tableNames.every((table) => foundTables.has(table))) return false;

  const [indexRows] = await connection.query(
    `SELECT table_name AS table_name, index_name AS index_name,
            non_unique AS non_unique, seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_reservations', 'inventory_allocations')
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
        throw new Error(`Incompatible existing Inventory reservation index: ${table}:${index}`);
      }
    }
  }

  const foreignKeys = await readForeignKeys(connection, [...tableNames, "inventory_movements"]);
  for (const [table, definition] of Object.entries(TABLES)) {
    for (const [name, rule] of definition.foreignKeys) {
      if (foreignKeys.get(`${table}:${name}`) !== rule) {
        throw new Error(`Incompatible existing Inventory reservation foreign key: ${table}:${name}`);
      }
    }
  }
  for (const [name, rule] of MOVEMENT_FOREIGN_KEYS) {
    const actual = foreignKeys.get(`inventory_movements:${name}`);
    if (actual === undefined) return false;
    if (actual !== rule) {
      throw new Error(`Incompatible existing Inventory movement foreign key: ${name}`);
    }
  }

  const [checkRows] = await connection.query(
    `SELECT tc.table_name AS table_name, tc.constraint_name AS constraint_name,
            cc.check_clause AS check_clause
       FROM information_schema.check_constraints cc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = cc.constraint_schema
        AND tc.constraint_name = cc.constraint_name
      WHERE tc.constraint_schema = DATABASE()
        AND tc.table_name IN ('inventory_reservations', 'inventory_allocations')`
  );
  const checks = new Map(checkRows.map((row) => [
    `${row.table_name}:${row.constraint_name}`,
    String(row.check_clause).toUpperCase()
  ]));
  for (const [table, definition] of Object.entries(TABLES)) {
    for (const [name, tokens] of definition.checks) {
      const clause = checks.get(`${table}:${name}`) ?? "";
      if (!tokens.every((token) => clause.includes(token))) {
        throw new Error(`Incompatible existing Inventory reservation check: ${table}:${name}`);
      }
    }
  }
  return true;
}

async function ensureMovementForeignKeys(connection) {
  const foreignKeys = await readForeignKeys(connection, ["inventory_movements"]);
  for (const [name, rule] of MOVEMENT_FOREIGN_KEYS) {
    const actual = foreignKeys.get(`inventory_movements:${name}`);
    if (actual !== undefined && actual !== rule) {
      throw new Error(`Incompatible existing Inventory movement foreign key: ${name}`);
    }
    if (actual !== undefined) continue;
    const [column, table] = name.endsWith("reservation")
      ? ["reservation_id", "inventory_reservations"]
      : ["allocation_id", "inventory_allocations"];
    await connection.query(
      `ALTER TABLE inventory_movements ADD CONSTRAINT ${name}
       FOREIGN KEY (${column}) REFERENCES ${table} (id) ON DELETE RESTRICT`
    );
  }
}

export async function up(connection) {
  if (await inspectInventoryReservationSchema(connection)) return;

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      create_operation_id    BIGINT UNSIGNED NOT NULL,
      warehouse_id           BIGINT UNSIGNED NOT NULL,
      sku_id                 BIGINT UNSIGNED NOT NULL,
      original_quantity      BIGINT UNSIGNED NOT NULL,
      consumed_quantity      BIGINT UNSIGNED NOT NULL DEFAULT 0,
      released_quantity      BIGINT UNSIGNED NOT NULL DEFAULT 0,
      outstanding_quantity   BIGINT UNSIGNED NOT NULL,
      minimum_remaining_days INT UNSIGNED NOT NULL DEFAULT 0,
      purpose                VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status                 VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version                INT UNSIGNED NOT NULL DEFAULT 1,
      created_at             BIGINT UNSIGNED NOT NULL,
      updated_at             BIGINT UNSIGNED NOT NULL,
      created_by             BIGINT UNSIGNED NULL,
      updated_by             BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_reservations_operation (create_operation_id),
      KEY idx_inventory_reservations_scope (warehouse_id, sku_id, status, id),
      KEY idx_inventory_reservations_status (status, updated_at, id),
      CONSTRAINT chk_inventory_reservations_quantity CHECK (
        original_quantity > 0 AND
        original_quantity = consumed_quantity + released_quantity + outstanding_quantity
      ),
      CONSTRAINT chk_inventory_reservations_status CHECK (
        status IN ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'CANCELLED')
      ),
      CONSTRAINT chk_inventory_reservations_version CHECK (version > 0),
      CONSTRAINT fk_inventory_reservations_create_operation FOREIGN KEY (create_operation_id)
        REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_reservations_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_reservations_sku FOREIGN KEY (sku_id)
        REFERENCES item_skus (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_reservations_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_inventory_reservations_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_allocations (
      id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      create_operation_id       BIGINT UNSIGNED NOT NULL,
      reservation_id            BIGINT UNSIGNED NOT NULL,
      stock_balance_id          BIGINT UNSIGNED NOT NULL,
      allocated_quantity        BIGINT UNSIGNED NOT NULL,
      consumed_quantity         BIGINT UNSIGNED NOT NULL DEFAULT 0,
      released_quantity         BIGINT UNSIGNED NOT NULL DEFAULT 0,
      outstanding_quantity      BIGINT UNSIGNED NOT NULL,
      selection_strategy        VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      is_sequence_override      TINYINT(1) NOT NULL DEFAULT 0,
      recommended_rank_snapshot INT UNSIGNED NULL,
      recommended_summary       JSON NULL,
      override_reason           VARCHAR(500) NOT NULL DEFAULT '',
      status                    VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version                   INT UNSIGNED NOT NULL DEFAULT 1,
      created_at                BIGINT UNSIGNED NOT NULL,
      updated_at                BIGINT UNSIGNED NOT NULL,
      created_by                BIGINT UNSIGNED NULL,
      updated_by                BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      KEY idx_inventory_allocations_reservation (reservation_id, status, id),
      KEY idx_inventory_allocations_balance (stock_balance_id, status, id),
      KEY idx_inventory_allocations_operation (create_operation_id, id),
      CONSTRAINT chk_inventory_allocations_quantity CHECK (
        allocated_quantity > 0 AND
        allocated_quantity = consumed_quantity + released_quantity + outstanding_quantity
      ),
      CONSTRAINT chk_inventory_allocations_strategy CHECK (selection_strategy IN ('FEFO', 'FIFO')),
      CONSTRAINT chk_inventory_allocations_override CHECK (
        (is_sequence_override = 0 AND override_reason = '') OR
        (is_sequence_override = 1 AND recommended_rank_snapshot IS NOT NULL
          AND recommended_summary IS NOT NULL
          AND CHAR_LENGTH(TRIM(override_reason)) BETWEEN 5 AND 500)
      ),
      CONSTRAINT chk_inventory_allocations_rank CHECK (
        recommended_rank_snapshot IS NULL OR recommended_rank_snapshot > 0
      ),
      CONSTRAINT chk_inventory_allocations_status CHECK (
        status IN ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED')
      ),
      CONSTRAINT chk_inventory_allocations_version CHECK (version > 0),
      CONSTRAINT fk_inventory_allocations_create_operation FOREIGN KEY (create_operation_id)
        REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_allocations_reservation FOREIGN KEY (reservation_id)
        REFERENCES inventory_reservations (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_allocations_stock_balance FOREIGN KEY (stock_balance_id)
        REFERENCES inventory_stock_balances (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_allocations_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_inventory_allocations_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureMovementForeignKeys(connection);
  await inspectInventoryReservationSchema(connection);
}
