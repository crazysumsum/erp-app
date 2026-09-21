const REQUIRED_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO", "auto_increment"],
  customer_id: ["bigint unsigned", "NO"],
  identifier_type: ["varchar(50)", "NO"],
  issuer_country_code: ["char(2)", "NO"],
  identifier_value: ["varchar(190)", "NO"],
  identifier_value_key: ["varchar(190)", "NO", "", "utf8mb4_bin"],
  valid_from: ["bigint unsigned", "YES"],
  expires_at: ["bigint unsigned", "YES"],
  notes: ["varchar(500)", "NO"],
  status: ["varchar(20)", "NO"],
  version: ["int unsigned", "NO"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:id",
  "uq_customer_identifiers_owner:0:id,customer_id",
  "uq_customer_identifiers_global:0:identifier_type,issuer_country_code,identifier_value_key",
  "idx_customer_identifiers_owner:1:customer_id,status,identifier_type"
]);

export async function inspectCustomerIdentifierSchema(connection) {
  const [tables] = await connection.query("SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'customer_identifiers'");
  if (tables.length === 0) return false;
  const [rows] = await connection.query("SELECT column_name AS columnName, column_type AS columnType, is_nullable AS isNullable, extra AS extraValue, collation_name AS collationName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customer_identifiers'");
  const found = new Map(rows.map((row) => [row.columnName, row]));
  for (const [column, [type, nullable, extra, collation]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(column);
    if (!row || String(row.columnType).toLowerCase() !== type || row.isNullable !== nullable || (extra && String(row.extraValue).toLowerCase() !== extra) || (collation && String(row.collationName).toLowerCase() !== collation)) {
      throw new Error(`Incompatible existing Customer identifier schema: customer_identifiers.${column}`);
    }
  }
  const [indexRows] = await connection.query("SELECT index_name AS indexName, non_unique AS nonUnique, seq_in_index AS sequence, column_name AS columnName FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customer_identifiers' ORDER BY index_name, seq_in_index");
  const grouped = new Map();
  for (const row of indexRows) { const key = `${row.indexName}:${Number(row.nonUnique)}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row.columnName); }
  const actual = new Set([...grouped].map(([key, columns]) => `${key}:${columns.join(",")}`));
  for (const expected of REQUIRED_INDEXES) if (!actual.has(expected)) throw new Error(`Incompatible existing Customer identifier index: customer_identifiers.${expected}`);
  return true;
}

export async function up(connection) {
  await inspectCustomerIdentifierSchema(connection);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_identifiers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      customer_id BIGINT UNSIGNED NOT NULL,
      identifier_type VARCHAR(50) NOT NULL,
      issuer_country_code CHAR(2) NOT NULL,
      identifier_value VARCHAR(190) NOT NULL,
      identifier_value_key VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      valid_from BIGINT UNSIGNED NULL,
      expires_at BIGINT UNSIGNED NULL,
      notes VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_identifiers_owner (id, customer_id),
      UNIQUE KEY uq_customer_identifiers_global (identifier_type, issuer_country_code, identifier_value_key),
      KEY idx_customer_identifiers_owner (customer_id, status, identifier_type),
      CONSTRAINT fk_customer_identifiers_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_identifiers_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_identifiers_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
