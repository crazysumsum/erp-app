const FOUNDATION_SHAPES = Object.freeze({
  id: ["bigint unsigned", "NO"],
  customer_code: ["varchar(64)", "NO"],
  customer_code_key: ["varchar(64)", "NO", "utf8mb4_bin"],
  legal_name: ["varchar(190)", "NO"],
  legal_name_key: ["varchar(190)", "NO", "utf8mb4_bin"],
  created_at: ["bigint unsigned", "NO"],
  updated_at: ["bigint unsigned", "NO"]
});

const ROOT_COLUMNS = Object.freeze([
  ["trading_name", "VARCHAR(190) NOT NULL DEFAULT ''", ["varchar(190)", "NO"]],
  ["trading_name_key", "VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL", ["varchar(190)", "YES", "utf8mb4_bin"]],
  ["default_currency_code", "CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL", ["char(3)", "YES", "ascii_bin"]],
  ["default_payment_term_id", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]],
  ["account_manager_user_id", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]],
  ["category_id", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]],
  ["industry_id", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]],
  ["territory_id", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]],
  ["website", "VARCHAR(500) NOT NULL DEFAULT ''", ["varchar(500)", "NO"]],
  ["general_phone", "VARCHAR(50) NOT NULL DEFAULT ''", ["varchar(50)", "NO"]],
  ["general_email", "VARCHAR(254) NOT NULL DEFAULT ''", ["varchar(254)", "NO"]],
  ["notes", "VARCHAR(2000) NOT NULL DEFAULT ''", ["varchar(2000)", "NO"]],
  ["status", "VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft'", ["varchar(30)", "NO", "ascii_bin"]],
  ["ever_activated_at", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]],
  ["version", "INT UNSIGNED NOT NULL DEFAULT 1", ["int unsigned", "NO"]],
  ["created_by", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]],
  ["updated_by", "BIGINT UNSIGNED NULL", ["bigint unsigned", "YES"]]
]);

const ROOT_SHAPES = Object.freeze(Object.fromEntries(ROOT_COLUMNS.map(([name, _definition, shape]) => [name, shape])));

const ROOT_INDEXES = Object.freeze([
  ["idx_customers_status_updated", "status, updated_at, id"],
  ["idx_customers_legal_name", "legal_name_key, id"],
  ["idx_customers_trading_name", "trading_name_key, id"],
  ["idx_customers_currency_status", "default_currency_code, status"],
  ["idx_customers_term_status", "default_payment_term_id, status"],
  ["idx_customers_manager_status", "account_manager_user_id, status"],
  ["idx_customers_category_status", "category_id, status"],
  ["idx_customers_industry_status", "industry_id, status"],
  ["idx_customers_territory_status", "territory_id, status"]
]);

const ROOT_FOREIGN_KEYS = Object.freeze([
  ["fk_customers_default_currency", "default_currency_code", "currencies", "code", "RESTRICT"],
  ["fk_customers_default_payment_term", "default_payment_term_id", "payment_terms", "id", "RESTRICT"],
  ["fk_customers_account_manager", "account_manager_user_id", "users", "id", "SET NULL"],
  ["fk_customers_category", "category_id", "customer_categories", "id", "RESTRICT"],
  ["fk_customers_industry", "industry_id", "customer_industries", "id", "RESTRICT"],
  ["fk_customers_territory", "territory_id", "customer_territories", "id", "RESTRICT"],
  ["fk_customers_created_by", "created_by", "users", "id", "SET NULL"],
  ["fk_customers_updated_by", "updated_by", "users", "id", "SET NULL"]
]);

function assertShape(row, expected) {
  const [columnType, nullable, collation] = expected;
  return String(row.column_type).toLowerCase() === columnType &&
    row.is_nullable === nullable &&
    (!collation || String(row.collation_name).toLowerCase() === collation);
}

async function customerColumns(connection) {
  const [rows] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable, collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customers'
      ORDER BY ordinal_position`
  );
  return rows;
}

export async function inspectCustomerRootSchema(connection) {
  const rows = await customerColumns(connection);
  const found = new Map(rows.map((row) => [row.column_name, row]));

  for (const [column, expected] of Object.entries(FOUNDATION_SHAPES)) {
    const row = found.get(column);
    if (!row || !assertShape(row, expected)) {
      throw new Error(`Incompatible existing Customer root schema: customers.${column}`);
    }
  }
  for (const [column, expected] of Object.entries(ROOT_SHAPES)) {
    const row = found.get(column);
    if (row && !assertShape(row, expected)) {
      throw new Error(`Incompatible existing Customer root schema: customers.${column}`);
    }
  }

  return found;
}

async function existingIndexes(connection) {
  const [rows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customers'
      ORDER BY index_name, seq_in_index`
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.index_name)) grouped.set(row.index_name, []);
    grouped.get(row.index_name).push(row.column_name);
  }
  return grouped;
}

async function existingForeignKeyColumns(connection) {
  const [rows] = await connection.query(
    `SELECT column_name AS column_name, referenced_table_name AS referenced_table_name,
            referenced_column_name AS referenced_column_name
       FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name = 'customers'
        AND referenced_table_name IS NOT NULL`
  );
  return new Map(rows.map((row) => [row.column_name, row]));
}

export async function up(connection) {
  const columns = await inspectCustomerRootSchema(connection);

  for (const [column, definition] of ROOT_COLUMNS) {
    if (!columns.has(column)) {
      await connection.query(`ALTER TABLE customers ADD COLUMN ${column} ${definition}`);
    }
  }

  const indexes = await existingIndexes(connection);
  for (const [name, columnsList] of ROOT_INDEXES) {
    const actual = indexes.get(name);
    if (actual && actual.join(",") !== columnsList) {
      throw new Error(`Incompatible existing Customer root index: customers.${name}`);
    }
    if (!actual) {
      await connection.query(`ALTER TABLE customers ADD KEY ${name} (${columnsList})`);
    }
  }

  const foreignKeys = await existingForeignKeyColumns(connection);
  for (const [name, column, table, referencedColumn, onDelete] of ROOT_FOREIGN_KEYS) {
    const actual = foreignKeys.get(column);
    if (actual && (actual.referenced_table_name !== table || actual.referenced_column_name !== referencedColumn)) {
      throw new Error(`Incompatible existing Customer root foreign key: customers.${column}`);
    }
    if (!actual) {
      await connection.query(
        `ALTER TABLE customers ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${table} (${referencedColumn}) ON DELETE ${onDelete}`
      );
    }
  }
}
