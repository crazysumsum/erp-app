/**
 * Supplier import job（設計 §5.13，SUP-M06；T42，Product Owner 按 T42 schema 方案批准）。
 *
 * 同 0037 一樣逐項驗晒欄位、索引、FK 同 trigger：設計 §5.14 要求「table 已存在」唔可以
 * 當成功，要核對 contract，唔啱就 fail closed。
 *
 * 刻意冇 Customer 嗰幾個欄位（idempotency_key、operation_id、*_storage_status）：upload
 * 用 framework 嘅 route idempotency，同 Supplier create 一樣；T43 證實需要先再開 migration。
 */
const COLUMN_CONTRACT = Object.freeze({
  id:                       { type: "bigint unsigned", nullable: false, default: null, autoIncrement: true },
  template_version:         { type: "varchar(20)", nullable: false, default: null, collation: "ascii_bin" },
  source_stored_name:       { type: "char(64)", nullable: false, default: null, collation: "ascii_bin" },
  source_sha256:            { type: "binary(32)", nullable: false, default: null },
  result_stored_name:       { type: "char(64)", nullable: true, default: null, collation: "ascii_bin" },
  result_sha256:            { type: "binary(32)", nullable: true, default: null },
  files_purged_at:          { type: "bigint unsigned", nullable: true, default: null },
  mode:                     { type: "varchar(20)", nullable: false, default: null, collation: "ascii_bin" },
  activation_mode:          { type: "varchar(20)", nullable: true, default: null, collation: "ascii_bin" },
  approver_user_id:         { type: "bigint unsigned", nullable: true, default: null },
  approval_setting_value:   { type: "tinyint(1)", nullable: true, default: null },
  approval_setting_version: { type: "int unsigned", nullable: true, default: null },
  status:                   { type: "varchar(30)", nullable: false, default: null, collation: "ascii_bin" },
  total_count:              { type: "int unsigned", nullable: false, default: "0" },
  valid_count:              { type: "int unsigned", nullable: false, default: "0" },
  warning_count:            { type: "int unsigned", nullable: false, default: "0" },
  invalid_count:            { type: "int unsigned", nullable: false, default: "0" },
  applied_count:            { type: "int unsigned", nullable: false, default: "0" },
  failed_count:             { type: "int unsigned", nullable: false, default: "0" },
  skipped_count:            { type: "int unsigned", nullable: false, default: "0" },
  last_error_code:          { type: "varchar(80)", nullable: false, default: "", collation: "ascii_bin" },
  error_summary:            { type: "varchar(500)", nullable: false, default: "", charset: "utf8mb4" },
  lease_owner:              { type: "varchar(100)", nullable: false, default: "", collation: "ascii_bin" },
  lease_until:              { type: "bigint unsigned", nullable: true, default: null },
  created_by:               { type: "bigint unsigned", nullable: true, default: null },
  confirmed_by:             { type: "bigint unsigned", nullable: true, default: null },
  created_at:               { type: "bigint unsigned", nullable: false, default: null },
  updated_at:               { type: "bigint unsigned", nullable: false, default: null },
  confirmed_at:             { type: "bigint unsigned", nullable: true, default: null },
  completed_at:             { type: "bigint unsigned", nullable: true, default: null },
  version:                  { type: "int unsigned", nullable: false, default: "1" }
});

// [unique, 覆蓋欄位]。檔名 UNIQUE：同一個檔唔可以俾兩個 job 用，亦係 T41 名嘅碰撞保險。
const INDEXES = Object.freeze({
  PRIMARY: [true, "id"],
  uq_supplier_import_source_name: [true, "source_stored_name"],
  uq_supplier_import_result_name: [true, "result_stored_name"],
  idx_supplier_import_status: [false, "status,created_at,id"],
  idx_supplier_import_lease: [false, "lease_until,status"],
  idx_supplier_import_actor: [false, "created_by,created_at,id"]
});

// 操作者一律 SET NULL：刪咗 user，Job 同佢嘅結果證據照留（設計 §12.5：至少 7 年）。
const FOREIGN_KEYS = Object.freeze({
  fk_supplier_import_approver: { column: "approver_user_id", table: "users", onDelete: "SET NULL" },
  fk_supplier_import_created_by: { column: "created_by", table: "users", onDelete: "SET NULL" },
  fk_supplier_import_confirmed_by: { column: "confirmed_by", table: "users", onDelete: "SET NULL" }
});

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

function incompatible(detail) {
  return new Error(`Incompatible existing Supplier import job schema: ${detail}`);
}

