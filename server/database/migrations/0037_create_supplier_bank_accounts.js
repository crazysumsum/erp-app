/**
 * 呢張表嘅完整 contract。設計 §5.14 要求既存 table 嘅相容性檢查覆蓋
 * 「欄位、型別、NULL/default、FK、unique/index 及 trigger」，所以呢度逐項列晒，
 * 唔係抽樣。
 *
 * REV-033 H-2 就係抽樣嘅代價：原本只驗四個二進位欄位嘅型別、`default_slot` 有冇
 * 「GENERATED」字樣、六個索引嘅**名**、兩個索引嘅唯一性同覆蓋欄位、四個 FK 嘅
 * **名**。八類唔相容嘅表全部過到關，其中三類會拆咗一個保證：
 *   - `default_slot` 改成 `GENERATED ALWAYS AS (NULL)` —— 仲係 generated，但
 *     UNIQUE 唔比較 NULL，所以「每個 Supplier 最多一個有效預設」變咗裝飾。
 *   - `uq_supplier_bank_crypto_context` 降級成普通 KEY —— crypto_context 係
 *     AAD 一半，佢嘅唯一性就係「同一個 Supplier 兩行密文對調唔到」嘅唯一理由。
 *   - IV／tag／blind index 改成可 NULL —— 之後落到解密path 變成未捕捉嘅 TypeError。
 *
 * `type` 用 `COLUMN_TYPE` 而唔係 `DATA_TYPE` 加長度：佢一個欄位同時鎖住型別、
 * 長度同 unsigned，而 `smallint` 降做 `tinyint unsigned` 正正係逃得過後者嘅。
 */
const COLUMN_CONTRACT = Object.freeze({
  id:                    { type: "bigint unsigned", nullable: false, default: null },
  supplier_id:           { type: "bigint unsigned", nullable: false, default: null },
  crypto_context:        { type: "char(36)", nullable: false, default: null, collation: "ascii_bin" },
  account_holder_name:   { type: "varchar(190)", nullable: false, default: null },
  bank_name:             { type: "varchar(190)", nullable: false, default: null },
  bank_country_code:     { type: "char(2)", nullable: true, default: null, collation: "ascii_bin" },
  bank_code:             { type: "varchar(50)", nullable: false, default: "" },
  branch_code:           { type: "varchar(50)", nullable: false, default: "" },
  swift_bic:             { type: "varchar(11)", nullable: false, default: "", collation: "ascii_bin" },
  account_currency_code: { type: "char(3)", nullable: true, default: null, collation: "ascii_bin" },
  account_ciphertext:    { type: "varbinary(512)", nullable: false, default: null },
  account_iv:            { type: "binary(12)", nullable: false, default: null },
  account_auth_tag:      { type: "binary(16)", nullable: false, default: null },
  encryption_key_id:     { type: "varchar(50)", nullable: false, default: null, collation: "ascii_bin" },
  account_blind_index:   { type: "binary(32)", nullable: false, default: null },
  blind_index_key_id:    { type: "varchar(50)", nullable: false, default: null, collation: "ascii_bin" },
  last_four:             { type: "varchar(4)", nullable: false, default: null },
  account_length:        { type: "smallint unsigned", nullable: false, default: null },
  is_default:            { type: "tinyint(1)", nullable: false, default: "0" },
  status:                { type: "varchar(20)", nullable: false, default: "active", collation: "ascii_bin" },
  default_slot:          { type: "tinyint", nullable: true, default: null },
  version:               { type: "int unsigned", nullable: false, default: "1" },
  created_at:            { type: "bigint unsigned", nullable: false, default: null },
  updated_at:            { type: "bigint unsigned", nullable: false, default: null },
  created_by:            { type: "bigint unsigned", nullable: true, default: null },
  updated_by:            { type: "bigint unsigned", nullable: true, default: null }
});
const COLUMNS = Object.freeze(Object.keys(COLUMN_CONTRACT));

