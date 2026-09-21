const COLUMNS = Object.freeze([
  "id", "require_activation_approval", "version", "updated_at", "updated_by"
]);
const INDEXES = new Set(["PRIMARY"]);
const FOREIGN_KEYS = new Set(["fk_supplier_settings_updated_by"]);

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

export async function inspectSupplierSettingsSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_settings'
      ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name) => !actual.includes(name))) {
    throw new Error("Incompatible existing Supplier settings schema: supplier_settings");
  }

  const [indexes] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_settings'`
  );
  const actualIndexes = new Set(indexes.map((row) => value(row, "index_name", "INDEX_NAME")));
  for (const name of INDEXES) {
    if (!actualIndexes.has(name)) throw new Error(`Incompatible existing Supplier settings index: ${name}`);
  }

  const [foreignKeys] = await connection.query(
    `SELECT constraint_name AS constraint_name
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'supplier_settings'`
  );
  const actualForeignKeys = new Set(foreignKeys.map((row) => value(row, "constraint_name", "CONSTRAINT_NAME")));
  for (const name of FOREIGN_KEYS) {
    if (!actualForeignKeys.has(name)) throw new Error(`Incompatible existing Supplier settings FK: ${name}`);
  }
  return true;
}

export async function up(connection) {
  const existed = await inspectSupplierSettingsSchema(connection);
  if (!existed) {
    // Singleton: one company, one settings row. Typed columns rather than a
    // key/value table, so a later parameter arrives as a forward migration with
    // its own schema, UI and audit rather than as an untyped string.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS supplier_settings (
        id                          TINYINT UNSIGNED NOT NULL,
        require_activation_approval TINYINT(1) NOT NULL DEFAULT 0,
        version                     INT UNSIGNED NOT NULL DEFAULT 1,
        updated_at                  BIGINT UNSIGNED NOT NULL,
        updated_by                  BIGINT UNSIGNED NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_supplier_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
      )
    `);
    await inspectSupplierSettingsSchema(connection);
  }

  // Seed id=1 with approval OFF, so existing activation behaviour is unchanged.
  // Deliberately NOT INSERT IGNORE: that would swallow unrelated errors such as a
  // broken FK or a bad column, which is exactly what this check exists to surface.
  // A half-applied run re-enters here and the WHERE NOT EXISTS makes it converge.
  await connection.query(
    `INSERT INTO supplier_settings (id, require_activation_approval, version, updated_at, updated_by)
     SELECT 1, 0, 1, ?, NULL
      WHERE NOT EXISTS (SELECT 1 FROM supplier_settings WHERE id = 1)`,
    [Date.now()]
  );

  const [[seeded]] = await connection.query("SELECT id FROM supplier_settings WHERE id = 1");
  if (!seeded) throw new Error("Supplier settings singleton row id=1 was not seeded");
}
