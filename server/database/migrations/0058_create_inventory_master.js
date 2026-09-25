const TABLES = Object.freeze({
  inventory_warehouses: {
    columns: {
      id: ["bigint unsigned", "NO"],
      warehouse_code: ["varchar(50)", "NO"],
      normalized_code: ["varchar(50)", "NO", "utf8mb4_bin"],
      warehouse_name: ["varchar(190)", "NO"],
      address: ["varchar(500)", "YES"],
      description: ["varchar(500)", "NO"],
      status: ["varchar(20)", "NO", "ascii_bin"],
      version: ["int unsigned", "NO"],
      created_at: ["bigint unsigned", "NO"],
      updated_at: ["bigint unsigned", "NO"],
      created_by: ["bigint unsigned", "YES"],
      updated_by: ["bigint unsigned", "YES"]
    },
    indexes: new Set([
      "PRIMARY:0:id",
      "uq_inventory_warehouses_code:0:normalized_code",
      "idx_inventory_warehouses_list:1:status,warehouse_name,id"
    ]),
    foreignKeys: new Map([
      ["fk_inventory_warehouses_created_by", "users:SET NULL"],
      ["fk_inventory_warehouses_updated_by", "users:SET NULL"]
    ]),
    check: ["chk_inventory_warehouses_status", ["STATUS", "ACTIVE", "INACTIVE"]]
  },
  inventory_bins: {
    columns: {
      id: ["bigint unsigned", "NO"],
      warehouse_id: ["bigint unsigned", "NO"],
      bin_code: ["varchar(50)", "NO"],
      normalized_code: ["varchar(50)", "NO", "utf8mb4_bin"],
      bin_name: ["varchar(190)", "YES"],
      description: ["varchar(500)", "NO"],
      status: ["varchar(20)", "NO", "ascii_bin"],
      version: ["int unsigned", "NO"],
      created_at: ["bigint unsigned", "NO"],
      updated_at: ["bigint unsigned", "NO"],
      created_by: ["bigint unsigned", "YES"],
      updated_by: ["bigint unsigned", "YES"]
    },
    indexes: new Set([
      "PRIMARY:0:id",
      "uq_inventory_bins_code:0:warehouse_id,normalized_code",
      "uq_inventory_bins_id_warehouse:0:id,warehouse_id",
      "idx_inventory_bins_list:1:warehouse_id,status,bin_code,id"
    ]),
    foreignKeys: new Map([
      ["fk_inventory_bins_warehouse", "inventory_warehouses:RESTRICT"],
      ["fk_inventory_bins_created_by", "users:SET NULL"],
      ["fk_inventory_bins_updated_by", "users:SET NULL"]
    ]),
    check: ["chk_inventory_bins_status", ["STATUS", "ACTIVE", "INACTIVE"]]
  }
});

