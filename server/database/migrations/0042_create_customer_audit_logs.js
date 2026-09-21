const REQUIRED_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  occurred_at: ["bigint unsigned", "NO"],
  actor_user_id: ["bigint unsigned", "YES"],
  actor_username: ["varchar(190)", "NO"],
  action: ["varchar(80)", "NO"],
  target_type: ["varchar(30)", "NO"],
  target_id: ["bigint unsigned", "YES"],
  customer_id: ["bigint unsigned", "YES"],
  target_label: ["varchar(190)", "NO"],
  reason: ["varchar(500)", "NO"],
  detail: ["json", "YES"],
  request_id: ["varchar(64)", "NO"],
  ip: ["varchar(45)", "NO"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:id",
  "idx_customer_audit_logs_time:1:occurred_at,id",
  "idx_customer_audit_logs_customer:1:customer_id,occurred_at,id",
  "idx_customer_audit_logs_target:1:target_type,target_id,occurred_at,id",
  "idx_customer_audit_logs_actor:1:actor_user_id,occurred_at,id",
  "idx_customer_audit_logs_action:1:action,occurred_at,id"
]);

export async function inspectCustomerAuditSchema(connection) {
  const [rows] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable, collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_audit_logs'
      ORDER BY ordinal_position`
  );
  if (rows.length === 0) return false;

  const found = new Map(rows.map((row) => [row.column_name, row]));
  for (const [column, [columnType, nullable]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(column);
    if (!row || String(row.column_type).toLowerCase() !== columnType || row.is_nullable !== nullable) {
      throw new Error(`Incompatible existing Customer audit schema: customer_audit_logs.${column}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_audit_logs'
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
    if (!actual.has(expected)) {
      throw new Error(`Incompatible existing Customer audit index: customer_audit_logs.${expected}`);
    }
  }

  return true;
}

export async function up(connection) {
  await inspectCustomerAuditSchema(connection);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_audit_logs (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      occurred_at    BIGINT UNSIGNED NOT NULL,
      actor_user_id  BIGINT UNSIGNED NULL,
      actor_username VARCHAR(190) NOT NULL,
      action         VARCHAR(80) NOT NULL,
      target_type    VARCHAR(30) NOT NULL,
      target_id      BIGINT UNSIGNED NULL,
      customer_id    BIGINT UNSIGNED NULL,
      target_label   VARCHAR(190) NOT NULL,
      reason         VARCHAR(500) NOT NULL DEFAULT '',
      detail         JSON NULL,
      request_id     VARCHAR(64) NOT NULL DEFAULT '',
      ip             VARCHAR(45) NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      KEY idx_customer_audit_logs_time (occurred_at, id),
      KEY idx_customer_audit_logs_customer (customer_id, occurred_at, id),
      KEY idx_customer_audit_logs_target (target_type, target_id, occurred_at, id),
      KEY idx_customer_audit_logs_actor (actor_user_id, occurred_at, id),
      KEY idx_customer_audit_logs_action (action, occurred_at, id),
      CONSTRAINT fk_customer_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