/** `table` 只為測試指住一張 probe 表（同 0037 一樣）。 */
export async function inspectSupplierImportJobSchema(connection, { table = "supplier_import_jobs" } = {}) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type, is_nullable AS is_nullable,
            column_default AS column_default, collation_name AS collation_name, extra AS extra
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position`,
    [table]
  );
  if (columns.length === 0) return false;
  const names = Object.keys(COLUMN_CONTRACT);
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== names.length || names.some((name) => !actual.includes(name))) throw incompatible("columns");
  for (const row of columns) {
    const name = value(row, "column_name", "COLUMN_NAME");
    const expected = COLUMN_CONTRACT[name];
    const nullable = String(value(row, "is_nullable", "IS_NULLABLE")).toUpperCase() === "YES";
    if (String(value(row, "column_type", "COLUMN_TYPE")).toLowerCase() !== expected.type ||
        nullable !== expected.nullable ||
        (value(row, "column_default", "COLUMN_DEFAULT") ?? null) !== expected.default ||
        (expected.collation && value(row, "collation_name", "COLLATION_NAME") !== expected.collation) ||
        (expected.charset && !String(value(row, "collation_name", "COLLATION_NAME")).startsWith(`${expected.charset}_`)) ||
        (expected.autoIncrement && !/auto_increment/iu.test(String(value(row, "extra", "EXTRA"))))) {
      throw incompatible(`column ${name}`);
    }
  }

  const [indexRows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY index_name, seq_in_index`,
    [table]
  );
  const indexes = new Map();
  for (const row of indexRows) {
    const name = value(row, "index_name", "INDEX_NAME");
    const found = indexes.get(name) ?? { unique: true, columns: [] };
    found.unique &&= Number(value(row, "non_unique", "NON_UNIQUE")) === 0;
    found.columns.push(value(row, "column_name", "COLUMN_NAME"));
    indexes.set(name, found);
  }
  // 契約以外嘅 UNIQUE 會靜靜雞改變業務規則（例如 UNIQUE(status) = 每個狀態只准一個 job）。
  for (const [name, found] of indexes) {
    if (found.unique && !INDEXES[name]) throw incompatible(`unexpected unique index ${name}`);
  }
  for (const [name, [unique, covered]] of Object.entries(INDEXES)) {
    const found = indexes.get(name);
    if (!found || found.unique !== unique || found.columns.join(",") !== covered) throw incompatible(`index ${name}`);
  }

  const [foreignKeys] = await connection.query(
    `SELECT rc.constraint_name AS constraint_name, kcu.column_name AS column_name,
            rc.referenced_table_name AS referenced_table_name, rc.delete_rule AS delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = rc.constraint_schema AND kcu.table_name = rc.table_name
        AND kcu.constraint_name = rc.constraint_name
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name = ?`,
    [table]
  );
  if (foreignKeys.length !== Object.keys(FOREIGN_KEYS).length) throw incompatible("foreign keys");
  for (const row of foreignKeys) {
    const expected = FOREIGN_KEYS[value(row, "constraint_name", "CONSTRAINT_NAME")];
    if (!expected || value(row, "column_name", "COLUMN_NAME") !== expected.column ||
        value(row, "referenced_table_name", "REFERENCED_TABLE_NAME") !== expected.table ||
        String(value(row, "delete_rule", "DELETE_RULE")).toUpperCase() !== expected.onDelete) {
      throw incompatible(`foreign key ${value(row, "constraint_name", "CONSTRAINT_NAME")}`);
    }
  }

  const [checks] = await connection.query(
    `SELECT constraint_name AS constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_type = 'CHECK'`,
    [table]
  );
  if (checks.length > 0) throw incompatible("the table carries CHECK constraints the contract does not define");

  const [triggers] = await connection.query(
    `SELECT trigger_name AS trigger_name FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND event_object_table = ?`,
    [table]
  );
  if (triggers.length > 0) throw incompatible("the table carries triggers");
  return true;
}

export async function up(connection) {
  if (await inspectSupplierImportJobSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_import_jobs (
      id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      template_version         VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_stored_name       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_sha256            BINARY(32) NOT NULL,
      result_stored_name       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      result_sha256            BINARY(32) NULL,
      files_purged_at          BIGINT UNSIGNED NULL,
      mode                     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      activation_mode          VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
      approver_user_id         BIGINT UNSIGNED NULL,
      approval_setting_value   TINYINT(1) NULL,
      approval_setting_version INT UNSIGNED NULL,
      status                   VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      total_count              INT UNSIGNED NOT NULL DEFAULT 0,
      valid_count              INT UNSIGNED NOT NULL DEFAULT 0,
      warning_count            INT UNSIGNED NOT NULL DEFAULT 0,
      invalid_count            INT UNSIGNED NOT NULL DEFAULT 0,
      applied_count            INT UNSIGNED NOT NULL DEFAULT 0,
      failed_count             INT UNSIGNED NOT NULL DEFAULT 0,
      skipped_count            INT UNSIGNED NOT NULL DEFAULT 0,
      last_error_code          VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      error_summary            VARCHAR(500) NOT NULL DEFAULT '',
      lease_owner              VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      lease_until              BIGINT UNSIGNED NULL,
      created_by               BIGINT UNSIGNED NULL,
      confirmed_by             BIGINT UNSIGNED NULL,
      created_at               BIGINT UNSIGNED NOT NULL,
      updated_at               BIGINT UNSIGNED NOT NULL,
      confirmed_at             BIGINT UNSIGNED NULL,
      completed_at             BIGINT UNSIGNED NULL,
      version                  INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_import_source_name (source_stored_name),
      UNIQUE KEY uq_supplier_import_result_name (result_stored_name),
      KEY idx_supplier_import_status (status, created_at, id),
      KEY idx_supplier_import_lease (lease_until, status),
      KEY idx_supplier_import_actor (created_by, created_at, id),
      CONSTRAINT fk_supplier_import_approver FOREIGN KEY (approver_user_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_import_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_import_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSupplierImportJobSchema(connection);
}
