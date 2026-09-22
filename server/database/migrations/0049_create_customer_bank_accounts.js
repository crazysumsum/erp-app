const COLUMN_CONTRACT = Object.freeze({
  id:                    { type: "bigint unsigned", nullable: false, default: null, extra: "auto_increment" },
  customer_id:           { type: "bigint unsigned", nullable: false, default: null },
  crypto_context:        { type: "char(36)", nullable: false, default: null, collation: "ascii_bin" },
  account_holder_name:   { type: "varchar(190)", nullable: false, default: null },
  bank_name:             { type: "varchar(190)", nullable: false, default: null },
  bank_country_code:     { type: "char(2)", nullable: true, default: null, collation: "ascii_bin" },
  bank_code:             { type: "varchar(50)", nullable: false, default: "" },
  branch_code:           { type: "varchar(50)", nullable: false, default: "" },
  swift_bic:             { type: "varchar(11)", nullable: false, default: "", collation: "ascii_bin" },
  account_currency_code: { type: "char(3)", nullable: true, default: null, collation: "ascii_bin" },
  purpose_code:          { type: "varchar(30)", nullable: false, default: "general", collation: "ascii_bin" },
  account_ciphertext:    { type: "varbinary(512)", nullable: false, default: null },
  account_iv:            { type: "binary(12)", nullable: false, default: null },
  account_auth_tag:      { type: "binary(16)", nullable: false, default: null },
  encryption_key_id:     { type: "varchar(64)", nullable: false, default: null, collation: "ascii_bin" },
  account_blind_index:   { type: "binary(32)", nullable: false, default: null },
  blind_index_key_id:    { type: "varchar(64)", nullable: false, default: null, collation: "ascii_bin" },
  last_four:             { type: "varchar(4)", nullable: false, default: null },
  account_length:        { type: "smallint unsigned", nullable: false, default: null },
  is_default:            { type: "tinyint(1)", nullable: false, default: "0" },
  status:                { type: "varchar(20)", nullable: false, default: "active", collation: "ascii_bin" },
  default_slot:          { type: "tinyint", nullable: true, default: null, extra: "stored generated" },
  version:               { type: "int unsigned", nullable: false, default: "1" },
  created_at:            { type: "bigint unsigned", nullable: false, default: null },
  updated_at:            { type: "bigint unsigned", nullable: false, default: null },
  created_by:            { type: "bigint unsigned", nullable: true, default: null },
  updated_by:            { type: "bigint unsigned", nullable: true, default: null }
});

const UNIQUE_INDEXES = Object.freeze({
  uq_customer_bank_crypto_context: "crypto_context",
  uq_customer_bank_same_owner: "customer_id,blind_index_key_id,account_blind_index",
  uq_customer_bank_default: "customer_id,default_slot"
});
const PLAIN_INDEXES = Object.freeze({
  idx_customer_bank_cross_owner: "blind_index_key_id,account_blind_index,customer_id",
  idx_customer_bank_owner_status: "customer_id,status,id"
});
const FOREIGN_KEYS = Object.freeze({
  fk_customer_bank_customer: { column: "customer_id", table: "customers", referencedColumn: "id", onDelete: "CASCADE" },
  fk_customer_bank_currency: { column: "account_currency_code", table: "currencies", referencedColumn: "code", onDelete: "RESTRICT" },
  fk_customer_bank_created_by: { column: "created_by", table: "users", referencedColumn: "id", onDelete: "SET NULL" },
  fk_customer_bank_updated_by: { column: "updated_by", table: "users", referencedColumn: "id", onDelete: "SET NULL" }
});
const DEFAULT_SLOT_EXPRESSION = "if(((status='active')and(is_default=1)),1,null)";

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

