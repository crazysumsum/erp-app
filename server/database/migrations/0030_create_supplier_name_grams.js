const REQUIRED_COLUMNS = Object.freeze({
  supplier_id: ["bigint unsigned", "NO"],
  gram_hash: ["binary(32)", "NO"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:supplier_id,gram_hash",
  "idx_supplier_name_grams_lookup:1:gram_hash,supplier_id"
]);

export async function inspectSupplierNameGramsSchema(connection) {
  const [rows] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_name_grams'
      ORDER BY ordinal_position`
  );
  if (rows.length === 0) return false;
  const found = new Map(rows.map((row) => [row.column_name, row]));
  if (found.size !== Object.keys(REQUIRED_COLUMNS).length) {
    throw new Error("Incompatible existing Supplier schema: supplier_name_grams");
  }
  for (const [name, [type, nullable]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(name);
    if (!row || String(row.column_type).toLowerCase() !== type || row.is_nullable !== nullable) {
      throw new Error(`Incompatible existing Supplier schema: supplier_name_grams.${name}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_name_grams'
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
    if (!actual.has(expected)) throw new Error(`Incompatible existing Supplier schema index: supplier_name_grams.${expected}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectSupplierNameGramsSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_name_grams (
      supplier_id BIGINT UNSIGNED NOT NULL,
      gram_hash   BINARY(32) NOT NULL,
      PRIMARY KEY (supplier_id, gram_hash),
      KEY idx_supplier_name_grams_lookup (gram_hash, supplier_id),
      CONSTRAINT fk_supplier_name_grams_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE
    )
  `);
  await inspectSupplierNameGramsSchema(connection);
}
