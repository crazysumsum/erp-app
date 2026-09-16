const COLUMNS = Object.freeze({
  supplier_contacts: [
    "id", "supplier_id", "name", "job_title", "department", "email", "phone", "mobile",
    "preferred_language", "notes", "status", "version", "created_at", "updated_at", "created_by", "updated_by"
  ],
  supplier_contact_purposes: [
    "contact_id", "supplier_id", "purpose_code", "is_primary", "primary_slot", "created_at", "updated_at", "created_by", "updated_by"
  ]
});

const INDEXES = Object.freeze({
  supplier_contacts: new Set(["PRIMARY", "uq_supplier_contacts_owner", "idx_supplier_contacts_owner_status_name", "idx_supplier_contacts_email"]),
  supplier_contact_purposes: new Set(["PRIMARY", "uq_supplier_contact_primary", "idx_supplier_contact_purpose_owner"])
});

const FOREIGN_KEYS = Object.freeze({
  supplier_contacts: new Set(["fk_supplier_contacts_supplier", "fk_supplier_contacts_created_by", "fk_supplier_contacts_updated_by"]),
  supplier_contact_purposes: new Set(["fk_supplier_contact_purpose_owner", "fk_supplier_contact_purpose_created_by", "fk_supplier_contact_purpose_updated_by"])
});

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

export async function inspectSupplierContactSchema(connection) {
  const [columns] = await connection.query(
    `SELECT table_name AS table_name, column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('supplier_contacts', 'supplier_contact_purposes')
      ORDER BY table_name, ordinal_position`
  );
  if (columns.length === 0) return false;

  const byTable = new Map();
  for (const row of columns) {
    const table = value(row, "table_name", "TABLE_NAME");
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table).push(value(row, "column_name", "COLUMN_NAME"));
  }
  for (const [table, actual] of byTable) {
    const expected = COLUMNS[table];
    if (!expected || actual.length !== expected.length || expected.some((name) => !actual.includes(name))) {
      throw new Error(`Incompatible existing Supplier contact schema: ${table}`);
    }
  }
  if (!Object.keys(COLUMNS).every((table) => byTable.has(table))) return false;

  const [indexes] = await connection.query(
    `SELECT DISTINCT table_name AS table_name, index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name IN ('supplier_contacts', 'supplier_contact_purposes')`
  );
  const actualIndexes = new Map(Object.keys(COLUMNS).map((table) => [table, new Set()]));
  for (const row of indexes) actualIndexes.get(value(row, "table_name", "TABLE_NAME"))?.add(value(row, "index_name", "INDEX_NAME"));
  for (const [table, expected] of Object.entries(INDEXES)) {
    for (const name of expected) {
      if (!actualIndexes.get(table).has(name)) throw new Error(`Incompatible existing Supplier contact index: ${table}.${name}`);
    }
  }

  const [foreignKeys] = await connection.query(
    `SELECT table_name AS table_name, constraint_name AS constraint_name
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('supplier_contacts', 'supplier_contact_purposes')`
  );
  const actualForeignKeys = new Map(Object.keys(COLUMNS).map((table) => [table, new Set()]));
  for (const row of foreignKeys) actualForeignKeys.get(value(row, "table_name", "TABLE_NAME"))?.add(value(row, "constraint_name", "CONSTRAINT_NAME"));
  for (const [table, expected] of Object.entries(FOREIGN_KEYS)) {
    for (const name of expected) {
      if (!actualForeignKeys.get(table).has(name)) throw new Error(`Incompatible existing Supplier contact FK: ${table}.${name}`);
    }
  }
  return true;
}

export async function up(connection) {
  if (await inspectSupplierContactSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_contacts (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      supplier_id        BIGINT UNSIGNED NOT NULL,
      name               VARCHAR(190) NOT NULL,
      job_title          VARCHAR(100) NOT NULL DEFAULT '',
      department         VARCHAR(100) NOT NULL DEFAULT '',
      email              VARCHAR(254) NOT NULL DEFAULT '',
      phone              VARCHAR(50) NOT NULL DEFAULT '',
      mobile             VARCHAR(50) NOT NULL DEFAULT '',
      preferred_language VARCHAR(20) NOT NULL DEFAULT '',
      notes              VARCHAR(500) NOT NULL DEFAULT '',
      status             VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
      version            INT UNSIGNED NOT NULL DEFAULT 1,
      created_at         BIGINT UNSIGNED NOT NULL,
      updated_at         BIGINT UNSIGNED NOT NULL,
      created_by         BIGINT UNSIGNED NULL,
      updated_by         BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_contacts_owner (id, supplier_id),
      KEY idx_supplier_contacts_owner_status_name (supplier_id, status, name),
      KEY idx_supplier_contacts_email (email),
      CONSTRAINT fk_supplier_contacts_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
      CONSTRAINT fk_supplier_contacts_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_contact_purposes (
      contact_id   BIGINT UNSIGNED NOT NULL,
      supplier_id  BIGINT UNSIGNED NOT NULL,
      purpose_code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      is_primary   TINYINT UNSIGNED NOT NULL DEFAULT 0,
      primary_slot TINYINT GENERATED ALWAYS AS (IF(is_primary = 1, 1, NULL)) STORED,
      created_at   BIGINT UNSIGNED NOT NULL,
      updated_at   BIGINT UNSIGNED NOT NULL,
      created_by   BIGINT UNSIGNED NULL,
      updated_by   BIGINT UNSIGNED NULL,
      PRIMARY KEY (contact_id, purpose_code),
      UNIQUE KEY uq_supplier_contact_primary (supplier_id, purpose_code, primary_slot),
      KEY idx_supplier_contact_purpose_owner (supplier_id, contact_id),
      CONSTRAINT fk_supplier_contact_purpose_owner FOREIGN KEY (contact_id, supplier_id)
        REFERENCES supplier_contacts (id, supplier_id) ON DELETE CASCADE,
      CONSTRAINT fk_supplier_contact_purpose_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_contact_purpose_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSupplierContactSchema(connection);
}
