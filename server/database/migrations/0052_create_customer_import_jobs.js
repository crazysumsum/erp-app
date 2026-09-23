const COLUMNS = Object.freeze([
  "id", "idempotency_key", "template_version", "operation_id",
  "source_stored_name", "source_sha256", "source_storage_status",
  "result_stored_name", "result_sha256", "result_storage_status", "files_purged_at",
  "mode", "activation_mode", "approver_user_id", "approval_setting_value",
  "approval_setting_version", "status", "total_count", "valid_count", "warning_count",
  "invalid_count", "success_count", "failed_count", "skipped_count", "lease_owner",
  "lease_until", "last_error_code", "error_summary", "created_by", "confirmed_by",
  "created_at", "updated_at", "confirmed_at", "completed_at", "version"
]);

const INDEXES = Object.freeze({
  PRIMARY: [true, "id"],
  uq_customer_import_actor_key: [true, "created_by,idempotency_key"],
  uq_customer_import_operation: [true, "operation_id"],
  uq_customer_import_source_name: [true, "source_stored_name"],
  uq_customer_import_result_name: [true, "result_stored_name"],
  idx_customer_import_status: [false, "status,created_at,id"],
  idx_customer_import_lease: [false, "lease_until,status"],
  idx_customer_import_actor: [false, "created_by,created_at,id"],
  idx_customer_import_source_recovery: [false, "source_storage_status,updated_at,id"],
  idx_customer_import_result_recovery: [false, "result_storage_status,updated_at,id"]
});

const FOREIGN_KEYS = Object.freeze({
  fk_customer_import_operation: ["operation_id", "customer_operation_requests", "id", "RESTRICT"],
  fk_customer_import_approver: ["approver_user_id", "users", "id", "SET NULL"],
  fk_customer_import_created_by: ["created_by", "users", "id", "SET NULL"],
  fk_customer_import_confirmed_by: ["confirmed_by", "users", "id", "SET NULL"]
});

function value(row, lower, upper) { return row[lower] ?? row[upper]; }

export async function inspectCustomerImportJobSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_import_jobs' ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actualColumns = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actualColumns.length !== COLUMNS.length || COLUMNS.some((name, index) => actualColumns[index] !== name)) {
    throw new Error("Incompatible existing Customer import schema: customer_import_jobs");
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_import_jobs'
      ORDER BY index_name, seq_in_index`
  );
  const indexes = new Map();
  for (const row of indexRows) {
    const name = value(row, "index_name", "INDEX_NAME");
    const found = indexes.get(name) ?? { unique: true, columns: [] };
    found.unique &&= Number(value(row, "non_unique", "NON_UNIQUE")) === 0;
    found.columns.push(value(row, "column_name", "COLUMN_NAME"));
    indexes.set(name, found);
  }
  for (const [name, [unique, columnList]] of Object.entries(INDEXES)) {
    const found = indexes.get(name);
    if (!found || found.unique !== unique || found.columns.join(",") !== columnList) {
      throw new Error(`Incompatible existing Customer import index: ${name}`);
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
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name = 'customer_import_jobs'`
  );
  if (foreignRows.length !== Object.keys(FOREIGN_KEYS).length) {
    throw new Error("Incompatible existing Customer import job foreign keys");
  }
  for (const row of foreignRows) {
    const name = value(row, "constraint_name", "CONSTRAINT_NAME");
    const expected = FOREIGN_KEYS[name];
    const actual = [
      value(row, "column_name", "COLUMN_NAME"),
      value(row, "referenced_table_name", "REFERENCED_TABLE_NAME"),
      value(row, "referenced_column_name", "REFERENCED_COLUMN_NAME"),
      String(value(row, "delete_rule", "DELETE_RULE")).toUpperCase()
    ];
    if (!expected || actual.some((part, index) => part !== expected[index])) {
      throw new Error(`Incompatible existing Customer import job FK: ${name}`);
    }
  }
  return true;
}

export async function up(connection) {
  if (await inspectCustomerImportJobSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_import_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      idempotency_key VARCHAR(128) NOT NULL,
      template_version VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_stored_name CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_sha256 BINARY(32) NOT NULL,
      source_storage_status VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      result_stored_name CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      result_sha256 BINARY(32) NULL,
      result_storage_status VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
      files_purged_at BIGINT UNSIGNED NULL,
      mode VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      activation_mode VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
      approver_user_id BIGINT UNSIGNED NULL,
      approval_setting_value TINYINT(1) NULL,
      approval_setting_version INT UNSIGNED NULL,
      status VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      total_count INT UNSIGNED NOT NULL DEFAULT 0,
      valid_count INT UNSIGNED NOT NULL DEFAULT 0,
      warning_count INT UNSIGNED NOT NULL DEFAULT 0,
      invalid_count INT UNSIGNED NOT NULL DEFAULT 0,
      success_count INT UNSIGNED NOT NULL DEFAULT 0,
      failed_count INT UNSIGNED NOT NULL DEFAULT 0,
      skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
      lease_owner VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      lease_until BIGINT UNSIGNED NULL,
      last_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      error_summary VARCHAR(500) NOT NULL DEFAULT '',
      created_by BIGINT UNSIGNED NULL,
      confirmed_by BIGINT UNSIGNED NULL,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      confirmed_at BIGINT UNSIGNED NULL,
      completed_at BIGINT UNSIGNED NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_import_actor_key (created_by,idempotency_key),
      UNIQUE KEY uq_customer_import_operation (operation_id),
      UNIQUE KEY uq_customer_import_source_name (source_stored_name),
      UNIQUE KEY uq_customer_import_result_name (result_stored_name),
      KEY idx_customer_import_status (status,created_at,id),
      KEY idx_customer_import_lease (lease_until,status),
      KEY idx_customer_import_actor (created_by,created_at,id),
      KEY idx_customer_import_source_recovery (source_storage_status,updated_at,id),
      KEY idx_customer_import_result_recovery (result_storage_status,updated_at,id),
      CONSTRAINT fk_customer_import_operation FOREIGN KEY (operation_id) REFERENCES customer_operation_requests (id) ON DELETE RESTRICT,
      CONSTRAINT fk_customer_import_approver FOREIGN KEY (approver_user_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_import_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_import_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await inspectCustomerImportJobSchema(connection);
}