// 三個 UNIQUE 全部要驗唯一性同覆蓋欄位，唔係淨係驗個名 —— 一個同名但非唯一嘅索引
// 執行唔到任何嘢。crypto_context 之前只驗名，而佢就係最唔應該只驗名嗰個。
const UNIQUE_INDEXES = Object.freeze({
  uq_supplier_bank_crypto_context: "crypto_context",
  uq_supplier_bank_blind_index: "supplier_id,blind_index_key_id,account_blind_index",
  uq_supplier_bank_default: "supplier_id,default_slot"
});
const INDEXES = new Set(["PRIMARY", ...Object.keys(UNIQUE_INDEXES),
  "idx_supplier_bank_lookup", "idx_supplier_bank_owner_status"]);

// FK 連引用邊張表同 delete rule 一齊驗：一個名叫 fk_supplier_bank_supplier 但指住
// 第二張表、或者由 CASCADE 改成 NO ACTION 嘅 FK，名單檢查完全睇唔出。
const FOREIGN_KEYS = Object.freeze({
  fk_supplier_bank_supplier: { table: "suppliers", onDelete: "CASCADE" },
  fk_supplier_bank_currency: { table: "currencies", onDelete: "RESTRICT" },
  fk_supplier_bank_created_by: { table: "users", onDelete: "SET NULL" },
  fk_supplier_bank_updated_by: { table: "users", onDelete: "SET NULL" }
});

// `default_slot` 個運算式先係「最多一個有效預設」嘅真正內容。information_schema 同
// SHOW CREATE TABLE 對 charset introducer 嘅寫法唔同（_utf8mb4 對 _ascii），而唔同
// MySQL 版本嘅空白同括號亦都有出入，所以比較之前先正規化走呢啲差異。
const DEFAULT_SLOT_EXPRESSION = "if(((is_default=1)and(status='active')),1,null)";

