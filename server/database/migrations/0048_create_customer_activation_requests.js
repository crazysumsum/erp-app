const COLUMNS = Object.freeze([
  "id", "customer_id", "requested_by", "assigned_approver_id", "customer_version",
  "critical_snapshot_hash", "summary", "approval_setting_value", "approval_setting_version",
  "status", "pending_slot", "request_note", "decision_reason", "requested_at", "decided_at",
  "decided_by", "version"
]);
const INDEXES = new Set([
  "PRIMARY", "uq_customer_activation_pending", "idx_customer_activation_approver", "idx_customer_activation_customer"
]);
const FOREIGN_KEYS = new Set([
  "fk_customer_activation_customer", "fk_customer_activation_requested_by",
  "fk_customer_activation_approver", "fk_customer_activation_decided_by"
]);

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

export async function inspectCustomerActivationRequestSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name, extra AS extra
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_activation_requests'
      ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name) => !actual.includes(name))) {
    throw new Error("Incompatible existing Customer activation request schema: customer_activation_requests");
  }
  const slot = columns.find((row) => value(row, "column_name", "COLUMN_NAME") === "pending_slot");
  if (!String(value(slot, "extra", "EXTRA") ?? "").toUpperCase().includes("GENERATED")) {
    throw new Error("Incompatible existing Customer activation request column: pending_slot is not a generated column");
  }
  const [indexes] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_activation_requests'`
  );
  const actualIndexes = new Set(indexes.map((row) => value(row, "index_name", "INDEX_NAME")));
  for (const name of INDEXES) {
    if (!actualIndexes.has(name)) throw new Error(`Incompatible existing Customer activation request index: ${name}`);
  }
  const [pendingSlotIndex] = await connection.query(
    `SELECT non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_activation_requests'
        AND index_name = 'uq_customer_activation_pending'
      ORDER BY seq_in_index`
  );
  const slotColumns = pendingSlotIndex.map((row) => value(row, "column_name", "COLUMN_NAME"));
  const slotUnique = pendingSlotIndex.every((row) => Number(value(row, "non_unique", "NON_UNIQUE")) === 0);
  if (!slotUnique || slotColumns.join(",") !== "customer_id,pending_slot") {
    throw new Error("Incompatible existing Customer activation request index: uq_customer_activation_pending must be UNIQUE (customer_id, pending_slot)");
  }
  const [foreignKeys] = await connection.query(
    `SELECT constraint_name AS constraint_name
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'customer_activation_requests'`
  );
  const actualForeignKeys = new Set(foreignKeys.map((row) => value(row, "constraint_name", "CONSTRAINT_NAME")));
  for (const name of FOREIGN_KEYS) {
    if (!actualForeignKeys.has(name)) throw new Error(`Incompatible existing Customer activation request FK: ${name}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectCustomerActivationRequestSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_activation_requests (
      id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      customer_id              BIGINT UNSIGNED NOT NULL,
      requested_by             BIGINT UNSIGNED NULL,
      assigned_approver_id     BIGINT UNSIGNED NULL,
      customer_version         INT UNSIGNED NOT NULL,
      critical_snapshot_hash   BINARY(32) NOT NULL,
      summary                  JSON NOT NULL,
      approval_setting_value   TINYINT(1) NOT NULL,
      approval_setting_version INT UNSIGNED NOT NULL,
      status                   VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
      pending_slot             TINYINT GENERATED ALWAYS AS (IF(status = 'pending', 1, NULL)) STORED,
      request_note             VARCHAR(500) NOT NULL DEFAULT '',
      decision_reason          VARCHAR(500) NOT NULL DEFAULT '',
      requested_at             BIGINT UNSIGNED NOT NULL,
      decided_at               BIGINT UNSIGNED NULL,
      decided_by               BIGINT UNSIGNED NULL,
      version                  INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_activation_pending (customer_id, pending_slot),
      KEY idx_customer_activation_approver (assigned_approver_id, status, requested_at, id),
      KEY idx_customer_activation_customer (customer_id, requested_at, id),
      CONSTRAINT fk_customer_activation_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_customer_activation_requested_by FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_activation_approver FOREIGN KEY (assigned_approver_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_activation_decided_by FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectCustomerActivationRequestSchema(connection);
}
