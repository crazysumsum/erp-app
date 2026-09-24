const COLUMNS = Object.freeze([
  "id", "customer_id", "display_name", "document_type", "sensitivity", "original_filename",
  "operation_id", "stored_name", "mime_type", "extension", "size_bytes", "sha256",
  "storage_class", "scan_status", "status", "sort_order", "notes", "version",
  "created_at", "updated_at", "created_by", "updated_by"
]);

const INDEXES = Object.freeze({
  PRIMARY: [true, "id"],
  uq_customer_attachment_operation: [true, "operation_id"],
  uq_customer_attachment_stored_name: [true, "stored_name"],
  idx_customer_attachment_owner: [false, "customer_id,sensitivity,status,sort_order,id"],
  idx_customer_attachment_recovery: [false, "status,updated_at,id"],
  idx_customer_attachment_hash: [false, "sha256,customer_id"]
});

const FOREIGN_KEYS = Object.freeze({
  fk_customer_attachment_customer: ["customer_id", "customers", "id", "CASCADE"],
  fk_customer_attachment_operation: ["operation_id", "customer_operation_requests", "id", "RESTRICT"],
  fk_customer_attachment_created_by: ["created_by", "users", "id", "SET NULL"],
  fk_customer_attachment_updated_by: ["updated_by", "users", "id", "SET NULL"]
});

function value(row, lower, upper) { return row[lower] ?? row[upper]; }

export async function inspectCustomerAttachmentSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_attachments' ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const names = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (names.length !== COLUMNS.length || COLUMNS.some((name, index) => names[index] !== name)) {
    throw new Error("Incompatible existing Customer attachment schema: customer_attachments");
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_attachments'
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
  for (const [name, [unique, columnsList]] of Object.entries(INDEXES)) {
    const found = indexes.get(name);
    if (!found || found.unique !== unique || found.columns.join(",") !== columnsList) {
      throw new Error(`Incompatible existing Customer attachment index: ${name}`);
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
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name = 'customer_attachments'`
  );
  if (foreignRows.length !== Object.keys(FOREIGN_KEYS).length) {
    throw new Error("Incompatible existing Customer attachment foreign keys");
  }
  for (const row of foreignRows) {
    const name = value(row, "constraint_name", "CONSTRAINT_NAME");
    const expected = FOREIGN_KEYS[name];
    const actual = [value(row, "column_name", "COLUMN_NAME"), value(row, "referenced_table_name", "REFERENCED_TABLE_NAME"), value(row, "referenced_column_name", "REFERENCED_COLUMN_NAME"), String(value(row, "delete_rule", "DELETE_RULE")).toUpperCase()];
    if (!expected || actual.some((part, index) => part !== expected[index])) {
      throw new Error(`Incompatible existing Customer attachment FK: ${name}`);
    }
  }
  return true;
}

export async function up(connection) {
  if (await inspectCustomerAttachmentSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      customer_id BIGINT UNSIGNED NOT NULL,
      display_name VARCHAR(190) NOT NULL,
      document_type VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      sensitivity VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      stored_name CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      mime_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      extension VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL,
      sha256 BINARY(32) NOT NULL,
      storage_class VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      scan_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'processing',
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      notes VARCHAR(500) NOT NULL DEFAULT '',
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_attachment_operation (operation_id),
      UNIQUE KEY uq_customer_attachment_stored_name (stored_name),
      KEY idx_customer_attachment_owner (customer_id, sensitivity,status,sort_order,id),
      KEY idx_customer_attachment_recovery (status,updated_at,id),
      KEY idx_customer_attachment_hash (sha256,customer_id),
      CONSTRAINT fk_customer_attachment_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_attachment_operation FOREIGN KEY (operation_id) REFERENCES customer_operation_requests (id) ON DELETE RESTRICT,
      CONSTRAINT fk_customer_attachment_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_attachment_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await inspectCustomerAttachmentSchema(connection);
}
