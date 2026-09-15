const REQUIRED_COLUMNS = Object.freeze({
  id: ["char(36)", "NO", "ascii_bin"],
  actor_user_id: ["bigint unsigned", "NO"],
  route_key: ["varchar(100)", "NO"],
  idempotency_key: ["varchar(128)", "NO"],
  payload_hash: ["binary(32)", "NO"],
  status: ["varchar(20)", "NO"],
  resource_type: ["varchar(40)", "NO"],
  resource_id: ["bigint unsigned", "YES"],
  result_version: ["int unsigned", "YES"],
  error_code: ["varchar(80)", "NO"],
  lease_owner: ["char(36)", "NO", "ascii_bin"],
  lease_until: ["bigint unsigned", "YES"],
  created_at: ["bigint unsigned", "NO"],
  updated_at: ["bigint unsigned", "NO"],
  completed_at: ["bigint unsigned", "YES"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:id",
  "uq_customer_operation_requests_idempotency:0:actor_user_id,route_key,idempotency_key",
  "idx_customer_operation_requests_lease:1:status,lease_until,id",
  "idx_customer_operation_requests_resource:1:resource_type,resource_id,id",
  "idx_customer_operation_requests_actor:1:actor_user_id,created_at,id"
]);

export async function inspectCustomerOperationRequestSchema(connection) {
  const [rows] = await connection.query(
    `SELECT column_name, column_type, is_nullable, collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_operation_requests'`
  );
  if (rows.length === 0) return false;

  const found = new Map(rows.map((row) => [row.column_name, row]));
  for (const [column, [type, nullable, collation]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(column);
    if (!row || String(row.column_type).toLowerCase() !== type || row.is_nullable !== nullable ||
        (collation && String(row.collation_name).toLowerCase() !== collation)) {
      throw new Error(`Incompatible existing Customer operation schema: customer_operation_requests.${column}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT index_name, non_unique, seq_in_index, column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_operation_requests'
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
      throw new Error(`Incompatible existing Customer operation index: customer_operation_requests.${expected}`);
    }
  }
  return true;
}

export async function up(connection) {
  await inspectCustomerOperationRequestSchema(connection);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_operation_requests (
      id              CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_user_id   BIGINT UNSIGNED NOT NULL,
      route_key       VARCHAR(100) NOT NULL,
      idempotency_key VARCHAR(128) NOT NULL,
      payload_hash    BINARY(32) NOT NULL,
      status          VARCHAR(20) NOT NULL,
      resource_type   VARCHAR(40) NOT NULL DEFAULT '',
      resource_id     BIGINT UNSIGNED NULL,
      result_version  INT UNSIGNED NULL,
      error_code      VARCHAR(80) NOT NULL DEFAULT '',
      lease_owner     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      lease_until     BIGINT UNSIGNED NULL,
      created_at      BIGINT UNSIGNED NOT NULL,
      updated_at      BIGINT UNSIGNED NOT NULL,
      completed_at    BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_operation_requests_idempotency (actor_user_id, route_key, idempotency_key),
      KEY idx_customer_operation_requests_lease (status, lease_until, id),
      KEY idx_customer_operation_requests_resource (resource_type, resource_id, id),
      KEY idx_customer_operation_requests_actor (actor_user_id, created_at, id),
      CONSTRAINT fk_customer_operation_requests_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
