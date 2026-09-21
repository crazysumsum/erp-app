import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { up as createSuppliers } from "../../database/migrations/0029_create_suppliers.js";
import { up as createSupplierNameGrams } from "../../database/migrations/0030_create_supplier_name_grams.js";
import { up as createSupplierActivationRequests } from "../../database/migrations/0035_create_supplier_activation_requests.js";
import { up as createSupplierSettings } from "../../database/migrations/0036_create_supplier_settings.js";
import {
  inspectSupplierBankAccountSchema,
  up as createSupplierBankAccounts
} from "../../database/migrations/0037_create_supplier_bank_accounts.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  };
}

integrationTest("0029 and 0030 create the exact Supplier root and owned gram schema and converge on rerun", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  await createSuppliers(connection);
  await createSupplierNameGrams(connection);
  await createSuppliers(connection);
  await createSupplierNameGrams(connection);

  const [supplierIndexes] = await connection.query(
    "SELECT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'suppliers' GROUP BY index_name ORDER BY index_name"
  );
  assert.deepEqual(supplierIndexes.map((row) => row.index_name ?? row.INDEX_NAME), [
    "fk_suppliers_created_by",
    "fk_suppliers_updated_by",
    "idx_suppliers_currency_status",
    "idx_suppliers_name_key",
    "idx_suppliers_payment_term_status",
    "idx_suppliers_status_updated_id",
    "PRIMARY",
    "uq_suppliers_code_key"
  ]);

  const [gramIndexes] = await connection.query(
    "SELECT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'supplier_name_grams' GROUP BY index_name ORDER BY index_name"
  );
  assert.deepEqual(gramIndexes.map((row) => row.index_name ?? row.INDEX_NAME), ["idx_supplier_name_grams_lookup", "PRIMARY"]);

  const [foreignKeys] = await connection.query(
    `SELECT table_name, referenced_table_name, delete_rule
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name IN ('suppliers', 'supplier_name_grams')
      ORDER BY table_name, referenced_table_name`
  );
  assert.deepEqual(foreignKeys.map((row) => [
    row.table_name ?? row.TABLE_NAME,
    row.referenced_table_name ?? row.REFERENCED_TABLE_NAME,
    row.delete_rule ?? row.DELETE_RULE
  ]), [
    ["supplier_name_grams", "suppliers", "CASCADE"],
    ["suppliers", "currencies", "RESTRICT"],
    ["suppliers", "payment_terms", "RESTRICT"],
    ["suppliers", "users", "SET NULL"],
    ["suppliers", "users", "SET NULL"]
  ]);
});

integrationTest("0035 gives the database the one-pending-request guarantee and converges on rerun", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  // One hook: node:test runs after-hooks in registration order, so a separate
  // cleanup hook registered later would find the connection already closed.
  t.after(async () => {
    if (supplierId !== null) {
      await connection.execute("DELETE FROM supplier_activation_requests WHERE supplier_id = ?", [supplierId]);
      await connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
    }
    await connection.end();
  });
  await createSupplierActivationRequests(connection);
  await createSupplierActivationRequests(connection);

  const [[slot]] = await connection.query(
    `SELECT extra FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests' AND column_name = 'pending_slot'`
  );
  assert.match(String(slot.extra ?? slot.EXTRA).toUpperCase(), /GENERATED/u);

  const [slotIndex] = await connection.query(
    `SELECT non_unique, column_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests'
        AND index_name = 'uq_supplier_activation_pending'
      ORDER BY seq_in_index`
  );
  assert.deepEqual(slotIndex.map((row) => row.column_name ?? row.COLUMN_NAME), ["supplier_id", "pending_slot"]);
  assert.deepEqual([...new Set(slotIndex.map((row) => Number(row.non_unique ?? row.NON_UNIQUE)))], [0]);

  const [[restrictRule]] = await connection.query(
    `SELECT delete_rule FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_supplier_activation_supplier'`
  );
  assert.equal(restrictRule.delete_rule ?? restrictRule.DELETE_RULE, "RESTRICT");

  // The index only enforces anything if the generated slot really is recomputed on
  // UPDATE, so exercise it against real rows rather than reading the DDL back.
  const suffix = randomUUID().slice(0, 8);
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const now = Date.now();
  const [supplier] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`MIG-${suffix}`, `mig-${suffix}`, `Migration ${suffix}`, `migration ${suffix}`, currency.code ?? currency.CODE, now, now]
  );
  supplierId = supplier.insertId;

  const insertPending = () => connection.execute(
    `INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, requested_at)
     VALUES (?, 1, JSON_OBJECT(), ?)`,
    [supplierId, Date.now()]
  );
  const [first] = await insertPending();
  await assert.rejects(insertPending, (error) => error.code === "ER_DUP_ENTRY");

  // A hard delete must not slip past the reference rules while a request is open.
  await assert.rejects(
    () => connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]),
    (error) => error.code === "ER_ROW_IS_REFERENCED_2"
  );

  await connection.execute("UPDATE supplier_activation_requests SET status = 'approved' WHERE id = ?", [first.insertId]);
  await insertPending();
  const [[counts]] = await connection.query(
    `SELECT COUNT(*) AS total, COUNT(pending_slot) AS pending
       FROM supplier_activation_requests WHERE supplier_id = ?`,
    [supplierId]
  );
  assert.equal(Number(counts.total ?? counts.TOTAL), 2);
  assert.equal(Number(counts.pending ?? counts.PENDING), 1);
});

