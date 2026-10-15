// HD-011: forward-only prefix indexes; query rollback can retain these indexes.
const INDEXES = [
  ["customers", "idx_customers_search_phone", ["general_phone", "id"]],
  ["customers", "idx_customers_search_email", ["general_email", "id"]],
  ["customer_identifiers", "idx_customer_identifiers_search_value", ["status", "identifier_value_key", "customer_id"]],
  ...["name", "phone", "mobile"].map((field) => ["customer_contacts", `idx_customer_contacts_search_${field}`, ["status", field, "customer_id"]]),
  ...["label", "address_line1", "city", "postal_code"].map((field) => ["customer_addresses", `idx_customer_addresses_search_${field}`, ["status", field, "customer_id"]])
];

export async function up(connection, { lockWaitSeconds = 10 } = {}) {
  if (!Number.isSafeInteger(lockWaitSeconds) || lockWaitSeconds < 1 || lockWaitSeconds > 60) throw new TypeError("lockWaitSeconds must be between 1 and 60");
  const [rows] = await connection.query(
    `SELECT table_name AS table_name, index_name AS index_name, column_name AS column_name,
            seq_in_index AS seq_in_index, non_unique AS non_unique, index_type AS index_type,
            sub_part AS sub_part, collation AS collation, is_visible AS is_visible
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name IN (?) AND index_name IN (?)
      ORDER BY table_name, index_name, seq_in_index`,
    [[...new Set(INDEXES.map(([table]) => table))], INDEXES.map(([, name]) => name)]
  );
  const missing = new Map();
  for (const [table, name, columns] of INDEXES) {
    const existing = rows.filter((row) => row.table_name === table && row.index_name === name);
    if (existing.length) {
      if (existing.length !== columns.length || existing.some((row, index) =>
        row.column_name !== columns[index] || Number(row.seq_in_index) !== index + 1 ||
        Number(row.non_unique) !== 1 || row.index_type !== "BTREE" || row.sub_part !== null || row.collation !== "A" || row.is_visible !== "YES")) {
        throw new Error(`Incompatible existing Customer search index: ${table}.${name}`);
      }
    } else {
      if (!missing.has(table)) missing.set(table, []);
      missing.get(table).push(`ADD INDEX ${name} (${columns.join(", ")})`);
    }
  }
  if (missing.size === 0) return;
  const [[{ previous }]] = await connection.query("SELECT @@SESSION.lock_wait_timeout AS previous");
  await connection.query("SET SESSION lock_wait_timeout = ?", [lockWaitSeconds]);
  try {
    for (const [table, additions] of missing) {
      await connection.query(`ALTER TABLE ${table} ${additions.join(", ")}, ALGORITHM=INPLACE, LOCK=NONE`);
    }
  } catch (error) {
    if ((error?.cause?.code ?? error?.code) === "ER_LOCK_WAIT_TIMEOUT") throw new Error(`Waited ${lockWaitSeconds}s for the metadata lock on Customer search tables; finish long transactions and rerun`);
    throw error;
  } finally {
    await connection.query("SET SESSION lock_wait_timeout = ?", [Number(previous)]);
  }
}
