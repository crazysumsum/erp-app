const SYSTEM_ADMIN_ROLE = "system-admin";
const PERMISSIONS = [
  { name: "business_master.view", description: "查看貨幣、付款條款與變更歷史" },
  { name: "business_master.mgmt", description: "管理貨幣與付款條款主資料" }
];

const REQUIRED_COLUMNS = Object.freeze({
  currencies: ["code", "name", "decimal_places", "status", "version", "created_at", "created_by", "updated_at", "updated_by"],
  payment_terms: ["id", "code", "code_key", "name", "description", "calculation_type", "due_days", "status", "version", "created_at", "created_by", "updated_at", "updated_by"],
  business_master_audit_logs: ["id", "entity_type", "entity_key", "action", "result", "before_json", "after_json", "impact_json", "reason", "actor_user_id", "correlation_id", "idempotency_key_hash", "created_at"]
});

const COLUMN_SHAPES = Object.freeze({
  currencies: {
    code: ["char(3)", "NO", "ascii_bin"], name: ["varchar(100)", "NO"], decimal_places: ["tinyint unsigned", "NO"],
    status: ["varchar(20)", "NO", "ascii_bin"], version: ["int unsigned", "NO"], created_at: ["bigint unsigned", "NO"],
    created_by: ["bigint unsigned", "YES"], updated_at: ["bigint unsigned", "NO"], updated_by: ["bigint unsigned", "YES"]
  },
  payment_terms: {
    id: ["bigint unsigned", "NO"], code: ["varchar(50)", "NO"], code_key: ["varchar(50)", "NO", "utf8mb4_bin"],
    name: ["varchar(100)", "NO"], description: ["varchar(500)", "NO"], calculation_type: ["varchar(30)", "NO", "ascii_bin"],
    due_days: ["smallint unsigned", "YES"], status: ["varchar(20)", "NO", "ascii_bin"], version: ["int unsigned", "NO"],
    created_at: ["bigint unsigned", "NO"], created_by: ["bigint unsigned", "YES"], updated_at: ["bigint unsigned", "NO"], updated_by: ["bigint unsigned", "YES"]
  },
  business_master_audit_logs: {
    id: ["bigint unsigned", "NO"], entity_type: ["varchar(30)", "NO", "ascii_bin"], entity_key: ["varchar(80)", "NO"],
    action: ["varchar(50)", "NO", "ascii_bin"], result: ["varchar(20)", "NO", "ascii_bin"], before_json: ["json", "YES"], after_json: ["json", "YES"], impact_json: ["json", "YES"],
    reason: ["varchar(190)", "NO"], actor_user_id: ["bigint unsigned", "YES"], correlation_id: ["varchar(64)", "NO"],
    idempotency_key_hash: ["char(64)", "YES", "ascii_bin"], created_at: ["bigint unsigned", "NO"]
  }
});

const REQUIRED_INDEXES = Object.freeze({
  currencies: new Set(["PRIMARY:0:code", "idx_currencies_status_name_code:1:status,name,code"]),
  payment_terms: new Set(["PRIMARY:0:id", "uq_payment_terms_code_key:0:code_key", "idx_payment_terms_status_name_id:1:status,name,id"]),
  business_master_audit_logs: new Set([
    "PRIMARY:0:id",
    "idx_business_master_audit_entity:1:entity_type,entity_key,created_at,id",
    "idx_business_master_audit_actor:1:actor_user_id,created_at,id",
    "idx_business_master_audit_action:1:action,created_at,id"
  ])
});

