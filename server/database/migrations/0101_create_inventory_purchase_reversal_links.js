const TABLE = "inventory_purchase_reversal_links";
const COLUMNS = ["id", "original_movement_id", "reversal_movement_id", "operation_request_id", "quantity", "created_at"];
const INDEXES = new Set(["PRIMARY:0:id", "uq_purchase_reversal_movement:0:reversal_movement_id",
  "uq_purchase_reversal_operation:0:operation_request_id", "idx_purchase_reversal_original:1:original_movement_id,id"]);
const FOREIGN_KEYS = new Map([
  ["fk_purchase_reversal_original", "original_movement_id:inventory_movements:id"],
  ["fk_purchase_reversal_movement", "reversal_movement_id:inventory_movements:id"],
  ["fk_purchase_reversal_operation", "operation_request_id:inventory_operation_requests:id"]
]);
const TRIGGERS = new Map([["trg_purchase_reversal_links_update", "UPDATE"], ["trg_purchase_reversal_links_delete", "DELETE"]]);
const IMMUTABLE = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Inventory purchase reversal links are immutable'";
const canonical = sql => String(sql).replace(/[`\s]/gu, "").toLowerCase();
function incompatible(detail) { throw new Error(`Incompatible existing Inventory purchase reversal links: ${detail}`); }

async function inspect(connection) {
  const [columns] = await connection.query(`SELECT column_name AS column_name, column_type AS column_type,
    is_nullable AS is_nullable, column_default AS column_default, extra AS extra FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = '${TABLE}'`);
  if (columns.length === 0) return false;
  if (columns.length !== COLUMNS.length || new Set(columns.map(row => row.column_name)).size !== COLUMNS.length) incompatible("columns");
  for (const name of COLUMNS) {
    const row = columns.find(column => column.column_name === name);
    if (!row || String(row.column_type).toLowerCase() !== "bigint unsigned" || row.is_nullable !== "NO" ||
        row.column_default !== null || String(row.extra).toLowerCase() !== (name === "id" ? "auto_increment" : "")) incompatible(name);
  }
  const [tables] = await connection.query(`SELECT engine AS engine FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = '${TABLE}'`);
  if (tables[0]?.engine !== "InnoDB") incompatible("engine");
  const [indexes] = await connection.query(`SELECT index_name AS index_name, non_unique AS non_unique,
    seq_in_index AS seq_in_index, column_name AS column_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = '${TABLE}' ORDER BY index_name, seq_in_index`);
  const groups = new Map();
  for (const row of indexes) {
    const key = `${row.index_name}:${Number(row.non_unique)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const actual = new Set([...groups].map(([key, rows]) => `${key}:${rows.sort((a, b) =>
    Number(a.seq_in_index) - Number(b.seq_in_index)).map(row => row.column_name).join(",")}`));
  if (actual.size !== INDEXES.size || [...INDEXES].some(index => !actual.has(index))) incompatible("indexes");
  const [foreignKeys] = await connection.query(`SELECT k.constraint_name AS constraint_name, k.column_name AS column_name,
    k.referenced_table_name AS referenced_table_name, k.referenced_column_name AS referenced_column_name,
    (k.table_schema = k.referenced_table_schema) AS same_schema, r.delete_rule AS delete_rule, r.update_rule AS update_rule
    FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r
      ON r.constraint_schema = k.constraint_schema AND r.table_name = k.table_name AND r.constraint_name = k.constraint_name
    WHERE k.table_schema = DATABASE() AND k.table_name = '${TABLE}' ORDER BY k.constraint_name, k.ordinal_position`);
  if (foreignKeys.length !== FOREIGN_KEYS.size) incompatible("foreign keys");
  for (const [name, expected] of FOREIGN_KEYS) {
    const rows = foreignKeys.filter(row => row.constraint_name === name), row = rows[0];
    if (rows.length !== 1 || Number(row.same_schema) !== 1 || row.delete_rule !== "RESTRICT" || row.update_rule !== "RESTRICT" ||
        `${row.column_name}:${row.referenced_table_name}:${row.referenced_column_name}` !== expected) incompatible(`foreign key ${name}`);
  }
  const [checks] = await connection.query(`SELECT tc.constraint_name AS constraint_name, cc.check_clause AS check_clause,
    tc.enforced AS enforced FROM information_schema.check_constraints cc JOIN information_schema.table_constraints tc
      ON tc.constraint_schema = cc.constraint_schema AND tc.constraint_name = cc.constraint_name
    WHERE tc.constraint_schema = DATABASE() AND tc.table_name = '${TABLE}'`);
  if (checks.length !== 1 || checks[0].constraint_name !== "chk_purchase_reversal_quantity" || checks[0].enforced !== "YES" ||
      canonical(checks[0].check_clause).replace(/[()]/gu, "") !== "quantity>0") incompatible("quantity check");
  return true;
}

async function immutableTriggers(connection) {
  const [rows] = await connection.query(`SELECT trigger_name AS trigger_name, event_manipulation AS event_manipulation,
    action_timing AS action_timing, action_statement AS action_statement FROM information_schema.triggers
    WHERE trigger_schema = DATABASE() AND event_object_table = '${TABLE}'`);
  for (const row of rows) {
    if (!TRIGGERS.has(row.trigger_name) || row.event_manipulation !== TRIGGERS.get(row.trigger_name) ||
        row.action_timing !== "BEFORE" || canonical(row.action_statement) !== canonical(IMMUTABLE)) incompatible(`trigger ${row.trigger_name}`);
  }
  for (const [name, event] of TRIGGERS) {
    if (!rows.some(row => row.trigger_name === name)) {
      await connection.query(`CREATE TRIGGER ${name} BEFORE ${event} ON ${TABLE} FOR EACH ROW ${IMMUTABLE}`);
    }
  }
}

// Additive ledger only: generic full reversal and its unique key remain untouched.
export async function up(connection) {
  if (!await inspect(connection)) {
    await connection.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      original_movement_id BIGINT UNSIGNED NOT NULL,
      reversal_movement_id BIGINT UNSIGNED NOT NULL,
      operation_request_id BIGINT UNSIGNED NOT NULL,
      quantity BIGINT UNSIGNED NOT NULL,
      created_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_purchase_reversal_movement (reversal_movement_id),
      UNIQUE KEY uq_purchase_reversal_operation (operation_request_id),
      KEY idx_purchase_reversal_original (original_movement_id, id),
      CONSTRAINT chk_purchase_reversal_quantity CHECK (quantity > 0),
      CONSTRAINT fk_purchase_reversal_original FOREIGN KEY (original_movement_id)
        REFERENCES inventory_movements (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_purchase_reversal_movement FOREIGN KEY (reversal_movement_id)
        REFERENCES inventory_movements (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_purchase_reversal_operation FOREIGN KEY (operation_request_id)
        REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    if (!await inspect(connection)) incompatible("incomplete migration");
  }
  await immutableTriggers(connection);
}
