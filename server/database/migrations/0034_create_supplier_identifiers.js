const COLUMNS = Object.freeze([
  "id", "supplier_id", "identifier_type", "issuer_country_code", "identifier_value", "identifier_value_key",
  "notes", "version", "created_at", "updated_at", "created_by", "updated_by"
]);
const INDEXES = new Set(["PRIMARY", "uq_supplier_identifier_value", "idx_supplier_identifiers_owner_type"]);
const FOREIGN_KEYS = new Set(["fk_supplier_identifiers_supplier", "fk_supplier_identifiers_created_by", "fk_supplier_identifiers_updated_by"]);

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

export async function inspectSupplierIdentifierSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_identifiers'
      ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name) => !actual.includes(name))) {
    throw new Error("Incompatible existing Supplier identifier schema: supplier_identifiers");
  }

  const [indexes] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_identifiers'`
  );
  const actualIndexes = new Set(indexes.map((row) => value(row, "index_name", "INDEX_NAME")));
  for (const name of INDEXES) {
    if (!actualIndexes.has(name)) throw new Error(`Incompatible existing Supplier identifier index: ${name}`);
  }

  const [foreignKeys] = await connection.query(
    `SELECT constraint_name AS constraint_name
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'supplier_identifiers'`
  );
  const actualForeignKeys = new Set(foreignKeys.map((row) => value(row, "constraint_name", "CONSTRAINT_NAME")));
  for (const name of FOREIGN_KEYS) {
    if (!actualForeignKeys.has(name)) throw new Error(`Incompatible existing Supplier identifier FK: ${name}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectSupplierIdentifierSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_identifiers (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      supplier_id           BIGINT UNSIGNED NOT NULL,
      identifier_type       VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      issuer_country_code   CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      identifier_value      VARCHAR(190) NOT NULL,
      identifier_value_key  VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      notes                 VARCHAR(500) NOT NULL DEFAULT '',
      version               INT UNSIGNED NOT NULL DEFAULT 1,
      created_at            BIGINT UNSIGNED NOT NULL,
      updated_at            BIGINT UNSIGNED NOT NULL,
      created_by            BIGINT UNSIGNED NULL,
      updated_by            BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_identifier_value (identifier_type, issuer_country_code, identifier_value_key),
      KEY idx_supplier_identifiers_owner_type (supplier_id, identifier_type, id),
      CONSTRAINT fk_supplier_identifiers_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
      CONSTRAINT fk_supplier_identifiers_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_identifiers_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSupplierIdentifierSchema(connection);
}