function normalizedExpression(input) {
  return String(input ?? "")
    .replace(/\\'/gu, "'")
    .replace(/_[a-z0-9]+'/gu, "'")
    .replace(/[`\s]/gu, "")
    .replace(/'[^']*'|[A-Z]+/gu, (part) => part.startsWith("'") ? part : part.toLowerCase());
}

async function inspectIndexes(connection, table) {
  const [rows] = await connection.query(
    `SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY index_name, seq_in_index`,
    [table]
  );
  const indexes = new Map();
  for (const row of rows) {
    const name = value(row, "index_name", "INDEX_NAME");
    const found = indexes.get(name) ?? { unique: true, columns: [] };
    found.unique &&= Number(value(row, "non_unique", "NON_UNIQUE")) === 0;
    found.columns.push(value(row, "column_name", "COLUMN_NAME"));
    indexes.set(name, found);
  }
  for (const [name, columns] of Object.entries({ PRIMARY: "id", ...UNIQUE_INDEXES })) {
    const found = indexes.get(name);
    if (!found?.unique || found.columns.join(",") !== columns) {
      throw new Error(`Incompatible existing Customer bank account index: ${name} must be UNIQUE (${columns})`);
    }
  }
  for (const [name, columns] of Object.entries(PLAIN_INDEXES)) {
    const found = indexes.get(name);
    if (!found || found.unique || found.columns.join(",") !== columns) {
      throw new Error(`Incompatible existing Customer bank account index: ${name} must cover (${columns})`);
    }
  }
}

export async function inspectCustomerBankAccountSchema(connection, { table = "customer_bank_accounts" } = {}) {
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

  const names = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  const expectedNames = Object.keys(COLUMN_CONTRACT);
  if (names.length !== expectedNames.length || expectedNames.some((name) => !names.includes(name))) {
    throw new Error("Incompatible existing Customer bank account schema: customer_bank_accounts");
  }
  for (const row of columns) {
    const name = value(row, "column_name", "COLUMN_NAME");
    const expected = COLUMN_CONTRACT[name];
    const actual = {
      type: String(value(row, "column_type", "COLUMN_TYPE") ?? "").toLowerCase(),
      nullable: String(value(row, "is_nullable", "IS_NULLABLE")).toUpperCase() === "YES",
      default: value(row, "column_default", "COLUMN_DEFAULT") ?? null,
      collation: value(row, "collation_name", "COLLATION_NAME"),
      extra: String(value(row, "extra", "EXTRA") ?? "").toLowerCase()
    };
    if (actual.type !== expected.type || actual.nullable !== expected.nullable || actual.default !== expected.default ||
        (expected.collation && actual.collation !== expected.collation) ||
        (expected.extra && !actual.extra.includes(expected.extra))) {
      throw new Error(`Incompatible existing Customer bank account column: ${name}`);
    }
  }
  const slot = columns.find((row) => value(row, "column_name", "COLUMN_NAME") === "default_slot");
  if (normalizedExpression(value(slot, "generation_expression", "GENERATION_EXPRESSION")) !== DEFAULT_SLOT_EXPRESSION) {
    throw new Error("Incompatible existing Customer bank account column: default_slot expression");
  }
  await inspectIndexes(connection, table);

  const [foreignKeys] = await connection.query(
    `SELECT rc.constraint_name AS constraint_name, kcu.column_name AS column_name,
            rc.referenced_table_name AS referenced_table_name,
            kcu.referenced_column_name AS referenced_column_name, rc.delete_rule AS delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = rc.constraint_schema
        AND kcu.table_name = rc.table_name
        AND kcu.constraint_name = rc.constraint_name
      WHERE rc.constraint_schema = DATABASE() AND rc.table_name = ?`,
    [table]
  );
  if (foreignKeys.length !== Object.keys(FOREIGN_KEYS).length) {
    throw new Error("Incompatible existing Customer bank account foreign keys");
  }
  for (const row of foreignKeys) {
    const name = value(row, "constraint_name", "CONSTRAINT_NAME");
    const expected = FOREIGN_KEYS[name];
    if (!expected || value(row, "column_name", "COLUMN_NAME") !== expected.column ||
        value(row, "referenced_table_name", "REFERENCED_TABLE_NAME") !== expected.table ||
        value(row, "referenced_column_name", "REFERENCED_COLUMN_NAME") !== expected.referencedColumn ||
        String(value(row, "delete_rule", "DELETE_RULE")).toUpperCase() !== expected.onDelete) {
      throw new Error(`Incompatible existing Customer bank account FK: ${name}`);
    }
  }

  const [triggers] = await connection.query(
    `SELECT trigger_name AS trigger_name FROM information_schema.triggers
      WHERE trigger_schema = DATABASE() AND event_object_table = ?`,
    [table]
  );
  if (triggers.length > 0) throw new Error("Incompatible existing Customer bank account schema: table carries triggers");
  return true;
}

export async function up(connection) {
  if (await inspectCustomerBankAccountSchema(connection)) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_bank_accounts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      customer_id BIGINT UNSIGNED NOT NULL,
      crypto_context CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      account_holder_name VARCHAR(190) NOT NULL,
      bank_name VARCHAR(190) NOT NULL,
      bank_country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NULL,
      bank_code VARCHAR(50) NOT NULL DEFAULT '',
      branch_code VARCHAR(50) NOT NULL DEFAULT '',
      swift_bic VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      account_currency_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
      purpose_code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'general',
      account_ciphertext VARBINARY(512) NOT NULL,
      account_iv BINARY(12) NOT NULL,
      account_auth_tag BINARY(16) NOT NULL,
      encryption_key_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      account_blind_index BINARY(32) NOT NULL,
      blind_index_key_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      last_four VARCHAR(4) NOT NULL,
      account_length SMALLINT UNSIGNED NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
      default_slot TINYINT GENERATED ALWAYS AS (IF(status = 'active' AND is_default = 1, 1, NULL)) STORED,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_bank_crypto_context (crypto_context),
      UNIQUE KEY uq_customer_bank_same_owner (customer_id, blind_index_key_id, account_blind_index),
      UNIQUE KEY uq_customer_bank_default (customer_id, default_slot),
      KEY idx_customer_bank_cross_owner (blind_index_key_id, account_blind_index, customer_id),
      KEY idx_customer_bank_owner_status (customer_id, status, id),
      CONSTRAINT fk_customer_bank_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_bank_currency FOREIGN KEY (account_currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_customer_bank_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_bank_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectCustomerBankAccountSchema(connection);
}