integrationTest("0036 seeds the settings singleton once and a rerun neither duplicates nor resets it", async (t) => {
  const connection = await mysql.createConnection(config());
  t.after(() => connection.end());
  await createSupplierSettings(connection);

  // node --test runs test FILES in parallel against this one shared erp_dev, and
  // supplier_settings is a singleton every Settings caller will read. Re-exercising
  // the seed means deleting and rewriting that row, so it happens inside a
  // transaction that is always rolled back: no other connection ever observes the
  // intermediate values, and nothing depends on an after-hook running.
  await connection.beginTransaction();
  try {
    await connection.execute("DELETE FROM supplier_settings WHERE id = 1");
    await createSupplierSettings(connection);
    const [[seeded]] = await connection.query("SELECT require_activation_approval FROM supplier_settings WHERE id = 1");
    assert.equal(Number(seeded.require_activation_approval ?? seeded.REQUIRE_ACTIVATION_APPROVAL), 0,
      "the seed must leave existing activation behaviour unchanged");

    await connection.execute("UPDATE supplier_settings SET require_activation_approval = 1 WHERE id = 1");
    await createSupplierSettings(connection);
    const [rows] = await connection.query("SELECT id, require_activation_approval FROM supplier_settings");
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].require_activation_approval ?? rows[0].REQUIRE_ACTIVATION_APPROVAL), 1,
      "a rerun overwrote an operator's setting");
  } finally {
    await connection.rollback();
  }
});

/**
 * T32 AC4：Bank table 冇明文欄位、有兩組 key ID、有唯一 default 同查重約束，而且
 * **既存 table 要通過完整 schema compatibility assertion**。
 *
 * 最後嗰句先係重點，亦都係一個純 DDL 讀取證明唔到嘅嘢：一張手改到唔啱嘅表要真係
 * 俾人擋住。所以呢度除咗核實建出嚟嗰張表，仲會砌幾張刻意整歪嘅表，逐張要求
 * inspect 拋錯 —— 否則個 assertion 就只係一個永遠回 true 嘅函式。
 */
