const COLUMNS = Object.freeze([
  "job_id", "row_number", "operation", "match_customer_id", "expected_customer_version",
  "normalized_payload", "status", "applied_customer_id", "errors", "warnings",
  "started_at", "completed_at", "version"
]);

function value(row, lower, upper) { return row[lower] ?? row[upper]; }

export async function inspectCustomerImportRowSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_import_rows' ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name, index) => actual[index] !== name)) {
    throw new Error("Incompatible existing Customer import schema: customer_import_rows");
  }

  const [indexes] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_import_rows'
      ORDER BY index_name, seq_in_index`
  );
  const actualIndexes = indexes.map((row) => `${value(row, "index_name", "INDEX_NAME")}:${Number(value(row, "non_unique", "NON_UNIQUE"))}:${value(row, "column_name", "COLUMN_NAME")}`);
  for (const expected of [
    "PRIMARY:0:job_id", "PRIMARY:0:row_number",
    "idx_customer_import_row_status:1:job_id", "idx_customer_import_row_status:1:status",
    "idx_customer_import_row_status:1:row_number"
  ]) {
    if (!actualIndexes.includes(expected)) throw new Error(`Incompatible existing Customer import row index: ${expected}`);
  }

  const [foreignRows] = await connection.query(
    `SELECT rc.constraint_name AS constraint_name, kcu.column_name AS column_name,
            rc.referenced_table_name AS referenced_table_name,
            kcu.referenced_column_name AS referenced_column_name, rc.delete_rule AS delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = rc.constraint_schema AND kcu.table_name = rc.table_name
        AND kcu.constraint_name = rc.constraint_name
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name = 'customer_import_rows'`
  );
  const fk = foreignRows[0];
  if (foreignRows.length !== 1 || value(fk, "constraint_name", "CONSTRAINT_NAME") !== "fk_customer_import_row_job" ||
      value(fk, "column_name", "COLUMN_NAME") !== "job_id" ||
      value(fk, "referenced_table_name", "REFERENCED_TABLE_NAME") !== "customer_import_jobs" ||
      value(fk, "referenced_column_name", "REFERENCED_COLUMN_NAME") !== "id" ||
      String(value(fk, "delete_rule", "DELETE_RULE")).toUpperCase() !== "CASCADE") {
    throw new Error("Incompatible existing Customer import row foreign key");
  }
  return true;
}

export async function up(connection) {
  if (await inspectCustomerImportRowSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_import_rows (
      job_id BIGINT UNSIGNED NOT NULL,
      \`row_number\` INT UNSIGNED NOT NULL,
      operation VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      match_customer_id BIGINT UNSIGNED NULL,
      expected_customer_version INT UNSIGNED NULL,
      normalized_payload JSON NOT NULL,
      status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_customer_id BIGINT UNSIGNED NULL,
      errors JSON NULL,
      warnings JSON NULL,
      started_at BIGINT UNSIGNED NULL,
      completed_at BIGINT UNSIGNED NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (job_id,\`row_number\`),
      KEY idx_customer_import_row_status (job_id,status,\`row_number\`),
      CONSTRAINT fk_customer_import_row_job FOREIGN KEY (job_id) REFERENCES customer_import_jobs (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await inspectCustomerImportRowSchema(connection);
}
