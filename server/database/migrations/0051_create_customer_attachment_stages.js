const COLUMNS = ["operation_id", "stored_name", "created_at", "updated_at"];

export async function inspectCustomerAttachmentStageSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_attachment_stages' ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  if (columns.map((row) => row.column_name ?? row.COLUMN_NAME).join(",") !== COLUMNS.join(",")) {
    throw new Error("Incompatible existing Customer attachment stage schema");
  }
  const [indexes] = await connection.query(
    `SELECT index_name,non_unique,column_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'customer_attachment_stages' ORDER BY index_name,seq_in_index`
  );
  const actual = indexes.map((row) => `${row.index_name ?? row.INDEX_NAME}:${Number(row.non_unique ?? row.NON_UNIQUE)}:${row.column_name ?? row.COLUMN_NAME}`);
  for (const expected of ["PRIMARY:0:operation_id", "uq_customer_attachment_stage_name:0:stored_name"]) {
    if (!actual.includes(expected)) throw new Error(`Incompatible existing Customer attachment stage index: ${expected}`);
  }
  const recovery = indexes.filter((row) => (row.index_name ?? row.INDEX_NAME) === "idx_customer_attachment_stage_recovery");
  if (recovery.length !== 2 || recovery.some((row) => Number(row.non_unique ?? row.NON_UNIQUE) !== 1) ||
      recovery.map((row) => row.column_name ?? row.COLUMN_NAME).join(",") !== "updated_at,operation_id") {
    throw new Error("Incompatible existing Customer attachment stage index: idx_customer_attachment_stage_recovery");
  }
  const [foreignKeys] = await connection.query(
    `SELECT rc.constraint_name,rc.delete_rule,kcu.column_name,rc.referenced_table_name,kcu.referenced_column_name
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = rc.constraint_schema AND kcu.table_name = rc.table_name AND kcu.constraint_name = rc.constraint_name
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name = 'customer_attachment_stages'`
  );
  const fk = foreignKeys[0];
  if (foreignKeys.length !== 1 || (fk.constraint_name ?? fk.CONSTRAINT_NAME) !== "fk_customer_attachment_stage_operation" ||
      (fk.column_name ?? fk.COLUMN_NAME) !== "operation_id" || (fk.referenced_table_name ?? fk.REFERENCED_TABLE_NAME) !== "customer_operation_requests" ||
      (fk.referenced_column_name ?? fk.REFERENCED_COLUMN_NAME) !== "id" || String(fk.delete_rule ?? fk.DELETE_RULE).toUpperCase() !== "CASCADE") {
    throw new Error("Incompatible existing Customer attachment stage foreign key");
  }
  return true;
}

export async function up(connection) {
  if (await inspectCustomerAttachmentStageSchema(connection)) return;
  await connection.query(`
    CREATE TABLE customer_attachment_stages (
      operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      stored_name CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (operation_id),
      UNIQUE KEY uq_customer_attachment_stage_name (stored_name),
      KEY idx_customer_attachment_stage_recovery (updated_at,operation_id),
      CONSTRAINT fk_customer_attachment_stage_operation FOREIGN KEY (operation_id)
        REFERENCES customer_operation_requests (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await inspectCustomerAttachmentStageSchema(connection);
}
