import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

import { normalizeSupplierConfig } from "../../src/modules/supplier/normalizeSupplierConfig.js";
import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";

/**
 * TC-077（§6.7 `BANK-016`）—— Bank backup／restore。NFR-009、SEC-010。
 *
 * 個案講得好明：**三種** restore，各自啟動同 reveal 一次 —— 完整 DB 加 key ring、
 * 只有 DB、同錯 key。預期係「DB＋正確 keys 可還原；缺／錯 key fail closed；不以
 * 移除 key 回應」。
 *
 * ## 呢度嘅隔離去到邊
 *
 * Restore target 係**同一個 MySQL 實例上面一個全新 schema**，由 `mysqldump` 導出
 * 再 load 入去。佢唔係一部獨立機、唔係一份獨立 my.cnf、亦都唔覆蓋作業系統層面嘅
 * 還原。佢覆蓋嘅係呢個案例真正要問嗰件事：**一份備份出嚟嘅資料，配唔同嘅 key ring
 * 之後，解唔解得返。** 完整嘅 OPS-006（TC-133，全模組 backup/restore 連檔案同 15
 * 分鐘 transaction marker）唔喺呢個案例範圍，亦都未有 harness。
 *
 * ## 對照組
 *
 * 「缺 key 會 fail closed」如果冇一個**成功**嘅 restore 行喺隔籬，就係一句空話 ——
 * 一個乜都解唔到嘅 harness 會令三個情境全部「fail closed」，而三條斷言全部綠。所以
 * 第一個情境要求真係攞返個明文；佢係另外兩個情境嘅前提。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const MYSQL_BIN = process.env.MYSQL_BIN ?? "/usr/local/mysql/bin";

/**
 * 建立／剷 schema 要一個 admin 帳號 —— CI 上面 `erp_user` 只得 `erp_dev` 嘅權限
 * （MySQL service image 淨係 grant 嗰一個 database）。跟 `itemRecoveryAcceptance`
 * 嗰條既有慣例：`DB_ADMIN_*`，喺 GitHub Actions 上面 fallback 去 root/root。
 */
function adminOptions() {
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  return {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_ADMIN_USER ?? (githubActions ? "root" : undefined),
    password: process.env.DB_ADMIN_PASSWORD ?? (githubActions ? "root" : undefined),
    multipleStatements: true
  };
}

/**
 * 備份／還原嘅搬運方式。
 *
 * `mysqldump` 先係真嘅備份格式 —— VARBINARY 密文經過 `--hex-blob` 再入返去，呢條
 * 路上面一個編碼錯誤就會靜靜雞毀掉密文，而嗰樣正正係呢個案例要問嘅嘢之一。但
 * runner 上面唔一定有 client binary。所以：**有就用真 dump，冇就用 SQL 複製**，
 * 兩條路做同樣三個判斷，而報告要講明今次行咗邊條。
 */
function dumpAvailable() {
  return spawnSync(`${MYSQL_BIN}/mysqldump`, ["--version"], { encoding: "utf8" }).status === 0;
}
const ACCOUNT = `66${randomUUID().replace(/-/gu, "").slice(0, 14).toUpperCase()}`;

function config(database = process.env.DB_NAME) {
  return {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database,
    multipleStatements: true
  };
}

/** 一個 ring 一組 key material；`overrides` 可以換走或者剷走其中一個 id。 */
function cryptoWith({ encryption, lookup }) {
  const normalized = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: Object.keys(encryption)[0], keyRing: JSON.stringify(encryption) },
    bankLookup: { activeKeyId: Object.keys(lookup)[0], keyRing: JSON.stringify(lookup) }
  });
  return new SupplierBankCrypto({ encryption: normalized.bankEncryption, lookup: normalized.bankLookup });
}

