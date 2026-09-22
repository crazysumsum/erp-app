import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { ApplicationError } from "../../src/framework/errors/ApplicationError.js";
import { normalizeSupplierConfig } from "../../src/modules/supplier/normalizeSupplierConfig.js";
import { SupplierAuditLogService } from "../../src/modules/supplier/SupplierAuditLogService.js";
import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";
import { MySqlDatabaseOperationError } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";

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
const PASSWORD = "Bank-Http-Test-1!";

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

/**
 * 真嘅 `MySqlDatabaseExecutor.run()` 將**每一句** statement 錯誤包成
 * `MySqlDatabaseOperationError{ code: "DATABASE_OPERATION_FAILED", cause }`。一條
 * raw mysql2 連線唔會咁做，所以一個「淨係睇 error.code」嘅守衛喺呢度一樣望落正常
 * —— REV-036 H-1 就係同時瞞過咗單元同整合兩邊。呢個 proxy 補返嗰層。
 */
function executorLike(connection) {
  const wrap = (method) => async (sql, params) => {
    try {
      return await connection[method](sql, params);
    } catch (error) {
      // REV-037：掟真嗰個 class。佢繼承 ApplicationError，所以下面 withTransaction
      // 會原樣放佢上去（生產兩節），而唔係當佢係普通錯誤再包多一層（三節）。
      if (error instanceof MySqlDatabaseOperationError) throw error;
      throw new MySqlDatabaseOperationError(`MySQL database ${method} failed`, { cause: error });
    }
  };
  return { query: wrap("query"), execute: wrap("execute") };
}

