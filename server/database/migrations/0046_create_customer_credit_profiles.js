const REQUIRED_COLUMNS = Object.freeze({
  customer_id: ["bigint unsigned", "NO"],
  credit_limit: ["decimal(19,4)", "YES"],
  credit_currency_code: ["char(3)", "YES", "ascii_bin"],
  credit_status: ["varchar(20)", "NO"],
  credit_notes: ["varchar(1000)", "NO"],
  last_change_reason: ["varchar(500)", "NO"],
  version: ["int unsigned", "NO"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:customer_id",
  "idx_customer_credit_status:1:credit_status,customer_id",
  "idx_customer_credit_currency:1:credit_currency_code"
]);

export async function inspectCustomerCreditSchema(connection) {
  const [tables] = await connection.query("SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'customer_credit_profiles'");
  if (tables.length === 0) return false;
  const [rows] = await connection.query("SELECT column_name AS columnName, column_type AS columnType, is_nullable AS isNullable, extra AS extraValue, collation_name AS collationName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customer_credit_profiles'");
  const found = new Map(rows.map((row) => [row.columnName, row]));
  for (const [column, [type, nullable, collation]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(column);
    if (!row || String(row.columnType).toLowerCase() !== type || row.isNullable !== nullable || (collation && String(row.collationName).toLowerCase() !== collation)) throw new Error(`Incompatible existing Customer credit schema: customer_credit_profiles.${column}`);
  }
  const [indexRows] = await connection.query("SELECT index_name AS indexName, non_unique AS nonUnique, seq_in_index AS sequence, column_name AS columnName FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customer_credit_profiles' ORDER BY index_name, seq_in_index");
  const grouped = new Map();
  for (const row of indexRows) { const key = `${row.indexName}:${Number(row.nonUnique)}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row.columnName); }
  const actual = new Set([...grouped].map(([key, columns]) => `${key}:${columns.join(",")}`));
  for (const expected of REQUIRED_INDEXES) if (!actual.has(expected)) throw new Error(`Incompatible existing Customer credit index: customer_credit_profiles.${expected}`);
  return true;
}

export async function up(connection) {
  await inspectCustomerCreditSchema(connection);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_credit_profiles (
      customer_id BIGINT UNSIGNED NOT NULL,
      credit_limit DECIMAL(19,4) NULL,
      credit_currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
      credit_status VARCHAR(20) NOT NULL,
      credit_notes VARCHAR(1000) NOT NULL DEFAULT '',
      last_change_reason VARCHAR(500) NOT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (customer_id),
      KEY idx_customer_credit_status (credit_status, customer_id),
      KEY idx_customer_credit_currency (credit_currency_code),
      CONSTRAINT fk_customer_credit_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_credit_currency FOREIGN KEY (credit_currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_customer_credit_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_credit_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