function databaseOn(connection) {
  return {
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
}

function serviceOn(connection, crypto) {
  const permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"];
  return new SupplierBankService({
    database: databaseOn(connection),
    logger: { warn() {}, info() {}, error() {} },
    time: { nowMs: () => Date.now() },
    crypto,
    authorize: async () => ({ id: null, username: "restore-drill", permissions }),
    audit: { async record(txn, input) {
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
       default_currency_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`RST-${suffix}`, `rst-${suffix}`, `Restore ${suffix}`, `restore ${suffix}`,
      currency.code ?? currency.CODE, now, now]
  );
  return Number(supplier.insertId);
}

const actor = {
  actorId: null, claimedRoles: [], claimedPermissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"],
  requestId: "req-restore", ip: "127.0.0.1"
};
const details = { accountHolderName: "Restore Holder", bankName: "Restore Bank" };

integrationTest("TC-077 (BANK-016): a restored backup reveals with its key ring, and fails closed without it", async (t) => {
  const source = await mysql.createConnection(config());
  const options = adminOptions();
  assert.ok(options.user && options.password,
    "DB_ADMIN_USER / DB_ADMIN_PASSWORD are required: creating the restore schema needs more than the application account");
  const admin = await mysql.createConnection({ ...options, database: process.env.DB_NAME });
  const restoreName = `erp_restore_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
  let supplierId = null;
  let restored = null;
  t.after(async () => {
    if (restored) await restored.end();
    if (supplierId) {
      await source.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [supplierId]);
      await source.execute("DELETE FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]);
      await source.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
    }
    await admin.query(`DROP DATABASE IF EXISTS \`${restoreName}\``).catch(() => {});
    await admin.end().catch(() => {});
    await source.end();
  });

  // 一個真 ring：兩條 key，同生產一樣由 normalizer 出。
  const ENC = { "backup-enc": randomBytes(32).toString("base64") };
  const LOOK = { "backup-look": randomBytes(32).toString("base64") };
  const good = cryptoWith({ encryption: ENC, lookup: LOOK });

  supplierId = await seedSupplier(source, randomUUID().slice(0, 8));
  /**
   * **只有種資料呢一步**會重試。
   *
   * `node --test` 同時行幾個檔案，而隔籬個 `supplierBank.integration.test.js` 有
   * 一條特登造並發 default 切換嘅測試 —— 兩者撞埋，InnoDB 會回
   * `ER_LOCK_DEADLOCK`。呢個係共用同一個 schema 嘅測試之間嘅爭用，唔係呢個案例要
   * 問嗰件事（備份還原之後解唔解得返）。
   *
   * 重試**只**包住種資料。下面三個情境一句都冇包 —— 一個會偷偷重試嘅斷言，同冇
   * 斷言係一樣嘅。另外：service 把 deadlock 原樣拋返俾 caller 而唔係自己重試，
   * 呢件事記咗落驗收報告（REPORT_ONLY），唔喺呢度修。
   */
  let created = null;
  for (let attempt = 1; attempt <= 5 && created === null; attempt += 1) {
    try {
      created = await serviceOn(source, good).create({
        ...actor, ...details, supplierId, accountNumber: ACCOUNT, isDefault: true, reason: "TC-077 備份前種資料"
      });
    } catch (error) {
      const deadlock = error?.code === "ER_LOCK_DEADLOCK" || error?.cause?.code === "ER_LOCK_DEADLOCK"
        || String(error?.message ?? "").includes("Deadlock");
      if (!deadlock || attempt === 5) throw error;
      await new Promise((resolve) => { setTimeout(resolve, 50 * attempt); });
    }
  }
  assert.ok(created, "the fixture row must exist before anything can be backed up");

  // ---- 備份同還原 ----
  await admin.query(`CREATE DATABASE \`${restoreName}\` CHARACTER SET utf8mb4`);
  const transport = dumpAvailable() ? "mysqldump" : "sql-copy";
  if (transport === "sql-copy") {
    // 冇 client binary 嗰陣嘅退路：逐張表 `CREATE TABLE … LIKE` 加 `INSERT … SELECT`。
    // 佢搬得走資料，但**搬唔到 dump 格式本身** —— 所以佢係一個比較弱嘅版本，
    // 驗收報告要照講。呢條路跟 `itemRecoveryAcceptance` 嗰個做法。
    for (const table of ["suppliers", "supplier_bank_accounts", "supplier_audit_logs", "currencies"]) {
      await admin.query(`CREATE TABLE \`${restoreName}\`.\`${table}\` LIKE \`${process.env.DB_NAME}\`.\`${table}\``);
      // `SELECT *` 唔得：`supplier_bank_accounts` 有一條 generated column
      // （`default_slot`），寫落去會被 MySQL 拒（ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN）。
      // 真 `mysqldump` 自己識避開，SQL 複製呢條路要自己列欄位。
      const [columns] = await admin.query(
        `SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ? AND extra NOT LIKE '%GENERATED%'
          ORDER BY ordinal_position`, [process.env.DB_NAME, table]
      );
      const names = columns.map((column) => `\`${column.name ?? column.NAME}\``).join(", ");
      await admin.query(
        `INSERT INTO \`${restoreName}\`.\`${table}\` (${names}) SELECT ${names} FROM \`${process.env.DB_NAME}\`.\`${table}\``
      );
    }
  } else {
  const dump = spawnSync(`${MYSQL_BIN}/mysqldump`, [
    `--host=${options.host}`, `--port=${options.port}`,
    `--user=${options.user}`, `--password=${options.password}`,
    // `--set-gtid-purged=OFF`：restore target 同 source 喺同一個實例，而一個帶住
    // `SET @@GLOBAL.GTID_PURGED` 嘅 dump load 落同一部 server 會被拒
    // （ERROR 3546）。呢個係「同機還原」嘅代價，唔係資料嘅代價 —— 表結構同每
    // 一行都原封不動。
    "--set-gtid-purged=OFF", "--hex-blob", "--skip-lock-tables", "--routines", process.env.DB_NAME
  ], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  assert.equal(dump.status, 0, `the backup itself must succeed: ${dump.stderr}`);
  assert.ok(dump.stdout.includes("supplier_bank_accounts"), "the backup must contain the Bank table");

  const load = spawnSync(`${MYSQL_BIN}/mysql`, [
    `--host=${options.host}`, `--port=${options.port}`,
    `--user=${options.user}`, `--password=${options.password}`, restoreName
  ], { input: dump.stdout, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  assert.equal(load.status, 0, `the restore itself must succeed: ${load.stderr}`);
  }

  /**
   * 用 admin 帳號連還原出嚟嗰個 schema，唔係用 app 帳號。
   *
   * CI 上面 `erp_user` 只得 `erp_dev` 嘅權限 —— 一個新建嘅 schema 佢連都連唔入，
   * 報 `Access denied for user 'erp_user'@'%' to database 'erp_restore_…'`。呢個
   * case 問嘅係「備份出嚟嘅資料，配唔同 key ring 解唔解得返」，用邊個帳號連入去
   * 唔影響個答案；而一次真實嘅還原演練本來就係 admin 做。
   */
  restored = await mysql.createConnection({ ...options, database: restoreName });
  const [[row]] = await restored.query(
    "SELECT id, crypto_context, encryption_key_id, blind_index_key_id FROM supplier_bank_accounts WHERE id = ?", [created.id]
  );
  assert.ok(row, `the restored schema must actually contain the row (transport: ${transport})`);
  assert.equal(row.encryption_key_id, "backup-enc");

  const revealOn = (crypto) => serviceOn(restored, crypto).reveal({
    ...actor, supplierId, bankAccountId: created.id, reason: "TC-077 還原後查看"
  });

  // ---- 情境一：DB ＋ 正確 key ring。呢個係另外兩個嘅對照組。 ----
  const recovered = await revealOn(cryptoWith({ encryption: ENC, lookup: LOOK }));
  assert.equal(recovered.accountNumber, ACCOUNT,
    "a backup restored with its own key ring must give the account back — without this the two cases below are vacuous");

  // ---- 情境二：只有 DB，ring 入面冇嗰條 key ----
  const missing = cryptoWith({ encryption: { "other-enc": randomBytes(32).toString("base64") }, lookup: LOOK });
  await assert.rejects(() => revealOn(missing), (error) => {
    const serialised = `${error?.message ?? ""}${error?.stack ?? ""}${JSON.stringify(error?.details ?? null)}`;
    assert.ok(!serialised.includes(ACCOUNT), "a key-unavailable failure must not carry the account");
    assert.ok(error?.publicCode || error?.code, `the refusal must be coded, got ${serialised.slice(0, 120)}`);
    return true;
  }, "restoring the database without its key ring must fail closed, not return plaintext");

  /**
   * Service 層特登把「ring 冇嗰條 key」同「key 係錯嘅」收成同一個
   * `BANK_ACCOUNT_UNREADABLE` —— 唔話俾 caller 聽點解，係啱嘅。但代價係上面嗰句
   * 斷言分唔開兩者：我把 crypto 改成「ring 揾唔到就靜靜雞用 active key」（一個
   * 教科書式嘅 fail-open），佢照樣 fail closed，因為 GCM tag 一樣對唔上 ——
   * **個 mutant 生還咗。**
   *
   * 所以要落一層問。Crypto 係唯一一層分得開嘅，而「分得開」就係呢個案例要嘅嘢：
   * 缺 key 要因為**缺 key** 而拒絕，唔係因為順手試咗第二條 key 又啱撞唔到。
   */
  // `decryptAccountNumber` 係同步嘅，所以係 throws 唔係 rejects。
  assert.throws(
    () => missing.decryptAccountNumber({
      supplierId, cryptoContext: row.crypto_context ?? "", ciphertext: Buffer.alloc(32),
      iv: Buffer.alloc(12), authTag: Buffer.alloc(16), encryptionKeyId: "backup-enc"
    }),
    (error) => {
      assert.equal(error?.code, "BANK_KEY_NOT_IN_RING",
        "a key id that is not in the ring must be refused as such, not quietly retried against the active key");
      return true;
    },
    "the crypto layer must refuse an unknown key id by name"
  );

  // ---- 情境三：同一個 key id，錯嘅 material ----
  const wrong = cryptoWith({ encryption: { "backup-enc": randomBytes(32).toString("base64") }, lookup: LOOK });
  await assert.rejects(() => revealOn(wrong), (error) => {
    const serialised = `${error?.message ?? ""}${error?.stack ?? ""}${JSON.stringify(error?.details ?? null)}`;
    assert.ok(!serialised.includes(ACCOUNT), "a wrong-key failure must not carry the account");
    return true;
  }, "a wrong key of the right id must fail closed on the GCM tag, never return garbage as if it were an account");

  // 三個情境之後，還原出嚟嗰行一個 byte 都冇變 —— fail closed 唔可以係靠改資料做到。
  const [[after]] = await restored.query(
    "SELECT account_ciphertext, account_iv, account_auth_tag, encryption_key_id FROM supplier_bank_accounts WHERE id = ?",
    [created.id]
  );
  assert.deepEqual(after.encryption_key_id, row.encryption_key_id);
  assert.equal(after.account_ciphertext.length > 0, true, "the restored ciphertext is still there and untouched");
});
