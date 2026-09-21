const COLUMNS = Object.freeze([
  "id", "supplier_id", "crypto_context", "account_holder_name", "bank_name",
  "bank_country_code", "bank_code", "branch_code", "swift_bic", "account_currency_code",
  "account_ciphertext", "account_iv", "account_auth_tag", "encryption_key_id",
  "account_blind_index", "blind_index_key_id", "last_four", "account_length",
  "is_default", "default_slot", "status", "version",
  "created_at", "updated_at", "created_by", "updated_by"
]);
const INDEXES = new Set([
  "PRIMARY", "uq_supplier_bank_crypto_context", "uq_supplier_bank_blind_index",
  "uq_supplier_bank_default", "idx_supplier_bank_lookup", "idx_supplier_bank_owner_status"
]);
const FOREIGN_KEYS = new Set([
  "fk_supplier_bank_supplier", "fk_supplier_bank_currency",
  "fk_supplier_bank_created_by", "fk_supplier_bank_updated_by"
]);

// 設計 5.8：account_ciphertext／iv／auth_tag 係二進位，唔可以退化成文字欄位。
// 一個 VARCHAR(512) 叫做 account_ciphertext 會滿足上面個名單，但佢會經 collation
// 比較同 padding，而 BINARY(12) 退化成 VARCHAR(12) 更加會靜靜哋截短 IV。
const BINARY_COLUMNS = Object.freeze({
  account_ciphertext: { type: "varbinary", length: 512 },
  account_iv: { type: "binary", length: 12 },
  account_auth_tag: { type: "binary", length: 16 },
  account_blind_index: { type: "binary", length: 32 }
});

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
    `SELECT column_name AS column_name, data_type AS data_type,
            character_maximum_length AS character_maximum_length, extra AS extra
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position`,
    [table]
  );
  if (columns.length === 0) return false;

  // 呢個比較係集合相等：數目一樣，而且每個預期欄位都喺度。所以佢已經擋死咗明文
  // 帳號欄位 —— 多一個 account_number 就數目唔啱，改名做 account_number 就少咗個
  // 預期欄位。之前呢度仲有一個 FORBIDDEN_COLUMNS 名單，但變異測試證明佢永遠行唔
  // 到：任何帶住明文欄位嘅表都喺上面呢句就已經停低。一個永遠唔會觸發嘅守衛比冇
  // 守衛更差，因為佢讀落似有保護。
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name) => !actual.includes(name))) {
    throw new Error("Incompatible existing Supplier bank account schema: supplier_bank_accounts");
  }

  for (const [name, expected] of Object.entries(BINARY_COLUMNS)) {
    const row = columns.find((candidate) => value(candidate, "column_name", "COLUMN_NAME") === name);
    const type = String(value(row, "data_type", "DATA_TYPE") ?? "").toLowerCase();
    const length = Number(value(row, "character_maximum_length", "CHARACTER_MAXIMUM_LENGTH"));
    if (type !== expected.type || length !== expected.length) {
      throw new Error(
        `Incompatible existing Supplier bank account column: ${name} must be ${expected.type.toUpperCase()}(${expected.length})`
      );
    }
  }

  // 同 0035 嘅 pending_slot 一樣：一個普通 TINYINT 叫做 default_slot 會過到名單
  // 檢查，但應用層就可以任意寫個 slot，「最多一個 default」就唔再係資料庫保證。
  const slot = columns.find((row) => value(row, "column_name", "COLUMN_NAME") === "default_slot");
  if (!String(value(slot, "extra", "EXTRA") ?? "").toUpperCase().includes("GENERATED")) {
    throw new Error("Incompatible existing Supplier bank account column: default_slot is not a generated column");
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

  // 同名但非唯一嘅索引乜都執行唔到，所以兩個真正做保證嘅 UNIQUE 要逐個核實
  // 佢哋係唯一、而且覆蓋嘅係邊幾個欄位。
  for (const [name, expected] of [
    ["uq_supplier_bank_default", "supplier_id,default_slot"],
    ["uq_supplier_bank_blind_index", "supplier_id,blind_index_key_id,account_blind_index"]
  ]) {
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
    `SELECT constraint_name AS constraint_name
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  const actualForeignKeys = new Set(foreignKeys.map((row) => value(row, "constraint_name", "CONSTRAINT_NAME")));
  for (const name of FOREIGN_KEYS) {
    if (!actualForeignKeys.has(name)) throw new Error(`Incompatible existing Supplier bank account FK: ${name}`);
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
