const CATALOG_TABLES = Object.freeze([
  "customer_categories",
  "customer_industries",
  "customer_territories"
]);

const REQUIRED_COLUMNS = Object.freeze([
  "id",
  "code",
  "code_key",
  "name",
  "description",
  "status",
  "sort_order",
  "version",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by"
]);

const COLUMN_SHAPES = Object.freeze({
  id: ["bigint unsigned", "NO"],
  code: ["varchar(50)", "NO"],
  code_key: ["varchar(50)", "NO", "utf8mb4_bin"],
  name: ["varchar(100)", "NO"],
  description: ["varchar(500)", "NO"],
  status: ["varchar(20)", "NO", "ascii_bin"],
  sort_order: ["int unsigned", "NO"],
  version: ["int unsigned", "NO"],
  created_at: ["bigint unsigned", "NO"],
  created_by: ["bigint unsigned", "YES"],
  updated_at: ["bigint unsigned", "NO"],
  updated_by: ["bigint unsigned", "YES"]
});

function requiredIndexes(table) {
  return new Set([
    "PRIMARY:0:id",
    `uq_${table}_code_key:0:code_key`,
    `idx_${table}_status_sort_name:1:status,sort_order,name`
  ]);
}

export async function inspectCustomerClassificationCatalogSchema(connection) {
  const [rows] = await connection.query(
    `SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable, collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('customer_categories', 'customer_industries', 'customer_territories')
      ORDER BY table_name, ordinal_position`
  );
  const found = new Map();

  for (const row of rows) {
    if (!found.has(row.table_name)) found.set(row.table_name, new Set());
    found.get(row.table_name).add(row.column_name);
  }

  for (const [table, columns] of found) {
    if (!CATALOG_TABLES.includes(table) || REQUIRED_COLUMNS.some((column) => !columns.has(column))) {
      throw new Error(`Incompatible existing Customer classification catalog schema: ${table}`);
    }
    for (const row of rows.filter((candidate) => candidate.table_name === table)) {
      const [columnType, nullable, collation] = COLUMN_SHAPES[row.column_name] ?? [];
      if (
        String(row.column_type).toLowerCase() !== columnType ||
        row.is_nullable !== nullable ||
        (collation && String(row.collation_name).toLowerCase() !== collation)
      ) {
        throw new Error(`Incompatible existing Customer classification catalog schema: ${table}.${row.column_name}`);
      }
    }
  }

  if (found.size > 0) {
    const [indexRows] = await connection.query(
      `SELECT table_name AS table_name, index_name AS index_name, non_unique AS non_unique,
              seq_in_index AS seq_in_index, column_name AS column_name
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name IN ('customer_categories', 'customer_industries', 'customer_territories')
        ORDER BY table_name, index_name, seq_in_index`
    );
    for (const table of found.keys()) {
      const grouped = new Map();
      for (const row of indexRows.filter((candidate) => candidate.table_name === table)) {
        const key = `${row.index_name}:${Number(row.non_unique)}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row.column_name);
      }
      const actual = new Set([...grouped].map(([key, columns]) => `${key}:${columns.join(",")}`));
      for (const expected of requiredIndexes(table)) {
        if (!actual.has(expected)) {
          throw new Error(`Incompatible existing Customer classification catalog index: ${table}.${expected}`);
        }
      }
    }
  }

  return found;
}

function createCatalogTableSql(table) {
  return `
    CREATE TABLE IF NOT EXISTS ${table} (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code        VARCHAR(50) NOT NULL,
      code_key    VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      name        VARCHAR(100) NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      status      VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      sort_order  INT UNSIGNED NOT NULL DEFAULT 0,
      version     INT UNSIGNED NOT NULL,
      created_at  BIGINT UNSIGNED NOT NULL,
      created_by  BIGINT UNSIGNED NULL,
      updated_at  BIGINT UNSIGNED NOT NULL,
      updated_by  BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_${table}_code_key (code_key),
      KEY idx_${table}_status_sort_name (status, sort_order, name),
      CONSTRAINT fk_${table}_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_${table}_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
}

export async function up(connection) {
  await inspectCustomerClassificationCatalogSchema(connection);

  for (const table of CATALOG_TABLES) {
    await connection.query(createCatalogTableSql(table));
  }
}
