const REQUIRED_COLUMNS = [
  "id", "occurred_at", "actor_user_id", "actor_username", "action", "target_type",
  "target_id", "supplier_id", "target_label", "reason", "detail", "request_id", "ip"
];

const REQUIRED_INDEXES = new Set([
  "PRIMARY",
  "idx_supplier_audit_time",
  "idx_supplier_audit_supplier",
  "idx_supplier_audit_target",
  "idx_supplier_audit_actor",
  "idx_supplier_audit_action"
]);

export async function inspectSupplierAuditSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_audit_logs'
      ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const names = columns.map((row) => row.column_name ?? row.COLUMN_NAME);
  if (names.length !== REQUIRED_COLUMNS.length || REQUIRED_COLUMNS.some((name) => !names.includes(name))) {
    throw new Error("Incompatible existing Supplier schema: supplier_audit_logs");
  }
  const [indexes] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_audit_logs'`
  );
  const indexNames = new Set(indexes.map((row) => row.index_name ?? row.INDEX_NAME));
  for (const name of REQUIRED_INDEXES) {
    if (!indexNames.has(name)) throw new Error(`Incompatible existing Supplier audit index: ${name}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectSupplierAuditSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_audit_logs (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      occurred_at    BIGINT UNSIGNED NOT NULL,
      actor_user_id  BIGINT UNSIGNED NULL,
      actor_username VARCHAR(190) NOT NULL,
      action         VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_type    VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_id      BIGINT UNSIGNED NULL,
      supplier_id    BIGINT UNSIGNED NULL,
      target_label   VARCHAR(190) NOT NULL,
      reason         VARCHAR(500) NOT NULL DEFAULT '',
      detail         JSON NULL,
      request_id     VARCHAR(64) NOT NULL DEFAULT '',
      ip             VARCHAR(45) NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      KEY idx_supplier_audit_time (occurred_at, id),
      KEY idx_supplier_audit_supplier (supplier_id, occurred_at, id),
      KEY idx_supplier_audit_target (target_type, target_id, occurred_at),
      KEY idx_supplier_audit_actor (actor_user_id, occurred_at),
      KEY idx_supplier_audit_action (action, occurred_at),
      CONSTRAINT fk_supplier_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSupplierAuditSchema(connection);
}
