const COLUMNS = Object.freeze([
  "id", "supplier_id", "requested_by", "assigned_approver_id", "supplier_version", "summary",
  "status", "pending_slot", "request_note", "decision_reason", "requested_at", "decided_at",
  "decided_by", "version"
]);
const INDEXES = new Set([
  "PRIMARY", "uq_supplier_activation_pending", "idx_supplier_activation_approver", "idx_supplier_activation_supplier"
]);
const FOREIGN_KEYS = new Set([
  "fk_supplier_activation_supplier", "fk_supplier_activation_requested_by",
  "fk_supplier_activation_approver", "fk_supplier_activation_decided_by"
]);

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

export async function inspectSupplierActivationRequestSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests'
      ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name) => !actual.includes(name))) {
    throw new Error("Incompatible existing Supplier activation request schema: supplier_activation_requests");
  }

  const [indexes] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests'`
  );
  const actualIndexes = new Set(indexes.map((row) => value(row, "index_name", "INDEX_NAME")));
  for (const name of INDEXES) {
    if (!actualIndexes.has(name)) throw new Error(`Incompatible existing Supplier activation request index: ${name}`);
  }

  const [foreignKeys] = await connection.query(
    `SELECT constraint_name AS constraint_name
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'supplier_activation_requests'`
  );
  const actualForeignKeys = new Set(foreignKeys.map((row) => value(row, "constraint_name", "CONSTRAINT_NAME")));
  for (const name of FOREIGN_KEYS) {
    if (!actualForeignKeys.has(name)) throw new Error(`Incompatible existing Supplier activation request FK: ${name}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectSupplierActivationRequestSchema(connection)) return;
  // pending_slot is the database-level guarantee of at most one pending request per
  // Supplier. MySQL has no partial index, so the slot is NULL for every non-pending
  // row and a UNIQUE index does not compare NULLs — unlimited history, one pending.
  // Same emulation as primary_slot in 0032 and 0033.
  //
  // supplier_id is RESTRICT, not CASCADE: design 5.9 states approval history counts
  // as a reference, so a Supplier that has ever been submitted cannot be hard-deleted.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_activation_requests (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      supplier_id          BIGINT UNSIGNED NOT NULL,
      requested_by         BIGINT UNSIGNED NULL,
      assigned_approver_id BIGINT UNSIGNED NULL,
      supplier_version     INT UNSIGNED NOT NULL,
      summary              JSON NOT NULL,
      status               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
      pending_slot         TINYINT GENERATED ALWAYS AS (IF(status = 'pending', 1, NULL)) STORED,
      request_note         VARCHAR(500) NOT NULL DEFAULT '',
      decision_reason      VARCHAR(500) NOT NULL DEFAULT '',
      requested_at         BIGINT UNSIGNED NOT NULL,
      decided_at           BIGINT UNSIGNED NULL,
      decided_by           BIGINT UNSIGNED NULL,
      version              INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_activation_pending (supplier_id, pending_slot),
      KEY idx_supplier_activation_approver (assigned_approver_id, status, requested_at),
      KEY idx_supplier_activation_supplier (supplier_id, requested_at),
      CONSTRAINT fk_supplier_activation_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_supplier_activation_requested_by FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_activation_approver FOREIGN KEY (assigned_approver_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_activation_decided_by FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSupplierActivationRequestSchema(connection);
}
