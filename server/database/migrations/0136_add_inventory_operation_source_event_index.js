export async function up(connection) {
  const [indexes] = await connection.query(
    `SELECT column_name AS column_name, non_unique AS non_unique, sub_part AS sub_part,
            is_visible AS is_visible, index_type AS index_type
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'inventory_operation_requests'
        AND index_name = 'idx_inventory_operations_source_event'`
  );
  if (indexes.length) {
    const [index] = indexes;
    if (indexes.length !== 1 || index.column_name !== "source_event_id" || Number(index.non_unique) !== 1 ||
        index.sub_part !== null || index.is_visible !== "YES" || index.index_type !== "BTREE") {
      throw new Error("Incompatible existing index: inventory_operation_requests.idx_inventory_operations_source_event");
    }
    return;
  }

  // Online DDL still needs a metadata lock at the start and end.
  const [[{ previous }]] = await connection.query("SELECT @@SESSION.lock_wait_timeout AS previous");
  await connection.query("SET SESSION lock_wait_timeout = 10");
  try {
    await connection.query(
      `ALTER TABLE inventory_operation_requests
         ADD INDEX idx_inventory_operations_source_event (source_event_id), ALGORITHM=INPLACE, LOCK=NONE`
    );
  } finally {
    await connection.query("SET SESSION lock_wait_timeout = ?", [Number(previous)]);
  }
}
