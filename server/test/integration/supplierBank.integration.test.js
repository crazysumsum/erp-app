import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { normalizeSupplierConfig } from "../../src/modules/supplier/normalizeSupplierConfig.js";
import { SupplierAuditLogService } from "../../src/modules/supplier/SupplierAuditLogService.js";
import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";

/**
 * 假連線用 `sql.includes(...)` 派送，所以一個打錯咗嘅欄位名、一個唔啱嘅 binary 長度、
 * 或者一條唔生效嘅鎖，全部照樣「成功」。呢個檔案打真 MySQL。
 *
 * 最重要嗰個測試係 §「明文邊度都唔應該出現」—— T33 個驗收條件寫住「Manual DB check：
 * fixture 明文在 Bank table、audit 及 system log 搜尋結果為 0」。一個人手檢查唔會每次
 * 都做，所以呢度改成自動：逐個欄位掃，唔靠記得。
 */

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

// 一個獨特到唔會撞任何嘢嘅明文，咁「掃唔掃到佢」先至有意義。
const SECRET = `77${randomUUID().replace(/-/gu, "").slice(0, 14).toUpperCase()}`;

function config() {
  return {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  };
}

function buildCrypto(lookupIds = ["look-1"]) {
  const normalized = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: JSON.stringify({ "enc-1": randomBytes(32).toString("base64") }) },
    bankLookup: {
      activeKeyId: lookupIds[0],
      keyRing: JSON.stringify(Object.fromEntries(lookupIds.map((id) => [id, randomBytes(32).toString("base64")])))
    }
  });
  return new SupplierBankCrypto({ encryption: normalized.bankEncryption, lookup: normalized.bankLookup });
}

