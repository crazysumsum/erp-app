const COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO", null, null, "auto_increment"],
  document_type: ["varchar(20)", "NO", null, "utf8mb4_unicode_ci"],
  period_key: ["char(6)", "NO", null, "ascii_bin"],
  next_value: ["int unsigned", "NO", "1"],
  updated_at: ["bigint unsigned", "NO", null]
});
const INDEXES = { PRIMARY: [0, "id"], uq_sales_sequence: [0, "document_type,period_key"] };

// Shared only by the two Sales foundation migrations; existing tables must match before rerun.
export async function inspectSalesFoundationTable(connection, { table, columns: expected, indexes: expectedIndexes, actor = false }) {
  const incompatible = detail => new Error(`Incompatible existing Sales foundation schema: ${table} ${detail}`);
  const [columns] = await connection.query(`SELECT column_name AS name, column_type AS type, is_nullable AS nullable,
    column_default AS default_value, collation_name AS collation, extra AS extra FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`, [table]);
  if (!columns.length) return false;
  if (columns.length !== Object.keys(expected).length || columns.some(row => !Object.hasOwn(expected, row.name))) throw incompatible("columns");
  for (const row of columns) {
    const [type, nullable, defaultValue, collation, extra = ""] = expected[row.name];
    if (String(row.type).toLowerCase() !== type || row.nullable !== nullable ||
        (row.default_value ?? null) !== defaultValue || (collation && row.collation !== collation) ||
        String(row.extra ?? "").toLowerCase() !== extra) throw incompatible(`column ${row.name}`);
  }
  const [tables] = await connection.query("SELECT engine AS engine, table_collation AS collation, table_schema AS schema_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [table]);
  if (tables[0]?.engine !== "InnoDB" || tables[0]?.collation !== "utf8mb4_unicode_ci") throw incompatible("engine/collation");
  const [rows] = await connection.query(`SELECT index_name AS name, non_unique AS non_unique, column_name AS column_name, sub_part AS sub_part
    FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? ORDER BY index_name, seq_in_index`, [table]);
  const indexes = new Map();
  for (const row of rows) {
    if (Object.hasOwn(expectedIndexes, row.name) && row.sub_part !== null) throw incompatible(`index prefix ${row.name}`);
    if (!indexes.has(row.name)) indexes.set(row.name, { nonUnique: Number(row.non_unique), columns: [] });
    indexes.get(row.name).columns.push(row.column_name);
  }
  for (const [name, index] of indexes) if (index.nonUnique === 0 && !Object.hasOwn(expectedIndexes, name)) throw incompatible(`unexpected unique index ${name}`);
  for (const [name, [nonUnique, names]] of Object.entries(expectedIndexes)) {
    const found = indexes.get(name);
    if (!found || found.nonUnique !== nonUnique || found.columns.join(",") !== names) throw incompatible(`index ${name}`);
  }
  const [foreignKeys] = await connection.query(`SELECT k.column_name AS column_name, k.referenced_table_name AS table_name,
    k.referenced_column_name AS referenced_column, k.referenced_table_schema AS referenced_schema,
    r.delete_rule AS delete_rule, r.update_rule AS update_rule FROM information_schema.key_column_usage k
    JOIN information_schema.referential_constraints r ON r.constraint_schema = k.constraint_schema AND r.table_name = k.table_name AND r.constraint_name = k.constraint_name
    WHERE k.table_schema = DATABASE() AND k.table_name = ?`, [table]);
  if (foreignKeys.length !== (actor ? 1 : 0) || (actor && (foreignKeys[0].column_name !== "actor_user_id" ||
      foreignKeys[0].table_name !== "users" || foreignKeys[0].referenced_column !== "id" || foreignKeys[0].delete_rule !== "SET NULL" ||
      foreignKeys[0].referenced_schema !== tables[0].schema_name || !["RESTRICT", "NO ACTION"].includes(foreignKeys[0].update_rule)))) throw incompatible("foreign keys");
  const [checks] = await connection.query("SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_type = 'CHECK'", [table]);
  if (checks.length) throw incompatible("unexpected checks");
  return true;
}

export function inspectSalesSequenceSchema(connection, { table = "sales_document_sequences" } = {}) {
  return inspectSalesFoundationTable(connection, { table, columns: COLUMNS, indexes: INDEXES });
}

export async function up(connection) {
  if (await inspectSalesSequenceSchema(connection)) return;
  await connection.query(`CREATE TABLE IF NOT EXISTS sales_document_sequences (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    document_type VARCHAR(20) NOT NULL,
    period_key CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    next_value INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_sales_sequence (document_type, period_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  if (!await inspectSalesSequenceSchema(connection)) throw new Error("Sales sequence schema was not created");
}