export async function inspectInventoryMasterSchema(connection) {
  const tableNames = Object.keys(TABLES);
  const [columns] = await connection.query(
    `SELECT table_name AS table_name, column_name AS column_name,
            column_type AS column_type, is_nullable AS is_nullable,
            collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_warehouses', 'inventory_bins')`
  );
  if (columns.length === 0) return false;

  const foundTables = new Set(columns.map(({ table_name }) => table_name));
  for (const table of foundTables) {
    const expected = TABLES[table];
    if (!expected) continue;
    const found = new Map(
      columns.filter((row) => row.table_name === table).map((row) => [row.column_name, row])
    );
    if (found.size !== Object.keys(expected.columns).length) {
      throw new Error(`Incompatible existing Inventory master schema: ${table} unexpected columns`);
    }
    for (const [column, [type, nullable, collation]] of Object.entries(expected.columns)) {
      const row = found.get(column);
      if (!row || String(row.column_type).toLowerCase() !== type || row.is_nullable !== nullable ||
          (collation && String(row.collation_name).toLowerCase() !== collation)) {
        throw new Error(`Incompatible existing Inventory master schema: ${table}.${column}`);
      }
    }
  }

  const [indexRows] = await connection.query(
    `SELECT table_name AS table_name, index_name AS index_name,
            non_unique AS non_unique, seq_in_index AS seq_in_index,
            column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name IN ('inventory_warehouses', 'inventory_bins')
      ORDER BY table_name, index_name, seq_in_index`
  );
  const groupedIndexes = new Map();
  for (const row of indexRows) {
    const key = `${row.table_name}:${row.index_name}:${Number(row.non_unique)}`;
    if (!groupedIndexes.has(key)) groupedIndexes.set(key, []);
    groupedIndexes.get(key).push(row.column_name);
  }
  const indexes = new Set(
    [...groupedIndexes].map(([key, names]) => `${key}:${names.join(",")}`)
  );

  const [foreignKeyRows] = await connection.query(
    `SELECT table_name AS table_name, constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('inventory_warehouses', 'inventory_bins')`
  );
  const foreignKeys = new Map(foreignKeyRows.map((row) => [
    `${row.table_name}:${row.constraint_name}`,
    `${row.referenced_table_name}:${row.delete_rule}`
  ]));

  const [checkRows] = await connection.query(
    `SELECT tc.table_name AS table_name, tc.constraint_name AS constraint_name,
            cc.check_clause AS check_clause
       FROM information_schema.check_constraints cc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = cc.constraint_schema
        AND tc.constraint_name = cc.constraint_name
      WHERE tc.constraint_schema = DATABASE()
        AND tc.table_name IN ('inventory_warehouses', 'inventory_bins')`
  );
  const checks = new Map(checkRows.map((row) => [
    `${row.table_name}:${row.constraint_name}`,
    String(row.check_clause).toUpperCase()
  ]));

  for (const table of foundTables) {
    const expected = TABLES[table];
    if (!expected) continue;
    for (const index of expected.indexes) {
      if (!indexes.has(`${table}:${index}`)) {
        throw new Error(`Incompatible existing Inventory master index: ${table}:${index}`);
      }
    }
    for (const [name, rule] of expected.foreignKeys) {
      if (foreignKeys.get(`${table}:${name}`) !== rule) {
        throw new Error(`Incompatible existing Inventory master foreign key: ${table}:${name}`);
      }
    }
    const [checkName, tokens] = expected.check;
    const clause = checks.get(`${table}:${checkName}`) ?? "";
    if (!tokens.every((token) => clause.includes(token))) {
      throw new Error(`Incompatible existing Inventory master check: ${table}:${checkName}`);
    }
  }

  return tableNames.every((table) => foundTables.has(table));
}

export async function up(connection) {
  if (await inspectInventoryMasterSchema(connection)) return;

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_warehouses (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      warehouse_code  VARCHAR(50) NOT NULL,
      normalized_code VARCHAR(50) COLLATE utf8mb4_bin NOT NULL,
      warehouse_name  VARCHAR(190) NOT NULL,
      address         VARCHAR(500) NULL,
      description     VARCHAR(500) NOT NULL DEFAULT '',
      status          VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
      version         INT UNSIGNED NOT NULL DEFAULT 1,
      created_at      BIGINT UNSIGNED NOT NULL,
      updated_at      BIGINT UNSIGNED NOT NULL,
      created_by      BIGINT UNSIGNED NULL,
      updated_by      BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_warehouses_code (normalized_code),
      KEY idx_inventory_warehouses_list (status, warehouse_name, id),
      CONSTRAINT chk_inventory_warehouses_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
      CONSTRAINT fk_inventory_warehouses_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_inventory_warehouses_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_bins (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      warehouse_id    BIGINT UNSIGNED NOT NULL,
      bin_code        VARCHAR(50) NOT NULL,
      normalized_code VARCHAR(50) COLLATE utf8mb4_bin NOT NULL,
      bin_name        VARCHAR(190) NULL,
      description     VARCHAR(500) NOT NULL DEFAULT '',
      status          VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
      version         INT UNSIGNED NOT NULL DEFAULT 1,
      created_at      BIGINT UNSIGNED NOT NULL,
      updated_at      BIGINT UNSIGNED NOT NULL,
      created_by      BIGINT UNSIGNED NULL,
      updated_by      BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_bins_code (warehouse_id, normalized_code),
      UNIQUE KEY uq_inventory_bins_id_warehouse (id, warehouse_id),
      KEY idx_inventory_bins_list (warehouse_id, status, bin_code, id),
      CONSTRAINT chk_inventory_bins_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
      CONSTRAINT fk_inventory_bins_warehouse FOREIGN KEY (warehouse_id)
        REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_bins_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_inventory_bins_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await inspectInventoryMasterSchema(connection);
}