integrationTest("0037 creates the Bank table with no plaintext column and converges on rerun", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => {
    if (supplierId !== null) {
      await connection.execute("DELETE FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]);
      await connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
    }
    await connection.end();
  });
  await createSupplierBankAccounts(connection);
  await createSupplierBankAccounts(connection);
  assert.equal(await inspectSupplierBankAccountSchema(connection), true);

  const [columns] = await connection.query(
    `SELECT column_name, data_type, character_maximum_length, extra
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_bank_accounts'`
  );
  const byName = new Map(columns.map((row) => [row.column_name ?? row.COLUMN_NAME, row]));

  // 明文帳號唔可以以任何常見名出現。
  for (const forbidden of ["account_number", "account_no", "bank_account_number", "iban"]) {
    assert.ok(!byName.has(forbidden), `the Bank table must not carry a ${forbidden} column`);
  }
  // 而帳號嘅三件密文組件要真係二進位：一個 VARCHAR 嘅 IV 會經 collation 比較同
  // padding，仲會靜靜哋截短。
  for (const [name, type, length] of [
    ["account_ciphertext", "varbinary", 512], ["account_iv", "binary", 12],
    ["account_auth_tag", "binary", 16], ["account_blind_index", "binary", 32]
  ]) {
    const row = byName.get(name);
    assert.equal(String(row.data_type ?? row.DATA_TYPE).toLowerCase(), type, name);
    assert.equal(Number(row.character_maximum_length ?? row.CHARACTER_MAXIMUM_LENGTH), length, name);
  }
  for (const name of ["encryption_key_id", "blind_index_key_id"]) {
    assert.ok(byName.has(name), `${name} must exist so a row can be rotated independently`);
  }
  assert.match(String(byName.get("default_slot").extra ?? byName.get("default_slot").EXTRA).toUpperCase(), /GENERATED/u);

  // 同 0035 一樣：個 slot 只有喺 UPDATE 都會重算嘅時候先執行到嘢，所以要用真行去試。
  const suffix = randomUUID().slice(0, 8);
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const now = Date.now();
  const [supplier] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`BNK-${suffix}`, `bnk-${suffix}`, `Bank ${suffix}`, `bank ${suffix}`, currency.code ?? currency.CODE, now, now]
  );
  supplierId = supplier.insertId;

  const insertAccount = ({ isDefault = 0, blindIndex, keyId = "look-1", context = randomUUID() } = {}) =>
    connection.execute(
      `INSERT INTO supplier_bank_accounts
         (supplier_id, crypto_context, account_holder_name, bank_name,
          account_ciphertext, account_iv, account_auth_tag, encryption_key_id,
          account_blind_index, blind_index_key_id, last_four, account_length,
          is_default, created_at, updated_at)
       VALUES (?, ?, 'Holder', 'Bank', ?, ?, ?, 'enc-1', ?, ?, '0123', 13, ?, ?, ?)`,
      [supplierId, context, randomBytes(64), randomBytes(12), randomBytes(16),
       blindIndex ?? randomBytes(32), keyId, isDefault, Date.now(), Date.now()]
    );

  const [first] = await insertAccount({ isDefault: 1 });
  await assert.rejects(() => insertAccount({ isDefault: 1 }), (error) => error.code === "ER_DUP_ENTRY",
    "the database, not the service, guarantees at most one active default");

  // 同一個 Supplier、同一條 lookup key、同一個 index = 重覆帳號。
  const shared = randomBytes(32);
  await insertAccount({ blindIndex: shared });
  await assert.rejects(() => insertAccount({ blindIndex: shared }), (error) => error.code === "ER_DUP_ENTRY");
  // 但換咗 key ID 就唔係同一條 index，輪替期間唔可以爆假 duplicate。
  await insertAccount({ blindIndex: shared, keyId: "look-2" });

  // 停用原本嗰個 default 之後個 slot 要放返出嚟，否則「換預設」永遠做唔到。
  await connection.execute("UPDATE supplier_bank_accounts SET status = 'inactive' WHERE id = ?", [first.insertId]);
  await insertAccount({ isDefault: 1 });
  const [[slots]] = await connection.query(
    "SELECT COUNT(default_slot) AS taken FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]
  );
  assert.equal(Number(slots.taken ?? slots.TAKEN), 1);
});

