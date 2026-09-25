const REQUIRED_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  command_type: ["varchar(50)", "NO", "ascii_bin"],
  source_module: ["varchar(40)", "NO", "ascii_bin"],
  source_document_type: ["varchar(50)", "NO", "ascii_bin"],
  source_document_id: ["varchar(100)", "NO", "utf8mb4_bin"],
  source_line_id: ["varchar(100)", "NO", "utf8mb4_bin"],
  source_event_id: ["varchar(100)", "NO", "utf8mb4_bin"],
  request_hash: ["char(64)", "NO", "ascii_bin"],
  result_type: ["varchar(40)", "YES", "ascii_bin"],
  result_id: ["varchar(100)", "YES", "utf8mb4_bin"],
  result_summary: ["json", "YES"],
  completed_at: ["bigint unsigned", "YES"],
  actor_user_id: ["bigint unsigned", "YES"],
  actor_label: ["varchar(190)", "NO"],
  request_id: ["varchar(64)", "NO", "ascii_bin"],
  correlation_id: ["varchar(64)", "NO", "ascii_bin"],
  created_at: ["bigint unsigned", "NO"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:id",
  "uq_inventory_source_operation:0:source_module,source_document_type,source_document_id,source_line_id,source_event_id",
  "idx_inventory_operations_source:1:source_module,source_document_type,source_document_id,source_line_id,id",
  "idx_inventory_operations_created:1:created_at,id"
]);

export async function inspectInventoryOperationSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable, collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'inventory_operation_requests'`
  );
  if (columns.length === 0) return false;

  const found = new Map(columns.map((row) => [row.column_name, row]));
  if (found.size !== Object.keys(REQUIRED_COLUMNS).length) {
    throw new Error("Incompatible existing Inventory operation schema: unexpected columns");
  }
  for (const [column, [type, nullable, collation]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(column);
    if (!row || String(row.column_type).toLowerCase() !== type || row.is_nullable !== nullable ||
        (collation && String(row.collation_name).toLowerCase() !== collation)) {
      throw new Error(`Incompatible existing Inventory operation schema: inventory_operation_requests.${column}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'inventory_operation_requests'
      ORDER BY index_name, seq_in_index`
  );
  const grouped = new Map();
  for (const row of indexRows) {
    const key = `${row.index_name}:${Number(row.non_unique)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row.column_name);
  }
  const actual = new Set([...grouped].map(([key, names]) => `${key}:${names.join(",")}`));
  for (const expected of REQUIRED_INDEXES) {
    if (!actual.has(expected)) {
      throw new Error(`Incompatible existing Inventory operation index: ${expected}`);
    }
  }

  const [foreignKeys] = await connection.query(
    `SELECT referenced_table_name AS referenced_table_name, delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name = 'inventory_operation_requests'
        AND constraint_name = 'fk_inventory_operations_actor'`
  );
  if (foreignKeys.length !== 1 || foreignKeys[0].referenced_table_name !== "users" ||
      foreignKeys[0].delete_rule !== "SET NULL") {
    throw new Error("Incompatible existing Inventory operation foreign key: fk_inventory_operations_actor");
  }
  return true;
}

export async function up(connection) {
  if (await inspectInventoryOperationSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_operation_requests (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      command_type         VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_module        VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_document_type VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_document_id   VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
      source_line_id       VARCHAR(100) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
      source_event_id      VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
      request_hash         CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      result_type          VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
      result_id            VARCHAR(100) COLLATE utf8mb4_bin NULL,
      result_summary       JSON NULL,
      completed_at         BIGINT UNSIGNED NULL,
      actor_user_id        BIGINT UNSIGNED NULL,
      actor_label          VARCHAR(190) NOT NULL,
      request_id           VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      correlation_id       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      created_at           BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_source_operation (
        source_module, source_document_type, source_document_id, source_line_id, source_event_id
      ),
      KEY idx_inventory_operations_source (
        source_module, source_document_type, source_document_id, source_line_id, id
      ),
      KEY idx_inventory_operations_created (created_at, id),
      CONSTRAINT fk_inventory_operations_actor FOREIGN KEY (actor_user_id)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await inspectInventoryOperationSchema(connection);
}
