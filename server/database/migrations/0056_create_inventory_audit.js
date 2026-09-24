const REQUIRED_COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO"],
  occurred_at: ["bigint unsigned", "NO"],
  actor_user_id: ["bigint unsigned", "YES"],
  actor_label: ["varchar(190)", "NO"],
  action: ["varchar(80)", "NO", "ascii_bin"],
  target_type: ["varchar(40)", "NO", "ascii_bin"],
  target_id: ["bigint unsigned", "YES"],
  target_label: ["varchar(190)", "NO"],
  outcome: ["varchar(20)", "NO", "ascii_bin"],
  reason_category: ["varchar(40)", "NO", "ascii_bin"],
  reason_text: ["varchar(500)", "NO"],
  before_summary: ["json", "YES"],
  after_summary: ["json", "YES"],
  operation_request_id: ["bigint unsigned", "YES"],
  request_id: ["varchar(64)", "NO", "ascii_bin"],
  correlation_id: ["varchar(64)", "NO", "ascii_bin"],
  ip: ["varchar(45)", "NO", "ascii_bin"]
});

const REQUIRED_INDEXES = new Set([
  "PRIMARY:0:id",
  "idx_inventory_audit_time:1:occurred_at,id",
  "idx_inventory_audit_target:1:target_type,target_id,occurred_at,id",
  "idx_inventory_audit_actor:1:actor_user_id,occurred_at,id",
  "idx_inventory_audit_operation:1:operation_request_id,id"
]);

const TRIGGERS = Object.freeze([
  ["trg_inventory_audit_immutable_update", "UPDATE"],
  ["trg_inventory_audit_immutable_delete", "DELETE"]
]);

export async function inspectInventoryAuditSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable, collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'inventory_audit_logs'`
  );
  if (columns.length === 0) return false;

  const found = new Map(columns.map((row) => [row.column_name, row]));
  if (found.size !== Object.keys(REQUIRED_COLUMNS).length) {
    throw new Error("Incompatible existing Inventory audit schema: unexpected columns");
  }
  for (const [column, [type, nullable, collation]] of Object.entries(REQUIRED_COLUMNS)) {
    const row = found.get(column);
    if (!row || String(row.column_type).toLowerCase() !== type || row.is_nullable !== nullable ||
        (collation && String(row.collation_name).toLowerCase() !== collation)) {
      throw new Error(`Incompatible existing Inventory audit schema: inventory_audit_logs.${column}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique,
            seq_in_index AS seq_in_index, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'inventory_audit_logs'
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
      throw new Error(`Incompatible existing Inventory audit index: ${expected}`);
    }
  }

  const [foreignKeys] = await connection.query(
    `SELECT constraint_name AS constraint_name,
            referenced_table_name AS referenced_table_name,
            delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'inventory_audit_logs'`
  );
  const rules = new Map(foreignKeys.map((row) => [
    row.constraint_name,
    `${row.referenced_table_name}:${row.delete_rule}`
  ]));
  if (rules.get("fk_inventory_audit_actor") !== "users:SET NULL" ||
      rules.get("fk_inventory_audit_operation") !== "inventory_operation_requests:RESTRICT") {
    throw new Error("Incompatible existing Inventory audit foreign keys");
  }

  const [checks] = await connection.query(
    `SELECT cc.check_clause AS check_clause
       FROM information_schema.check_constraints cc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = cc.constraint_schema
        AND tc.constraint_name = cc.constraint_name
      WHERE tc.constraint_schema = DATABASE()
        AND tc.table_name = 'inventory_audit_logs'
        AND tc.constraint_name = 'chk_inventory_audit_outcome'`
  );
  const outcomeCheck = String(checks[0]?.check_clause ?? "").toUpperCase();
  if (!["OUTCOME", "SUCCEEDED", "REJECTED", "FAILED"].every((value) => outcomeCheck.includes(value))) {
    throw new Error("Incompatible existing Inventory audit check: chk_inventory_audit_outcome");
  }
  return true;
}

async function ensureImmutableTriggers(connection) {
  const [rows] = await connection.query(
    `SELECT trigger_name AS trigger_name, event_manipulation AS event_manipulation,
            action_timing AS action_timing, action_statement AS action_statement
       FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND event_object_table = 'inventory_audit_logs'`
  );
  const found = new Map(rows.map((row) => [row.trigger_name, row]));
  for (const [name, event] of TRIGGERS) {
    const trigger = found.get(name);
    if (trigger) {
      const statement = String(trigger.action_statement).toLowerCase();
      if (trigger.event_manipulation !== event || trigger.action_timing !== "BEFORE" ||
          !statement.includes("signal sqlstate '45000'") || !statement.includes("immutable")) {
        throw new Error(`Incompatible existing Inventory audit trigger: ${name}`);
      }
      continue;
    }
    await connection.query(`
      CREATE TRIGGER ${name}
      BEFORE ${event} ON inventory_audit_logs
      FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inventory_audit_logs is immutable'
    `);
  }
}

export async function up(connection) {
  if (!(await inspectInventoryAuditSchema(connection))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_audit_logs (
        id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        occurred_at          BIGINT UNSIGNED NOT NULL,
        actor_user_id        BIGINT UNSIGNED NULL,
        actor_label          VARCHAR(190) NOT NULL,
        action               VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        target_type          VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        target_id            BIGINT UNSIGNED NULL,
        target_label         VARCHAR(190) NOT NULL,
        outcome              VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        reason_category      VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
        reason_text          VARCHAR(500) NOT NULL DEFAULT '',
        before_summary       JSON NULL,
        after_summary        JSON NULL,
        operation_request_id BIGINT UNSIGNED NULL,
        request_id           VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
        correlation_id       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
        ip                   VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        KEY idx_inventory_audit_time (occurred_at, id),
        KEY idx_inventory_audit_target (target_type, target_id, occurred_at, id),
        KEY idx_inventory_audit_actor (actor_user_id, occurred_at, id),
        KEY idx_inventory_audit_operation (operation_request_id, id),
        CONSTRAINT chk_inventory_audit_outcome
          CHECK (outcome IN ('SUCCEEDED', 'REJECTED', 'FAILED')),
        CONSTRAINT fk_inventory_audit_actor FOREIGN KEY (actor_user_id)
          REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_inventory_audit_operation FOREIGN KEY (operation_request_id)
          REFERENCES inventory_operation_requests (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await inspectInventoryAuditSchema(connection);
  }
  await ensureImmutableTriggers(connection);
}
