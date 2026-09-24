const COLUMNS = Object.freeze([
  "id", "idempotency_key", "operation_id", "filter_snapshot", "result_stored_name",
  "result_sha256", "result_storage_status", "status", "total_count", "expires_at",
  "last_error_code", "error_summary", "created_by", "created_at", "updated_at",
  "completed_at", "version"
]);

const INDEXES = Object.freeze({
  PRIMARY: [true, "id"],
  uq_customer_export_actor_key: [true, "created_by,idempotency_key"],
  uq_customer_export_operation: [true, "operation_id"],
  uq_customer_export_result_name: [true, "result_stored_name"],
  idx_customer_export_actor: [false, "created_by,created_at,id"],
  idx_customer_export_status: [false, "status,updated_at,id"]
});
const FOREIGN_KEYS = Object.freeze({
  fk_customer_export_operation: ["operation_id", "customer_operation_requests", "id", "RESTRICT"],
  fk_customer_export_created_by: ["created_by", "users", "id", "SET NULL"]
});

function value(row, lower, upper) { return row[lower] ?? row[upper]; }

export async function inspectCustomerExportJobSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_export_jobs' ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name, index) => actual[index] !== name)) {
    throw new Error("Incompatible existing Customer export schema: customer_export_jobs");
  }
  const [rows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_export_jobs'
      ORDER BY index_name, seq_in_index`
  );
  const indexes = new Map();
  for (const row of rows) {
    const name = value(row, "index_name", "INDEX_NAME");
    const found = indexes.get(name) ?? { unique: true, columns: [] };
    found.unique &&= Number(value(row, "non_unique", "NON_UNIQUE")) === 0;
    found.columns.push(value(row, "column_name", "COLUMN_NAME"));
    indexes.set(name, found);
  }
  for (const [name, [unique, columnsList]] of Object.entries(INDEXES)) {
    const found = indexes.get(name);
    if (!found || found.unique !== unique || found.columns.join(",") !== columnsList) {
      throw new Error(`Incompatible existing Customer export index: ${name}`);
    }
  }
  const [foreignRows] = await connection.query(
    `SELECT rc.constraint_name AS constraint_name, kcu.column_name AS column_name,
            rc.referenced_table_name AS referenced_table_name,
            kcu.referenced_column_name AS referenced_column_name, rc.delete_rule AS delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = rc.constraint_schema AND kcu.table_name = rc.table_name
        AND kcu.constraint_name = rc.constraint_name
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name = 'customer_export_jobs'`
  );
  if (foreignRows.length !== Object.keys(FOREIGN_KEYS).length) throw new Error("Incompatible existing Customer export foreign keys");
  for (const row of foreignRows) {
    const name = value(row, "constraint_name", "CONSTRAINT_NAME");
    const expected = FOREIGN_KEYS[name];
    const actual = [value(row, "column_name", "COLUMN_NAME"), value(row, "referenced_table_name", "REFERENCED_TABLE_NAME"), value(row, "referenced_column_name", "REFERENCED_COLUMN_NAME"), String(value(row, "delete_rule", "DELETE_RULE")).toUpperCase()];
    if (!expected || actual.some((part, index) => part !== expected[index])) throw new Error(`Incompatible existing Customer export FK: ${name}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectCustomerExportJobSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_export_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      idempotency_key VARCHAR(128) NOT NULL,
      operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      filter_snapshot JSON NOT NULL,
      result_stored_name CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      result_sha256 BINARY(32) NULL,
      result_storage_status VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
      status VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
      total_count INT UNSIGNED NOT NULL DEFAULT 0,
      expires_at BIGINT UNSIGNED NULL,
      last_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      error_summary VARCHAR(500) NOT NULL DEFAULT '',
      created_by BIGINT UNSIGNED NULL,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      completed_at BIGINT UNSIGNED NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_export_actor_key (created_by,idempotency_key),
      UNIQUE KEY uq_customer_export_operation (operation_id),
      UNIQUE KEY uq_customer_export_result_name (result_stored_name),
      KEY idx_customer_export_actor (created_by,created_at,id),
      KEY idx_customer_export_status (status,updated_at,id),
      CONSTRAINT fk_customer_export_operation FOREIGN KEY (operation_id) REFERENCES customer_operation_requests (id) ON DELETE RESTRICT,
      CONSTRAINT fk_customer_export_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await inspectCustomerExportJobSchema(connection);
}