function normalizeExpression(value) {
  return String(value ?? "")
    .replace(/\\'/gu, "'")
    .replace(/_[a-z0-9]+'/gu, "'")
    .replace(/[`\s]/gu, "")
    .toLowerCase();
}

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

/**
 * `table` 只為咗俾測試指住一張 probe 表。呢個 assertion 本身就係 T32 嘅一條驗收
 * 條件，而證明佢真係擋到一張手改歪嘅表，唯一嘅方法就係俾佢睇一張歪表。另一個做法
 * —— 將真表 RENAME 走再改返 —— 喺一個共用嘅 erp_dev 上面會拆咗並行跑緊嘅其他檔案。
 */
export async function inspectSupplierBankAccountSchema(connection, { table = "supplier_bank_accounts" } = {}) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name, column_type AS column_type, is_nullable AS is_nullable,
            column_default AS column_default, collation_name AS collation_name,
            extra AS extra, generation_expression AS generation_expression
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position`,
    [table]
  );
  if (columns.length === 0) return false;

  // 集合相等：數目一樣，而且每個預期欄位都喺度。呢句已經擋死明文帳號欄位 —— 多一個
  // account_number 就數目唔啱，改名做 account_number 就少咗個預期欄位。
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name) => !actual.includes(name))) {
    throw new Error("Incompatible existing Supplier bank account schema: supplier_bank_accounts");
  }

  for (const row of columns) {
    const name = value(row, "column_name", "COLUMN_NAME");
    const expected = COLUMN_CONTRACT[name];
    const type = String(value(row, "column_type", "COLUMN_TYPE") ?? "").toLowerCase();
    if (type !== expected.type) {
      throw new Error(`Incompatible existing Supplier bank account column: ${name} must be ${expected.type}`);
    }
    const nullable = String(value(row, "is_nullable", "IS_NULLABLE") ?? "").toUpperCase() === "YES";
    if (nullable !== expected.nullable) {
      throw new Error(`Incompatible existing Supplier bank account column: ${name} must be ${expected.nullable ? "NULL" : "NOT NULL"}`);
    }
    const columnDefault = value(row, "column_default", "COLUMN_DEFAULT");
    if ((columnDefault ?? null) !== expected.default) {
      throw new Error(`Incompatible existing Supplier bank account column: ${name} default must be ${JSON.stringify(expected.default)}`);
    }
    if (expected.collation) {
      const collation = value(row, "collation_name", "COLLATION_NAME");
      if (collation !== expected.collation) {
        throw new Error(`Incompatible existing Supplier bank account column: ${name} must collate ${expected.collation}`);
      }
    }
  }

  // `default_slot` 要係 generated，而且個運算式要**啱**。一個
  // GENERATED ALWAYS AS (NULL) 一樣係 generated，但佢會令 UNIQUE 永遠唔比較到嘢。
  const slot = columns.find((row) => value(row, "column_name", "COLUMN_NAME") === "default_slot");
  if (!String(value(slot, "extra", "EXTRA") ?? "").toUpperCase().includes("GENERATED")) {
    throw new Error("Incompatible existing Supplier bank account column: default_slot is not a generated column");
  }
  if (normalizeExpression(value(slot, "generation_expression", "GENERATION_EXPRESSION")) !== DEFAULT_SLOT_EXPRESSION) {
    throw new Error("Incompatible existing Supplier bank account column: default_slot does not compute the documented slot");
  }

  const [indexes] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  const actualIndexes = new Set(indexes.map((row) => value(row, "index_name", "INDEX_NAME")));
  for (const name of INDEXES) {
    if (!actualIndexes.has(name)) throw new Error(`Incompatible existing Supplier bank account index: ${name}`);
  }

  for (const [name, expected] of Object.entries(UNIQUE_INDEXES)) {
    const [rows] = await connection.query(
      `SELECT non_unique AS non_unique, column_name AS column_name
         FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = ?
          AND index_name = ?
        ORDER BY seq_in_index`,
      [table, name]
    );
    const unique = rows.length > 0 && rows.every((row) => Number(value(row, "non_unique", "NON_UNIQUE")) === 0);
    const covered = rows.map((row) => value(row, "column_name", "COLUMN_NAME")).join(",");
    if (!unique || covered !== expected) {
      throw new Error(`Incompatible existing Supplier bank account index: ${name} must be UNIQUE (${expected.split(",").join(", ")})`);
    }
  }

  const [foreignKeys] = await connection.query(
    `SELECT constraint_name AS constraint_name, referenced_table_name AS referenced_table_name,
            delete_rule AS delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  const actualForeignKeys = new Map(foreignKeys.map((row) => [
    value(row, "constraint_name", "CONSTRAINT_NAME"),
    {
      table: value(row, "referenced_table_name", "REFERENCED_TABLE_NAME"),
      onDelete: String(value(row, "delete_rule", "DELETE_RULE") ?? "").toUpperCase()
    }
  ]));
  for (const [name, expected] of Object.entries(FOREIGN_KEYS)) {
    const found = actualForeignKeys.get(name);
    if (!found) throw new Error(`Incompatible existing Supplier bank account FK: ${name}`);
    if (found.table !== expected.table || found.onDelete !== expected.onDelete) {
      throw new Error(`Incompatible existing Supplier bank account FK: ${name} must reference ${expected.table} ON DELETE ${expected.onDelete}`);
    }
  }

  // 設計 §5.14 明文包括 trigger。一個 BEFORE INSERT trigger 可以改寫任何一個欄位，
  // 包括將明文帳號抄去 last_four，而上面所有檢查都睇唔到佢。
  const [triggers] = await connection.query(
    `SELECT trigger_name AS trigger_name
       FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND event_object_table = ?`,
    [table]
  );
  if (triggers.length > 0) {
    throw new Error("Incompatible existing Supplier bank account schema: the table carries triggers");
  }
  return true;
}

export async function up(connection) {
  if (await inspectSupplierBankAccountSchema(connection)) return;
  // 設計 5.8。三件事喺呢度用資料庫執行，唔靠應用層記得：
  //
  // 1. 冇任何明文帳號欄位。帳號只以 ciphertext + IV + tag 存在，而 last_four 同
  //    account_length 分開存 —— 淨係 last_four 嘅話，一個四位或以下嘅帳號，佢個
  //    「尾四位」就係成個帳號本身。
  // 2. default_slot 係 generated stored：default 且 active 先係 1，否則 NULL。
  //    MySQL 冇 partial index，而 UNIQUE 唔比較 NULL，所以呢個就係「每個 Supplier
  //    最多一個有效預設」嘅資料庫保證。同 0032／0033 嘅 primary_slot、0035 嘅
  //    pending_slot 係同一個做法。status 用 ascii_bin，所以 'Active' 唔等於
  //    'active'，寫入方一定要用字面值。
  // 3. 查重 UNIQUE 包住 blind_index_key_id。輪替期間同一個帳號用唔同 key 會得出
  //    唔同 blind index，所以唔可以淨係 (supplier_id, account_blind_index) ——
  //    咁樣輪替途中會爆假 duplicate。設計 5.8 明文要求 service 用 ring 入面所有
  //    key 查重，令「換咗 key ID」繞唔過個規則。
  //
  // 跨 Supplier 嘅同一帳號**唔**設 global unique：設計 5.8 講明佢只係一個 warning。
  // 兩間公司共用一個收款帳號係合法嘅業務情況，唔應該喺資料庫層封死。
  //
  // supplier_id 係 CASCADE：設計 5.8 講明「未引用嘅 Bank」跟住 Supplier 硬刪一齊走，
  // 而日後嘅付款表會以 RESTRICT 引用呢張表，由嗰邊擋住有交易紀錄嘅帳戶。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_bank_accounts (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      supplier_id           BIGINT UNSIGNED NOT NULL,
      crypto_context        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      account_holder_name   VARCHAR(190) NOT NULL,
      bank_name             VARCHAR(190) NOT NULL,
      bank_country_code     CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NULL,
      bank_code             VARCHAR(50) NOT NULL DEFAULT '',
      branch_code           VARCHAR(50) NOT NULL DEFAULT '',
      swift_bic             VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      account_currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
      account_ciphertext    VARBINARY(512) NOT NULL,
      account_iv            BINARY(12) NOT NULL,
      account_auth_tag      BINARY(16) NOT NULL,
      encryption_key_id     VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      account_blind_index   BINARY(32) NOT NULL,
      blind_index_key_id    VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      last_four             VARCHAR(4) NOT NULL,
      account_length        SMALLINT UNSIGNED NOT NULL,
      is_default            TINYINT(1) NOT NULL DEFAULT 0,
      status                VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
      default_slot          TINYINT GENERATED ALWAYS AS (IF(is_default = 1 AND status = 'active', 1, NULL)) STORED,
      version               INT UNSIGNED NOT NULL DEFAULT 1,
      created_at            BIGINT UNSIGNED NOT NULL,
      updated_at            BIGINT UNSIGNED NOT NULL,
      created_by            BIGINT UNSIGNED NULL,
      updated_by            BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_bank_crypto_context (crypto_context),
      UNIQUE KEY uq_supplier_bank_blind_index (supplier_id, blind_index_key_id, account_blind_index),
      UNIQUE KEY uq_supplier_bank_default (supplier_id, default_slot),
      KEY idx_supplier_bank_lookup (blind_index_key_id, account_blind_index),
      KEY idx_supplier_bank_owner_status (supplier_id, status, id),
      CONSTRAINT fk_supplier_bank_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE,
      CONSTRAINT fk_supplier_bank_currency FOREIGN KEY (account_currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_supplier_bank_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_bank_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSupplierBankAccountSchema(connection);
}