integrationTest("0037's compatibility assertion actually rejects a hand-divergent Bank table", async (t) => {
  // 一個永遠回 true 嘅 assertion 同冇 assertion 係一樣嘅。呢度逐樣整歪一件嘢，每一樣
  // 都要拋錯。全部喺一張 probe 表上面做 —— 將真表 RENAME 走再改返，喺共用嘅 erp_dev
  // 上面會拆咗並行跑緊嘅其他檔案。
  const connection = await mysql.createConnection(config());
  const table = `bank_probe_${randomUUID().slice(0, 8).replace(/-/gu, "")}`;
  t.after(async () => {
    await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    await connection.end();
  });

  // 先由真表嘅 DDL 出發，咁每個 case 就只係差一樣嘢，唔係差成張表。FK 一定要拆走：
  // MySQL 嘅 constraint name 喺一個 schema 入面係全域唯一，所以一張複製表冇可能
  // 帶住同一批 FK 名。呢個限制反而俾到一個免費嘅對照組 —— 見下面。
  const [[real]] = await connection.query("SHOW CREATE TABLE supplier_bank_accounts");
  const lines = String(real["Create Table"] ?? real["create table"])
    .replace("CREATE TABLE `supplier_bank_accounts`", `CREATE TABLE \`${table}\``)
    .split("\n")
    .filter((line) => !line.includes("CONSTRAINT `fk_supplier_bank_"));
  // 拆走最後一條定義之後嗰個吊住嘅逗號。
  const last = lines.findLastIndex((line) => line.trim().endsWith(","));
  if (last >= 0 && lines[last + 1]?.startsWith(")")) lines[last] = lines[last].replace(/,\s*$/u, "");
  const template = lines.join("\n");

  const probe = async (mutate, expected, what) => {
    const ddl = mutate(template);
    // 一個冇改到嘢嘅 mutation 會建出一張**啱**嘅表，然後喺 FK 檢查度死，而嗰個
    // 錯誤同我哋期望嘅未必啱 —— 更差嘅情況係啱，咁就變成一個永遠綠嘅 case。
    // CI 就係咁揾到嘅：本機 SHOW CREATE TABLE 帶住 COLLATE 子句而 CI 冇，所以
    // 一個夾死 collation 嘅 anchor 靜靜哋冇替換到。
    assert.notEqual(ddl, template, `the mutation must actually change the DDL: ${what}`);
    await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    await connection.query(ddl);
    let thrown = null;
    try {
      await inspectSupplierBankAccountSchema(connection, { table });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, `an incompatible table must be rejected: ${what}`);
    assert.match(thrown.message, expected, what);
  };

  // 對照組：一張完全照抄、只係冇 FK 嘅表。佢要**啱啱好**喺 FK 檢查度死，唔係早過
  // 亦唔係遲過。呢一句同時證兩件事：FK 名真係有人查，而下面每個 case 嘅紅係嚟自
  // 佢自己嗰個改動，唔係嚟自「複製表本身就過唔到」。
  // 對照組唔經 probe()：佢刻意乜都唔改，所以過唔到上面嗰個「一定要改到嘢」守衛。
  await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
  await connection.query(template);
  let control = null;
  try {
    await inspectSupplierBankAccountSchema(connection, { table });
  } catch (error) {
    control = error;
  }
  assert.ok(control, "a copy without the FK names must be rejected");
  assert.match(control.message, /Incompatible existing Supplier bank account FK: fk_supplier_bank_supplier/u,
    "the unmodified copy must stop exactly at the FK check, or every case below proves nothing");

  await probe(
    (ddl) => ddl.replace("`account_iv` binary(12)", "`account_iv` varchar(12)"),
    /account_iv must be BINARY\(12\)/u,
    "a VARCHAR IV silently truncates and compares by collation"
  );
  await probe(
    (ddl) => ddl.replace("`account_ciphertext` varbinary(512)", "`account_ciphertext` varbinary(256)"),
    /account_ciphertext must be VARBINARY\(512\)/u,
    "a shorter ciphertext column truncates"
  );
  await probe(
    // 個生成運算式入面有巢狀括號，所以逐行換成一個普通可寫欄位，唔用 regex 夾。
    (ddl) => ddl.split("\n")
      // 只換欄位定義嗰行：`default_slot` 亦都出現喺 uq_supplier_bank_default 嗰條
      // 索引定義入面，一齊換就會整出一張建唔成嘅表。
      .map((line) => (line.trim().startsWith("`default_slot`") ? "  `default_slot` tinyint DEFAULT NULL," : line))
      .join("\n"),
    /default_slot is not a generated column/u,
    "a writable slot moves the one-default guarantee back into the application"
  );
  await probe(
    (ddl) => ddl.replace(`UNIQUE KEY \`uq_supplier_bank_default\``, `KEY \`uq_supplier_bank_default\``),
    /uq_supplier_bank_default must be UNIQUE/u,
    "a same-named non-unique index enforces nothing"
  );
  await probe(
    // 逐行插入，唔夾 collation 子句：CI 同本機嘅 SHOW CREATE TABLE 輸出唔一定
    // 一樣，而一個夾死咗嘅 anchor 會靜靜哋冇替換到。
    (ddl) => ddl.split("\n")
      .flatMap((line) => (line.trim().startsWith("`last_four`")
        ? [line, "  `account_number` varchar(64) DEFAULT NULL,"]
        : [line]))
      .join("\n"),
    // 唔用 alternation：一個 `A|B` 嘅期望喺兩邊都過，即係佢乜都冇分辨到。擋住明文
    // 欄位嘅係上面嗰個集合相等比較，所以期望嘅就係佢嗰句。
    /Incompatible existing Supplier bank account schema: supplier_bank_accounts/u,
    "a plaintext account column must never be tolerated"
  );
});