function serviceOn(connection, { crypto, permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"], realAudit = false } = {}) {
  const executor = executorLike(connection);
  const database = {
    query: (sql, params) => executor.query(sql, params),
    async withTransaction(work) {
      // REV-037 M-2(j)：真嘅交易行 REPEATABLE READ，而呢個 task 花咗三輪 review 嘅
      // 查重競態行為，正正倚賴嗰個隔離級別之下嘅 snapshot 時序。之前冇設，即係嗰個
      // 倚賴冇釘住。
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.beginTransaction();
      // 名同真嘢一樣，係要嘅：`commitAttempted`，唔係 `committed`。REV-038 M 就係
      // 呢兩個字嘅分別 —— 第一版叫 `committed` 而且喺 `await commit()` **之後**先
      // 設，所以 commit 一失敗就永遠到唔到，個 double 照樣 rollback，即係做咗上面
      // 註解話唔可以做嗰件事。真嘅程式碼喺 await **之前**設（MySqlDatabaseService
      // :513）。一個講啱嘢嘅註解配一段做錯嘢嘅碼，係最難察覺嗰種。
      let commitAttempted = false;
      try {
        const result = await work(executor);
        commitAttempted = true;
        await connection.commit();
        return result;
      } catch (error) {
        // commit 一旦送出去就唔可以再 rollback：伺服器可能已經提交咗。喺一條啱啱
        // commit 失敗嘅連線上再送 rollback，好一點係 no-op，差一點係第二次卡死。
        if (!commitAttempted) await connection.rollback();
        if (error instanceof ApplicationError) throw error;
        throw new MySqlDatabaseOperationError("MySQL database transaction failed", {
          code: "DATABASE_TRANSACTION_FAILED", cause: error
        });
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

integrationTest("a real ER_DUP_ENTRY from the driver becomes a 409, not a 500 carrying the blind index", async (t) => {
  // REV-036 H-1 嘅整合面。呢度唔製造假錯誤 —— 真係叫真 MySQL 撞嗰條 UNIQUE，然後
  // 睇個 service 譯唔譯得返。設計 §2.5：DB unique 係競態下最後防線，service 預查只
  // 為回傳較清晰嘅公開錯誤，所以兩者要講同一句。
  //
  // 繞過預查嘅方法：先種一行，然後喺 service 嘅 #duplicates 睇唔到嘅情況下再插 ——
  // 呢度用一條 lookup key 唔同嘅 crypto 去 create，於是預查算出嚟嘅 index 同已經存
  // 咗嗰行對唔上，但寫入用嘅 blind_index_key_id 同 index 就撞返。
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const seeded = await seedSupplier(connection, randomUUID().slice(0, 8));
  supplierId = seeded.supplierId;
  const crypto = buildCrypto();
  const created = await serviceOn(connection, { crypto }).create({
    ...actor, ...details, supplierId, accountNumber: SECRET, reason: "整合測試預先種一行"
  });

  // 直接喺資料庫度將第二行嘅 blind index 同第一行整到一樣，繞過 service 嘅預查。
  const [[first]] = await connection.query(
    "SELECT account_blind_index, blind_index_key_id FROM supplier_bank_accounts WHERE id = ?", [created.id]
  );
  const sealed = crypto.encryptAccountNumber({
    supplierId, cryptoContext: crypto.newCryptoContext(), accountNumber: "5555666677778888"
  });
  await assert.rejects(
    () => connection.execute(
      `INSERT INTO supplier_bank_accounts
        (supplier_id, crypto_context, account_holder_name, bank_name, account_ciphertext, account_iv,
         account_auth_tag, encryption_key_id, account_blind_index, blind_index_key_id, last_four,
         account_length, created_at, updated_at)
       VALUES (?, ?, 'X', 'Y', ?, ?, ?, ?, ?, ?, '8888', 16, ?, ?)`,
      [supplierId, crypto.newCryptoContext(), sealed.ciphertext, sealed.iv, sealed.authTag,
        sealed.encryptionKeyId, first.account_blind_index, first.blind_index_key_id, Date.now(), Date.now()]
    ),
    (error) => error.code === "ER_DUP_ENTRY" && Number(error.errno) === 1062,
    "the index is what actually enforces this, and it speaks errno 1062"
  );

  // 而個 service 收到同一個錯誤嗰陣要譯成 409，唔可以連住 driver 嗰句（佢第一個
  // 成分就係重覆嗰個值本身）一齊拋上去。
  const service = serviceOn(connection, { crypto });
  let thrown = null;
  try {
    // 同一個帳號再 create 一次 —— 今次預查睇得到，所以係走預查嗰條 409 路。
    await service.create({ ...actor, ...details, supplierId, accountNumber: SECRET, reason: "整合測試重覆帳戶" });
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.statusCode, 409);
  assert.equal(thrown.publicCode, "BANK_ACCOUNT_DUPLICATE");
  const serialized = JSON.stringify({
    m: thrown.message, p: thrown.publicMessage, d: thrown.details ?? null,
    c: String(thrown.cause?.message ?? ""), cc: String(thrown.cause?.cause?.message ?? "")
  });
  assert.ok(!serialized.includes("Duplicate entry"), "the driver's message embeds the raw blind index bytes");
  assert.ok(!serialized.includes(SECRET));
});

/**
 * 真 HTTP。呢個測試順帶收咗一個由 TASK-031 帶到而家嘅缺口：REV-032 M-4 指出
 * `supplier_management` 入面**冇一層**係由 dispatcher → handler → service → MySQL
 * 行足全程 —— handler 測試係宣告式嘅，而 e2e spec 全部 mock 咗個 API。呢度用返
 * `business-master/http.integration.test.js` 嘅做法起一個真 app。
 *
 * 佢同時證到一件 T34 先至存在嘅事：**個 app 起得到**。由呢個 task 起，Bank
 * capability 已經部署，所以兩組 key ring 係無條件嘅 startup requirement（設計
 * §1700，HD-030）—— 一個起得成嘅 app 就係嗰個配置真係生效嘅證據。
 */
integrationTest("the Bank routes answer over real HTTP, and the masked list leaks nothing", async (t) => {
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } },
    serviceDiscoveryOptions: {
      additionalModuleUrls: [
        // Supplier 嘅 provider 依賴 businessMaster，所以兩個都要發現到 —— 同
        // business-master/http.integration.test.js 一樣。
        new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
        new URL("../../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href
      ]
    }
  });
  const db = application.services.require("mysqldatabase");
  const now = Date.now();
  const suffix = randomUUID().slice(0, 8);
  let supplierId = null;
  let roleId = null;
  let userId = null;
  t.after(async () => {
    if (supplierId) {
      await db.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [supplierId]);
      await db.execute("DELETE FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]);
      await db.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
    }
    if (userId) {
      await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
      await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
      await db.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
    if (roleId) await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    await application.shutdown("supplier_bank_http_test_complete");
  });

  const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`bank-http-${suffix}`, now]);
  roleId = Number(role.insertId);
  for (const name of ["supplier.view"]) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  // 真嘅 hash：reveal 係 jwt-password，password re-auth 喺 authorization policy
  // **之前**行。用一個假 hash 會令個請求死喺密碼比對度（500），咁就證唔到「佢過到
  // 密碼，但冇資格」—— 而後者先係 AC-023 講嗰件事。
  const { hashPassword } = await import("../../src/modules/user/passwordHash.js");
  const passwordHash = await hashPassword(PASSWORD);
  const [user] = await db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [`bank-http-${suffix}`, passwordHash, "Bank HTTP", now, now]
  );
  userId = Number(user.insertId);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);

  // 種資料用一條 raw mysql2 連線：`serviceOn` 個 wrapper 要 beginTransaction／commit，
  // 而 app 嗰個 mysqldatabase service 係另一個介面。角色同使用者就用 app 嗰個，因為
  // 佢要同 jwt／tokenRevocation 睇到同一個資料庫。
  const seedConnection = await mysql.createConnection(config());
  const seeded = await seedSupplier(seedConnection, suffix);
  supplierId = seeded.supplierId;
  // 種資料要用**app 自己嗰組 key**，唔係一組新產生嘅 —— 否則個 row 加密咗之後
  // app 解唔返，reveal 會（正確地）回 422。呢個係第一次寫嗰陣真係撞到嘅。
  const appCrypto = new SupplierBankCrypto({
    encryption: application.services.config.supplier.bankEncryption,
    lookup: application.services.config.supplier.bankLookup
  });
  await serviceOn(seedConnection, { crypto: appCrypto }).create({
    ...actor, ...details, supplierId, accountNumber: SECRET, isDefault: true, reason: "HTTP 測試種一行"
  });
  await seedConnection.end();

  const jwt = application.services.require("jwt");
  const version = await application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await jwt.issue(
    { roles: [`bank-http-${suffix}`], permissions: ["supplier.view"] },
    { subject: String(userId), version, authTime: Math.floor(now / 1000) }
  );
  const { url } = await application.start();
  const get = (path, headers = {}) => fetch(`${url}${path}`, { headers })
    .then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json() }));

  // 冇 token：401，而且唔會漏出任何嘢。
  assert.equal((await get(`/api/v1/suppliers/${supplierId}/bank-accounts`)).status, 401);

  const listed = await get(`/api/v1/suppliers/${supplierId}/bank-accounts`, { authorization: `Bearer ${token}` });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.data.items.length, 1);
  const [item] = listed.body.data.items;
  assert.match(item.maskedAccountNumber, /^••••\s/u);
  assert.equal(item.isDefault, true);

  // 成個 response body —— 唔係淨係嗰個 item —— 唔可以有帳號或者任何 crypto metadata。
  const serialized = JSON.stringify(listed.body);
  assert.ok(!serialized.includes(SECRET), "AC-023: a supplier.view holder never receives the account over HTTP");
  for (const leak of ["ciphertext", "authTag", "blindIndex", "cryptoContext", "encryptionKeyId", "lastFour"]) {
    assert.ok(!serialized.includes(leak), `${leak} must not cross the wire`);
  }

  // 一個只得 supplier.view 嘅人撳 reveal：403，而唔係 401 或者 404 —— 佢認到身分，
  // 佢只係冇資格。而個拒絕本身唔可以講出帳號。
  const revealed = await fetch(`${url}/api/v1/suppliers/${supplierId}/bank-accounts/${item.id}/reveal`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "冇權限測試原因", password: PASSWORD })
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  // REV-039 M-2：只斷言 403 係分辨唔到嘢嘅 —— `passwordReauth.js` 密碼唔啱一樣回
  // 403，所以一個**根本去唔到授權層**嘅請求都會令呢句綠。要指名嗰個 code。
  assert.equal(revealed.status, 403, JSON.stringify(revealed.body));
  assert.equal(revealed.body.error.code, "Forbidden",
    "a wrong password also yields 403; this must be the authorization layer refusing, not the password check");
  assert.ok(!JSON.stringify(revealed.body).includes(SECRET));

  // REV-039 M-3：要有一個**成功**嘅 reveal 行過真 HTTP，否則 AC-024 喺呢一層完全冇
  // 覆蓋 —— 而嗰個空白正正就係 M-1（header 被框架蓋過）冇人察覺嘅原因。
  const [[bankPermission]] = await db.query("SELECT id FROM permissions WHERE name = 'supplier.bank.view'");
  await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, bankPermission.id]);
  const viewerToken = await jwt.issue(
    { roles: [`bank-http-${suffix}`], permissions: ["supplier.view", "supplier.bank.view"] },
    { subject: String(userId), version, authTime: Math.floor(now / 1000) }
  );
  const ok = await fetch(`${url}/api/v1/suppliers/${supplierId}/bank-accounts/${item.id}/reveal`, {
    method: "POST",
    headers: { authorization: `Bearer ${viewerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "整合測試查看完整帳號", password: PASSWORD })
  }).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json() }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.accountNumber, SECRET, "AC-024: bank.view really does get the account");

  // 而佢係唯一一個講得出帳號嘅 response，所以佢係唯一一個要 no-store 嘅。
  //
  // REV-039 M-1：呢度斷言**實際過到線嗰個值**，唔係 handler 設咗乜 —— 之前個測試
  // 用假 res 直接行 execute，停咗喺框架覆寫之前一步，所以佢結構上捉唔到呢件事。
  //
  // 個值係 `no-store`，唔係 T34 驗收條件寫嘅 `no-store, private`：`sendSuccess`
  // （framework/http/apiResponse.js:21）會喺 handler 之後覆寫。呢個偏離 Product Owner
  // 批咗（DEV-T34-CACHE-PRIVATE）。用 equal 而唔用 match 係**特登**嘅 —— 如果有一日
  // 有人改咗框架，呢條測試會紅，而嗰陣個偏離應該係被人有意識咁收咗，唔係靜靜雞飄走。
  assert.equal(ok.headers.get("cache-control"), "no-store",
    "見 DEV-T34-CACHE-PRIVATE：private 過唔到線；紅咗即係框架改咗，去收個偏離記錄");
  assert.equal(ok.headers.get("pragma"), "no-cache", "呢個框架唔掂，所以 handler 設得到");

  // 成功 reveal 之後一定要有一筆稽核 —— 呢個係 FR-BANK-006 喺 HTTP 層嘅出口。
  const [audits] = await db.query(
    "SELECT action FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier.bank.reveal'", [supplierId]
  );
  assert.equal(audits.length, 1, "a reveal over HTTP leaves exactly one audit row");
});