export async function inspectBusinessMasterSchema(connection) {
  const [rows] = await connection.query(
    `SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type,
            is_nullable AS is_nullable, collation_name AS collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('currencies', 'payment_terms', 'business_master_audit_logs')
      ORDER BY table_name, ordinal_position`
  );
  const found = new Map();
  for (const row of rows) {
    const tableName = row.table_name;
    if (!found.has(tableName)) found.set(tableName, new Set());
    found.get(tableName).add(row.column_name);
  }
  for (const [tableName, columns] of found) {
    const required = REQUIRED_COLUMNS[tableName];
    if (!required || required.some((column) => !columns.has(column))) {
      throw new Error(`Incompatible existing Business Master schema: ${tableName}`);
    }
    for (const row of rows.filter((candidate) => candidate.table_name === tableName)) {
      const [columnType, nullable, collation] = COLUMN_SHAPES[tableName][row.column_name] ?? [];
      if (
        String(row.column_type).toLowerCase() !== columnType ||
        row.is_nullable !== nullable ||
        (collation && String(row.collation_name).toLowerCase() !== collation)
      ) {
        throw new Error(`Incompatible existing Business Master schema: ${tableName}.${row.column_name}`);
      }
    }
  }

  if (found.size > 0) {
    const [indexRows] = await connection.query(
      `SELECT table_name AS table_name, index_name AS index_name, non_unique AS non_unique,
              seq_in_index AS seq_in_index, column_name AS column_name
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name IN ('currencies', 'payment_terms', 'business_master_audit_logs')
        ORDER BY table_name, index_name, seq_in_index`
    );
    for (const tableName of found.keys()) {
      const grouped = new Map();
      for (const row of indexRows.filter((candidate) => candidate.table_name === tableName)) {
        const key = `${row.index_name}:${Number(row.non_unique)}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row.column_name);
      }
      const actual = new Set([...grouped].map(([key, columns]) => `${key}:${columns.join(",")}`));
      for (const expected of REQUIRED_INDEXES[tableName]) {
        if (!actual.has(expected)) throw new Error(`Incompatible existing Business Master schema index: ${tableName}.${expected}`);
      }
    }
  }
  return found;
}

async function ensureNamedRow(connection, { table, name, description, nowMs }) {
  const [existing] = await connection.query(`SELECT id FROM ${table} WHERE name = ?`, [name]);
  if (existing.length > 0) return Number(existing[0].id);
  const [result] = await connection.execute(
    `INSERT INTO ${table} (name, description, created_at) VALUES (?, ?, ?)`,
    [name, description, nowMs]
  );
  return Number(result.insertId);
}

async function seedPermissions(connection, nowMs) {
  const roleId = await ensureNamedRow(connection, {
    table: "roles",
    name: SYSTEM_ADMIN_ROLE,
    description: "System Admin",
    nowMs
  });
  for (const permission of PERMISSIONS) {
    const permissionId = await ensureNamedRow(connection, { table: "permissions", ...permission, nowMs });
    const [link] = await connection.query(
      "SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?",
      [roleId, permissionId]
    );
    if (link.length === 0) {
      await connection.execute(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        [roleId, permissionId]
      );
    }
  }
}

export async function up(connection) {
  const existingTables = await inspectBusinessMasterSchema(connection);
  if (existingTables.has("currencies")) {
    const [hkdRows] = await connection.query(
      "SELECT code, name, decimal_places, status, version FROM currencies WHERE code = ?",
      ["HKD"]
    );
    if (hkdRows.length > 0) {
      const hkd = hkdRows[0];
      if (hkd.code !== "HKD" || hkd.status !== "ACTIVE" || Number(hkd.decimal_places) !== 2) {
        throw new Error("Incompatible existing Business Master HKD seed");
      }
    }
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS currencies (
      code           CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name           VARCHAR(100) NOT NULL,
      decimal_places TINYINT UNSIGNED NOT NULL,
      status         VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version        INT UNSIGNED NOT NULL,
      created_at     BIGINT UNSIGNED NOT NULL,
      created_by     BIGINT UNSIGNED NULL,
      updated_at     BIGINT UNSIGNED NOT NULL,
      updated_by     BIGINT UNSIGNED NULL,
      PRIMARY KEY (code),
      KEY idx_currencies_status_name_code (status, name, code),
      CONSTRAINT fk_currencies_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_currencies_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS payment_terms (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code             VARCHAR(50) NOT NULL,
      code_key         VARCHAR(50) COLLATE utf8mb4_bin NOT NULL,
      name             VARCHAR(100) NOT NULL,
      description      VARCHAR(500) NOT NULL DEFAULT '',
      calculation_type VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      due_days         SMALLINT UNSIGNED NULL,
      status           VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version          INT UNSIGNED NOT NULL,
      created_at       BIGINT UNSIGNED NOT NULL,
      created_by       BIGINT UNSIGNED NULL,
      updated_at       BIGINT UNSIGNED NOT NULL,
      updated_by       BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_payment_terms_code_key (code_key),
      KEY idx_payment_terms_status_name_id (status, name, id),
      CONSTRAINT fk_payment_terms_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_payment_terms_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS business_master_audit_logs (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      entity_type          VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      entity_key           VARCHAR(80) NOT NULL,
      action               VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      result               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      before_json          JSON NULL,
      after_json           JSON NULL,
      impact_json          JSON NULL,
      reason               VARCHAR(190) NOT NULL DEFAULT '',
      actor_user_id        BIGINT UNSIGNED NULL,
      correlation_id       VARCHAR(64) NOT NULL DEFAULT '',
      idempotency_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      created_at           BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      KEY idx_business_master_audit_entity (entity_type, entity_key, created_at, id),
      KEY idx_business_master_audit_actor (actor_user_id, created_at, id),
      KEY idx_business_master_audit_action (action, created_at, id),
      CONSTRAINT fk_business_master_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `);

  const nowMs = Date.now();
  const [hkdRows] = await connection.query("SELECT code FROM currencies WHERE code = ?", ["HKD"]);
  if (hkdRows.length === 0) {
    await connection.execute(
      `INSERT INTO currencies
         (code, name, decimal_places, status, version, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      ["HKD", "Hong Kong Dollar", 2, "ACTIVE", 1, nowMs, nowMs]
    );
  }
  await seedPermissions(connection, nowMs);
}
