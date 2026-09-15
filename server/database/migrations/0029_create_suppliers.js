const REQUIRED_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  supplier_code: ["varchar(64)", "NO"],
  supplier_code_key: ["varchar(64)", "NO", "utf8mb4_bin"],
  supplier_name: ["varchar(190)", "NO"],
  supplier_name_key: ["varchar(190)", "NO", "utf8mb4_bin"],
  display_name: ["varchar(190)", "NO"],
  default_currency_code: ["char(3)", "NO", "ascii_bin"],
  default_payment_term_id: ["bigint unsigned", "YES"],
  website: ["varchar(500)", "NO"],
  general_phone: ["varchar(50)", "NO"],
  general_email: ["varchar(254)", "NO"],
  notes: ["varchar(2000)", "NO"],
  status: ["varchar(30)", "NO", "ascii_bin"],
  version: ["int unsigned", "NO"],
  created_at: ["bigint unsigned", "NO"],
  updated_at: ["bigint unsigned", "NO"],
  created_by: ["bigint unsigned", "YES"],
  updated_by: ["bigint unsigned", "YES"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:id",
  "uq_suppliers_code_key:0:supplier_code_key",
  "idx_suppliers_status_updated_id:1:status,updated_at,id",
  "idx_suppliers_name_key:1:supplier_name_key",
  "idx_suppliers_currency_status:1:default_currency_code,status",
  "idx_suppliers_payment_term_status:1:default_payment_term_id,status"
]);

function lower(value) {
  return value === null || value === undefined ? value : String(value).toLowerCase();
}

export async function inspectSuppliersSchema(connection) {
  const [rows] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable, collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'suppliers'
      ORDER BY ordinal_position`
  );
  if (rows.length === 0) return false;
  const found = new Map(rows.map((row) => [row.column_name, row]));
  if (found.size !== Object.keys(REQUIRED_COLUMNS).length) {
    throw new Error("Incompatible existing Supplier schema: suppliers");
  }
  for (const [name, [type, nullable, collation]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(name);
    if (!row || lower(row.column_type) !== type || row.is_nullable !== nullable || (collation && lower(row.collation_name) !== collation)) {
      throw new Error(`Incompatible existing Supplier schema: suppliers.${name}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'suppliers'
      ORDER BY index_name, seq_in_index`
  );
  const grouped = new Map();
  for (const row of indexRows) {
    const key = `${row.index_name}:${Number(row.non_unique)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row.column_name);
  }
  const actual = new Set([...grouped].map(([key, columns]) => `${key}:${columns.join(",")}`));
  for (const expected of REQUIRED_INDEXES) {
    if (!actual.has(expected)) throw new Error(`Incompatible existing Supplier schema index: suppliers.${expected}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectSuppliersSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      supplier_code           VARCHAR(64) NOT NULL,
      supplier_code_key       VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      supplier_name           VARCHAR(190) NOT NULL,
      supplier_name_key       VARCHAR(190) COLLATE utf8mb4_bin NOT NULL,
      display_name            VARCHAR(190) NOT NULL DEFAULT '',
      default_currency_code   CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      default_payment_term_id BIGINT UNSIGNED NULL,
      website                 VARCHAR(500) NOT NULL DEFAULT '',
      general_phone           VARCHAR(50) NOT NULL DEFAULT '',
      general_email           VARCHAR(254) NOT NULL DEFAULT '',
      notes                   VARCHAR(2000) NOT NULL DEFAULT '',
      status                  VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
      version                 INT UNSIGNED NOT NULL DEFAULT 1,
      created_at              BIGINT UNSIGNED NOT NULL,
      updated_at              BIGINT UNSIGNED NOT NULL,
      created_by              BIGINT UNSIGNED NULL,
      updated_by              BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_suppliers_code_key (supplier_code_key),
      KEY idx_suppliers_status_updated_id (status, updated_at, id),
      KEY idx_suppliers_name_key (supplier_name_key),
      KEY idx_suppliers_currency_status (default_currency_code, status),
      KEY idx_suppliers_payment_term_status (default_payment_term_id, status),
      CONSTRAINT fk_suppliers_currency FOREIGN KEY (default_currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_suppliers_payment_term FOREIGN KEY (default_payment_term_id) REFERENCES payment_terms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_suppliers_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_suppliers_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSuppliersSchema(connection);
}