function serviceOn(connection, { crypto, permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"], realAudit = false } = {}) {
  const database = {
    query: (sql, params) => connection.query(sql, params),
    async withTransaction(work) {
      await connection.beginTransaction();
      try {
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  };
  const logger = { warn() {} };
  const time = { nowMs: () => Date.now() };
  const authorize = async () => ({ id: null, username: "integration", permissions });
  return new SupplierBankService({
    database, logger, time, crypto, authorize,
    // 真嘅 recorder 執行 action prefix、detail key 白名單、敏感欄位檢查同 8KB 上限。
    audit: realAudit
      ? new SupplierAuditLogService({ database, logger, time, authorize })
      : { async record(txn, input) {
        await txn.execute(
          `INSERT INTO supplier_audit_logs (occurred_at, actor_user_id, actor_username, action, target_type,
             target_id, supplier_id, target_label, reason, detail, request_id, ip)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [Date.now(), input.actorUsername, input.action, input.targetType, input.targetId, input.supplierId,
            input.targetLabel, input.reason, JSON.stringify(input.detail), input.requestId ?? "", input.ip ?? ""]
        );
      } }
  });
}

async function seedSupplier(connection, suffix) {
  const [[currency]] = await connection.query("SELECT code FROM currencies LIMIT 1");
  const now = Date.now();
  const [supplier] = await connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`BNKS-${suffix}`, `bnks-${suffix}`, `Bank Service ${suffix}`, `bank service ${suffix}`,
      currency.code ?? currency.CODE, now, now]
  );
  return { supplierId: Number(supplier.insertId), currency: currency.code ?? currency.CODE };
}

async function cleanup(connection, supplierIds) {
  for (const supplierId of supplierIds.filter(Boolean)) {
    await connection.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [supplierId]);
    await connection.execute("DELETE FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]);
    await connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
  }
}

const actor = { actorId: null, claimedRoles: [], claimedPermissions: ["supplier.bank.mgmt"], requestId: "req-bank", ip: "127.0.0.1" };
const details = {
  accountHolderName: "Example Supplier Limited", bankName: "Example Bank",
  bankCountryCode: "HK", bankCode: "999", branchCode: "001", swiftBic: "EXAMPLEHH"
};

integrationTest("create really writes every column, and the encrypted ones are binary of the right width", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const service = serviceOn(connection, { crypto: buildCrypto() });
  const created = await service.create({
    ...actor, ...details, accountCurrencyCode: seeded.currency, supplierId,
    accountNumber: `${SECRET.slice(0, 4)}-${SECRET.slice(4)}`, isDefault: true, reason: "整合測試新增收款帳戶"
  });

  assert.equal(created.isDefault, true);
  assert.equal(created.version, 1);
  const [[row]] = await connection.query("SELECT * FROM supplier_bank_accounts WHERE id = ?", [created.id]);
  assert.equal(row.account_iv.length, 12, "96-bit IV survives the round trip through BINARY(12)");
  assert.equal(row.account_auth_tag.length, 16);
  assert.equal(row.account_blind_index.length, 32);
  assert.equal(Number(row.account_length), SECRET.length, "the stored length is the normalized one");
  assert.equal(row.last_four, SECRET.slice(-4));
  assert.equal(Number(row.default_slot), 1, "an active default takes the generated slot");
});

integrationTest("the plaintext account appears in no column of the Bank table or the audit log", async (t) => {
  // T33 驗收要求嘅「Manual DB check」。人手做嘅檢查唔會每次都做，所以逐個欄位掃。
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  // 真嘅 audit recorder，因為佢個 detail 白名單同敏感欄位檢查係呢個斷言嘅一部分。
  const service = serviceOn(connection, { crypto: buildCrypto(), realAudit: true });
  const created = await service.create({
    ...actor, ...details, supplierId, accountNumber: SECRET, reason: "整合測試明文掃描"
  });
  await service.update({
    ...actor, ...details, supplierId, bankAccountId: created.id, version: created.version,
    accountNumber: `${SECRET.slice(0, 6)} ${SECRET.slice(6)}`, reason: "整合測試重新加密"
  });

  const scan = async (table, where, params) => {
    const [columns] = await connection.query(
      `SELECT column_name AS column_name FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?`, [table]
    );
    const names = columns.map((column) => column.column_name ?? column.COLUMN_NAME);
    const [rows] = await connection.query(`SELECT * FROM ${table} WHERE ${where}`, params);
    const hits = [];
    for (const row of rows) {
      for (const name of names) {
        const value = row[name];
        if (value === null || value === undefined) continue;
        const text = Buffer.isBuffer(value) ? value.toString("latin1") : String(value);
        if (text.includes(SECRET)) hits.push(`${table}.${name}`);
      }
    }
    return hits;
  };

  assert.deepEqual(await scan("supplier_bank_accounts", "supplier_id = ?", [supplierId]), [],
    "no column of the Bank table may contain the account");
  assert.deepEqual(await scan("supplier_audit_logs", "supplier_id = ?", [supplierId]), [],
    "and no column of the audit log either");

  // 對照組：個掃描器要真係揾得到嘢，否則上面兩句係空話。
  //
  // REV-035 M-4：種落 **VARBINARY** 嗰條分支，唔係文字欄位。成個驗收倚賴嘅係「密文
  // 欄位入面冇明文」，而如果個掃描器對 Buffer 嗰條路壞咗，種落文字欄位嘅對照組一樣
  // 會綠 —— 即係對照組結構上證唔到最重要嗰半。
  await connection.execute(
    "UPDATE supplier_bank_accounts SET account_ciphertext = ?, account_holder_name = ? WHERE id = ?",
    [Buffer.from(SECRET, "utf8"), SECRET, created.id]
  );
  assert.deepEqual((await scan("supplier_bank_accounts", "supplier_id = ?", [supplierId])).sort(),
    ["supplier_bank_accounts.account_ciphertext", "supplier_bank_accounts.account_holder_name"],
    "the scanner finds a planted plaintext in both a binary and a text column, so the assertions above are not vacuous");
});

integrationTest("the database refuses a second active default even if the service is bypassed", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const crypto = buildCrypto();
  const service = serviceOn(connection, { crypto });
  const first = await service.create({ ...actor, ...details, supplierId, accountNumber: SECRET, isDefault: true, reason: "整合測試第一個預設" });

  const sealed = crypto.encryptAccountNumber({ supplierId, cryptoContext: crypto.newCryptoContext(), accountNumber: "9999888877776666" });
  const index = crypto.blindIndex("9999888877776666");
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO supplier_bank_accounts
        (supplier_id, crypto_context, account_holder_name, bank_name, account_ciphertext, account_iv,
         account_auth_tag, encryption_key_id, account_blind_index, blind_index_key_id, last_four,
         account_length, is_default, created_at, updated_at)
       VALUES (?, ?, 'X', 'Y', ?, ?, ?, ?, ?, ?, '6666', 16, 1, ?, ?)`,
      [supplierId, crypto.newCryptoContext(), sealed.ciphertext, sealed.iv, sealed.authTag,
        sealed.encryptionKeyId, index.index, index.keyId, Date.now(), Date.now()]
    ),
    (error) => error.code === "ER_DUP_ENTRY",
    "uq_supplier_bank_default is the backstop under a race, not the service's own clearing"
  );
  assert.equal(first.isDefault, true);
});

integrationTest("switching the default clears the old one, and deactivating frees the slot", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const service = serviceOn(connection, { crypto: buildCrypto() });
  const first = await service.create({ ...actor, ...details, supplierId, accountNumber: SECRET, isDefault: true, reason: "整合測試第一個帳戶" });
  const second = await service.create({ ...actor, ...details, supplierId, accountNumber: "5555444433332222", reason: "整合測試第二個帳戶" });

  const promoted = await service.setDefault({ ...actor, supplierId, bankAccountId: second.id, version: second.version, reason: "整合測試切換預設" });
  assert.equal(promoted.isDefault, true);
  const [slots] = await connection.query(
    "SELECT id, is_default, default_slot FROM supplier_bank_accounts WHERE supplier_id = ? ORDER BY id", [supplierId]
  );
  assert.deepEqual(slots.map((row) => Number(row.is_default)), [0, 1], "the old default was cleared in the same transaction");
  assert.equal(slots.filter((row) => row.default_slot !== null).length, 1);

  const [[current]] = await connection.query("SELECT version FROM supplier_bank_accounts WHERE id = ?", [second.id]);
  const gone = await service.deactivate({ ...actor, supplierId, bankAccountId: second.id, version: Number(current.version), reason: "整合測試停用帳戶" });
  assert.equal(gone.status, "inactive");
  assert.equal(gone.isDefault, false);
  const [[after]] = await connection.query("SELECT default_slot FROM supplier_bank_accounts WHERE id = ?", [second.id]);
  assert.equal(after.default_slot, null, "a deactivated account releases the slot for the next default");

  // 而第一個帳戶可以重新做預設 —— 個 slot 真係放咗出嚟。
  const [[firstRow]] = await connection.query("SELECT version FROM supplier_bank_accounts WHERE id = ?", [first.id]);
  const restored = await service.setDefault({ ...actor, supplierId, bankAccountId: first.id, version: Number(firstRow.version), reason: "整合測試重設預設" });
  assert.equal(restored.isDefault, true);
});

integrationTest("two concurrent default switches leave exactly one default", async (t) => {
  // 服務層自己清舊 default 只喺佢見到嗰一刻啱；真正嘅保證係資料庫嗰條 unique slot
  // 加上 §2.6 嘅鎖序。兩條連線同時撳，唔可以兩個都成功。
  const setup = await mysql.createConnection(config());
  const left = await mysql.createConnection(config());
  const right = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => {
    await cleanup(setup, [supplierId]);
    await left.end(); await right.end(); await setup.end();
  });

  const seeded = await seedSupplier(setup, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const crypto = buildCrypto();
  const seed = serviceOn(setup, { crypto });
  const a = await seed.create({ ...actor, ...details, supplierId, accountNumber: SECRET, reason: "整合測試併發帳戶甲" });
  const b = await seed.create({ ...actor, ...details, supplierId, accountNumber: "1111222233334444", reason: "整合測試併發帳戶乙" });

  const promote = (connection, account) => serviceOn(connection, { crypto }).setDefault({
    ...actor, supplierId, bankAccountId: account.id, version: account.version, reason: "整合測試併發切換預設"
  }).then(() => ({ ok: true }), (error) => ({ ok: false, code: error.publicCode ?? error.code ?? error.message }));

  const outcomes = await Promise.all([promote(left, a), promote(right, b)]);
  assert.ok(outcomes.some((outcome) => outcome.ok), `at least one switch must succeed: ${JSON.stringify(outcomes)}`);

  const [rows] = await setup.query(
    "SELECT COUNT(default_slot) AS taken FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]
  );
  assert.ok(Number(rows[0].taken ?? rows[0].TAKEN) <= 1, "never two defaults, whatever the interleaving");
});

integrationTest("the same account twice under one Supplier is refused by the database as well as the service", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  let otherId = null;
  t.after(async () => { await cleanup(connection, [supplierId, otherId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const other = await seedSupplier(connection, randomUUID().slice(0, 8));
  otherId = other.supplierId;
  const service = serviceOn(connection, { crypto: buildCrypto() });
  await service.create({ ...actor, ...details, supplierId, accountNumber: SECRET, reason: "整合測試查重第一次" });

  await assert.rejects(
    () => service.create({ ...actor, ...details, supplierId, accountNumber: `${SECRET.slice(0, 4)} ${SECRET.slice(4)}`, reason: "整合測試查重第二次" }),
    (error) => error.publicCode === "BANK_ACCOUNT_DUPLICATE",
    "a reformatted repeat of the same account is the same account"
  );

  // 另一個 Supplier 用同一個帳號：只係 warning，唔會擋，亦都唔會回對方嘅帳號。
  const warned = await service.create({ ...actor, ...details, supplierId: otherId, accountNumber: SECRET, reason: "整合測試跨供應商重覆" });
  assert.equal(warned.warnings.length, 1);
  assert.equal(warned.warnings[0].code, "BANK_ACCOUNT_DUPLICATE_OTHER_SUPPLIER");
  assert.ok(!JSON.stringify(warned).includes(SECRET));
});

integrationTest("reveal round-trips through real MySQL and leaves an audit row behind", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const service = serviceOn(connection, { crypto: buildCrypto(), realAudit: true });
  const created = await service.create({
    ...actor, ...details, supplierId, accountNumber: `${SECRET.slice(0, 4)}-${SECRET.slice(4)}`, reason: "整合測試建立以供查看"
  });

  const revealed = await service.reveal({ ...actor, supplierId, bankAccountId: created.id, reason: "整合測試查看完整帳號" });
  assert.equal(revealed.accountNumber, SECRET, "the ciphertext survived VARBINARY(512) and decrypted to the normalized account");

  const [[audit]] = await connection.query(
    "SELECT action, detail FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier.bank.reveal'", [supplierId]
  );
  assert.ok(audit, "a reveal must leave a record");
  const detail = typeof audit.detail === "string" ? JSON.parse(audit.detail) : audit.detail;
  assert.deepEqual(detail, { after: { revealed: true } });
});

integrationTest("a row moved to another Supplier cannot be revealed, because the AAD is bound to the owner", async (t) => {
  // 設計 §5.8 講 AAD 綁 supplierId 就係為咗呢個：一個攞到資料庫寫入權但攞唔到 key
  // 嘅人，唔可以將 A 公司嘅帳號移花接木做 B 公司嘅。呢度用真 row 證。
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  let otherId = null;
  t.after(async () => { await cleanup(connection, [supplierId, otherId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const other = await seedSupplier(connection, randomUUID().slice(0, 8));
  otherId = other.supplierId;
  const service = serviceOn(connection, { crypto: buildCrypto(), realAudit: true });
  const created = await service.create({ ...actor, ...details, supplierId, accountNumber: SECRET, reason: "整合測試搬移前建立" });

  await connection.execute("UPDATE supplier_bank_accounts SET supplier_id = ? WHERE id = ?", [otherId, created.id]);
  // REV-035：解密失敗要係一個具名 422，唔係一個匿名 500 —— 日誌要分得出「資料被改
  // 過」同「條 key 唔喺 ring 入面」。
  await assert.rejects(
    () => service.reveal({ ...actor, supplierId: otherId, bankAccountId: created.id, reason: "整合測試搬移後查看" }),
    (error) => error.statusCode === 422 && error.publicCode === "BANK_ACCOUNT_UNREADABLE"
  );
  const [audits] = await connection.query(
    "SELECT id FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier.bank.reveal'", [otherId]
  );
  assert.equal(audits.length, 0, "a failed decrypt must not leave an audit row claiming a reveal");
});
