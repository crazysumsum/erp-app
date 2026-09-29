/**
 * Supplier import row（設計 §5.13／§8.8，SUP-M06；T42，Product Owner 按 T42 schema 方案批准）。
 *
 * `(job_id, row_number)` 主鍵加埋 `status = 'applied'` 呢個 terminal marker 就係逐列
 * 執行嘅 idempotency fence：Supplier、audit 同 marker 喺同一個 transaction commit。
 *
 * 兩條約束由資料庫執行，唔靠 service 記得：
 * - `chk_supplier_import_row_applied`：`applied_supplier_id` 只喺 `status = 'applied'` 時
 *   有值（設計 §5.13），而且 applied 一定有值。
 * - `job_id` 係 RESTRICT：Job 同 rows 要保留至少 7 年而且冇刪除 API，所以唔准連帶刪走
 *   逐列結果證據。
 * `match_supplier_id`、`applied_supplier_id` 係 logical ID，唔設 FK（設計 §5.13）。
 */
const COLUMN_CONTRACT = Object.freeze({
  job_id:                    { type: "bigint unsigned", nullable: false, default: null },
  row_number:                { type: "int unsigned", nullable: false, default: null },
  operation:                 { type: "varchar(20)", nullable: false, default: null, collation: "ascii_bin" },
  match_supplier_id:         { type: "bigint unsigned", nullable: true, default: null },
  expected_supplier_version: { type: "int unsigned", nullable: true, default: null },
  normalized_payload:        { type: "json", nullable: false, default: null },
  status:                    { type: "varchar(20)", nullable: false, default: null, collation: "ascii_bin" },
  applied_supplier_id:       { type: "bigint unsigned", nullable: true, default: null },
  errors:                    { type: "json", nullable: true, default: null },
  warnings:                  { type: "json", nullable: true, default: null },
  started_at:                { type: "bigint unsigned", nullable: true, default: null },
  completed_at:              { type: "bigint unsigned", nullable: true, default: null },
  created_at:                { type: "bigint unsigned", nullable: false, default: null },
  updated_at:                { type: "bigint unsigned", nullable: false, default: null }
});

const INDEXES = Object.freeze({
  PRIMARY: [true, "job_id,row_number"],
  idx_supplier_import_row_status: [false, "job_id,status,row_number"]
});

// 正規化之後嘅 check clause。information_schema 會加 charset introducer、反引號同括號，
// 而唔同 MySQL 版本寫法有出入，所以比較之前拆走呢啲。
const APPLIED_CHECK = "((status='applied')=(applied_supplier_idisnotnull))";

function normalizeClause(clause) {
  return String(clause ?? "").replace(/\\'/gu, "'").replace(/_[a-z0-9]+'/gu, "'").replace(/[`\s]/gu, "").toLowerCase();
}

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

function incompatible(detail) {
  return new Error(`Incompatible existing Supplier import row schema: ${detail}`);
}

/** `table`／`jobTable` 只為測試指住 probe 表（同 0037 一樣）。 */
export async function inspectSupplierImportRowSchema(connection,
  { table = "supplier_import_rows", jobTable = "supplier_import_jobs" } = {}) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type, is_nullable AS is_nullable,
            column_default AS column_default, collation_name AS collation_name
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
        (expected.collation && value(row, "collation_name", "COLLATION_NAME") !== expected.collation)) {
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
  const fk = foreignKeys[0];
  if (foreignKeys.length !== 1 || value(fk, "column_name", "COLUMN_NAME") !== "job_id" ||
      value(fk, "referenced_table_name", "REFERENCED_TABLE_NAME") !== jobTable ||
      String(value(fk, "delete_rule", "DELETE_RULE")).toUpperCase() !== "RESTRICT") {
    throw incompatible("foreign key job_id must reference supplier_import_jobs ON DELETE RESTRICT");
  }

  const [checks] = await connection.query(
    `SELECT cc.check_clause AS check_clause
       FROM information_schema.table_constraints tc
       JOIN information_schema.check_constraints cc
         ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name
      WHERE tc.constraint_schema = DATABASE() AND tc.table_name = ? AND tc.constraint_type = 'CHECK'
        AND tc.enforced = 'YES'`,
    [table]
  );
  if (!checks.some((row) => normalizeClause(value(row, "check_clause", "CHECK_CLAUSE")) === APPLIED_CHECK)) {
    throw incompatible("the applied_supplier_id check is missing or not enforced");
  }

  const [triggers] = await connection.query(
    `SELECT trigger_name AS trigger_name FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND event_object_table = ?`,
    [table]
  );
  if (triggers.length > 0) throw incompatible("the table carries triggers");
  return true;
}

export async function up(connection) {
  if (await inspectSupplierImportRowSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_import_rows (
      job_id                    BIGINT UNSIGNED NOT NULL,
      \`row_number\`              INT UNSIGNED NOT NULL,
      operation                 VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      match_supplier_id         BIGINT UNSIGNED NULL,
      expected_supplier_version INT UNSIGNED NULL,
      normalized_payload        JSON NOT NULL,
      status                    VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_supplier_id       BIGINT UNSIGNED NULL,
      errors                    JSON NULL,
      warnings                  JSON NULL,
      started_at                BIGINT UNSIGNED NULL,
      completed_at              BIGINT UNSIGNED NULL,
      created_at                BIGINT UNSIGNED NOT NULL,
      updated_at                BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (job_id, \`row_number\`),
      KEY idx_supplier_import_row_status (job_id, status, \`row_number\`),
      CONSTRAINT fk_supplier_import_row_job FOREIGN KEY (job_id) REFERENCES supplier_import_jobs (id) ON DELETE RESTRICT,
      CONSTRAINT chk_supplier_import_row_applied CHECK ((status = 'applied') = (applied_supplier_id IS NOT NULL))
    )
  `);
  await inspectSupplierImportRowSchema(connection);
}
