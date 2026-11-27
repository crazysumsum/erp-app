// Additive indexes for global shipment event admission and reconciliation.
const INDEXES = [
  ["sales_audit_logs", "idx_sales_audit_event"],
  ["sales_order_status_history", "idx_sales_history_event"]
];

export async function up(connection) {
  const missing = [];
  for (const [table, name] of INDEXES) {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME AS column_name, SEQ_IN_INDEX AS seq_in_index, NON_UNIQUE AS non_unique,
              INDEX_TYPE AS index_type, SUB_PART AS sub_part, COLLATION AS collation, IS_VISIBLE AS is_visible
         FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
      [table, name]
    );
    if (rows.length === 0) {
      missing.push([table, name]);
      continue;
    }

    const [index] = rows;
    if (rows.length !== 1 || index.column_name !== "event_id" || Number(index.seq_in_index) !== 1 ||
        Number(index.non_unique) !== 1 || index.index_type !== "BTREE" || index.sub_part !== null ||
        index.collation !== "A" || index.is_visible !== "YES") {
      throw new Error(`Incompatible existing Sales event index: ${table}.${name}`);
    }
  }
  if (!missing.length) return;

  const [[{ previous }]] = await connection.query("SELECT @@SESSION.lock_wait_timeout AS previous");
  await connection.query("SET SESSION lock_wait_timeout = 10");
  try {
    // DDL commits separately. On retry, keep the already installed compatible index.
    for (const [table, name] of missing) {
      await connection.query(`ALTER TABLE ${table} ADD INDEX ${name} (event_id), ALGORITHM=INPLACE, LOCK=NONE`);
    }
  } finally {
    await connection.query("SET SESSION lock_wait_timeout = ?", [Number(previous)]);
  }
}
