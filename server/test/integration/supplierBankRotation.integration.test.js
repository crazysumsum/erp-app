import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { normalizeSupplierConfig } from "../../src/modules/supplier/normalizeSupplierConfig.js";
import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";
import { ROTATION_KINDS, remainingRows, runRotation } from "../../src/modules/supplier/bankKeyRotation.js";

/**
 * TASK-036 嘅整合面。單元測試嗰邊個假資料庫而家會讀 SET 子句，但佢仍然唔係 MySQL ——
 * 佢唔知 VARBINARY 嘅長度、唔知 `uq_supplier_bank_blind_index` 呢條 UNIQUE、亦都唔會
 * 因為一個打錯咗嘅欄位名而失敗。呢個檔案打真 MySQL。
 *
 * 最緊要嗰條係「輪替途中查重唔可以開」：設計 §5.8 要求 service 對 ring 入面每條 key
 * 計 candidate index，正正係為咗令「換咗 key ID」唔會變成一條繞過重覆檢查嘅路。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

const ACCOUNT = `88${randomUUID().replace(/-/gu, "").slice(0, 14).toUpperCase()}`;

function config() {
  return {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  };
}

/** 兩個 ring 都由真 normalizer 出，同生產一模一樣嘅形狀。 */
function buildCrypto({ encActive, encIds, lookActive, lookIds }) {
  const ring = (ids) => JSON.stringify(Object.fromEntries(ids.map((id) => [id, randomBytes(32).toString("base64")])));
  const normalized = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: encActive, keyRing: ring(encIds) },
    bankLookup: { activeKeyId: lookActive, keyRing: ring(lookIds) }
  });
  return normalized;
}

/**
 * 同一組 key material，兩個唔同 active key。輪替之前用 `before`，之後用 `after` ——
 * 兩者共用同一個 ring，所以 `after` 解得返 `before` 寫嘅嘢，正如生產一樣。
 */
function cryptoPair({ encIds = ["enc-old", "enc-new"], lookIds = ["look-old", "look-new"] } = {}) {
  const normalized = buildCrypto({ encActive: encIds[0], encIds, lookActive: lookIds[0], lookIds });
  const swap = (section, activeKeyId) => ({ activeKeyId, keyRing: section.keyRing });
  return {
    before: new SupplierBankCrypto({ encryption: normalized.bankEncryption, lookup: normalized.bankLookup }),
    afterEncryption: new SupplierBankCrypto({
      encryption: swap(normalized.bankEncryption, encIds[1]), lookup: normalized.bankLookup
    }),
    afterLookup: new SupplierBankCrypto({
      encryption: normalized.bankEncryption, lookup: swap(normalized.bankLookup, lookIds[1])
    })
  };
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

/**
 * 同 `supplierBank.integration.test.js` 一樣嘅形狀 —— 特別係 `authorize` 係一個注入
 * 嘅 function，唔係一個 `directory` 物件。第一次我寫咗後者，而 service 照樣去
 * 資料庫度重讀 actor，結果拋 PERMISSION_STALE 而唔係我想測嗰個查重錯誤。
 */
function serviceOn(connection, crypto) {
  const database = databaseOn(connection);
  const permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"];
  return new SupplierBankService({
    database,
    logger: { warn() {} },
    time: { nowMs: () => Date.now() },
    crypto,
    authorize: async () => ({ id: null, username: "rotation", permissions }),
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
       default_currency_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`BNKR-${suffix}`, `bnkr-${suffix}`, `Bank Rotation ${suffix}`, `bank rotation ${suffix}`,
      currency.code ?? currency.CODE, now, now]
  );
  return Number(supplier.insertId);
}

/** 直接插一行，唔經 service —— 輪替關心嘅係 crypto 欄位，唔係業務規則。 */
async function seedAccount(connection, crypto, { supplierId, account, slot }) {
  const context = crypto.newCryptoContext();
  const sealed = crypto.encryptAccountNumber({ supplierId, cryptoContext: context, accountNumber: account });
  const indexed = crypto.blindIndex(account);
  const now = Date.now();
  const [row] = await connection.execute(
    `INSERT INTO supplier_bank_accounts
       (supplier_id, crypto_context, account_holder_name, bank_name, account_ciphertext, account_iv,
        account_auth_tag, encryption_key_id, account_blind_index, blind_index_key_id, last_four,
        account_length, is_default, status, version, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', 1, ?, ?, NULL, NULL)`,
    [supplierId, context, "Rotation Holder", `Bank ${slot}`, sealed.ciphertext, sealed.iv, sealed.authTag,
      sealed.encryptionKeyId, indexed.index, indexed.keyId, sealed.lastFour, sealed.accountLength, now, now]
  );
  return Number(row.insertId);
}

async function cleanup(connection, supplierIds) {
  for (const supplierId of supplierIds.filter(Boolean)) {
    await connection.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [supplierId]);
    await connection.execute("DELETE FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]);
    await connection.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]);
  }
}

integrationTest("encryption rotation re-encrypts real rows and leaves them decryptable and un-reindexed", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const { before, afterEncryption } = cryptoPair();
  supplierId = await seedSupplier(connection, randomUUID().slice(0, 8));
  const ids = [];
  for (const slot of [1, 2, 3]) {
    ids.push(await seedAccount(connection, before, { supplierId, account: `${ACCOUNT}${slot}`, slot }));
  }
  const [beforeRows] = await connection.query(
    "SELECT id, account_ciphertext, account_blind_index, blind_index_key_id FROM supplier_bank_accounts WHERE supplier_id = ? ORDER BY id", [supplierId]
  );

  const report = await runRotation({
    database: databaseOn(connection), crypto: afterEncryption,
    kind: ROTATION_KINDS.ENCRYPTION, from: "enc-old", to: "enc-new"
  });

  assert.equal(report.processed, 3);
  assert.equal(report.remaining, 0);
  assert.equal(report.supplierRowsDrained, true);
  assert.equal(await remainingRows(databaseOn(connection), ROTATION_KINDS.ENCRYPTION, "enc-old"), 0);

  const [afterRows] = await connection.query(
    `SELECT id, supplier_id, crypto_context, account_ciphertext, account_iv, account_auth_tag,
            encryption_key_id, account_blind_index, blind_index_key_id
       FROM supplier_bank_accounts WHERE supplier_id = ? ORDER BY id`, [supplierId]
  );
  for (const [index, row] of afterRows.entries()) {
    assert.equal(row.encryption_key_id, "enc-new");
    // 密文真係換咗（新 key、新 IV），但解出嚟仲係原本個帳號 —— AAD 綁定冇斷。
    assert.notDeepEqual(row.account_ciphertext, beforeRows[index].account_ciphertext);
    assert.equal(afterEncryption.decryptAccountNumber({
      supplierId: row.supplier_id, cryptoContext: row.crypto_context, ciphertext: row.account_ciphertext,
      iv: row.account_iv, authTag: row.account_auth_tag, encryptionKeyId: row.encryption_key_id
    }), `${ACCOUNT}${index + 1}`);
    // Blind index 完全冇郁 —— 兩條命令係獨立嘅。
    assert.deepEqual(row.account_blind_index, beforeRows[index].account_blind_index);
    assert.equal(row.blind_index_key_id, beforeRows[index].blind_index_key_id);
  }
  assert.deepEqual(afterRows.map((row) => Number(row.id)), ids);
});

integrationTest("lookup rotation rewrites index and key id together, and the unique constraint holds", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const { before, afterLookup } = cryptoPair();
  supplierId = await seedSupplier(connection, randomUUID().slice(0, 8));
  for (const slot of [1, 2]) {
    await seedAccount(connection, before, { supplierId, account: `${ACCOUNT}${slot}`, slot });
  }
  const [beforeRows] = await connection.query(
    "SELECT id, account_blind_index, account_ciphertext FROM supplier_bank_accounts WHERE supplier_id = ? ORDER BY id", [supplierId]
  );

  const report = await runRotation({
    database: databaseOn(connection), crypto: afterLookup,
    kind: ROTATION_KINDS.LOOKUP, from: "look-old", to: "look-new"
  });

  assert.equal(report.processed, 2);
  assert.equal(report.supplierRowsDrained, true);
  assert.equal(await remainingRows(databaseOn(connection), ROTATION_KINDS.LOOKUP, "look-old"), 0);

  const [afterRows] = await connection.query(
    "SELECT id, account_blind_index, blind_index_key_id, account_ciphertext FROM supplier_bank_accounts WHERE supplier_id = ? ORDER BY id", [supplierId]
  );
  for (const [index, row] of afterRows.entries()) {
    assert.equal(row.blind_index_key_id, "look-new");
    assert.deepEqual(row.account_blind_index, afterLookup.blindIndex(`${ACCOUNT}${index + 1}`).index,
      "the index must be recomputed under the new key, not copied");
    assert.notDeepEqual(row.account_blind_index, beforeRows[index].account_blind_index);
    // 密文完全冇郁。
    assert.deepEqual(row.account_ciphertext, beforeRows[index].account_ciphertext);
  }
});

integrationTest("a duplicate is still refused while the ring is half rotated", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const { before, afterLookup } = cryptoPair();
  supplierId = await seedSupplier(connection, randomUUID().slice(0, 8));
  // 兩行：一行留喺舊 lookup key，一行行去新 key。即係「輪替做咗一半」。
  await seedAccount(connection, before, { supplierId, account: `${ACCOUNT}1`, slot: 1 });
  await seedAccount(connection, before, { supplierId, account: `${ACCOUNT}2`, slot: 2 });
  const half = await runRotation({
    database: databaseOn(connection), crypto: afterLookup,
    kind: ROTATION_KINDS.LOOKUP, from: "look-old", to: "look-new", limit: 1
  });
  const [[still]] = await connection.query(
    "SELECT COUNT(*) AS n FROM supplier_bank_accounts WHERE supplier_id = ? AND blind_index_key_id = 'look-old'", [supplierId]
  );
  assert.equal(Number(still.n), 1, "exactly one row is still on the old lookup key");
  // 個 report 要同上面呢句 raw COUNT 講同一件事。`remainingRows` 揀邊個欄位係一條
  // 三元式，而佢就係 `supplierRowsDrained` 嘅全部 —— 之前佢個 lookup 分支喺兩套
  // 測試入面都冇人睇過，所以一個做咗一半嘅 lookup 輪替可以報「可以剷 key」。
  // （REV-053 M-2）
  assert.equal(half.remaining, Number(still.n), "the report must agree with the table");
  assert.equal(half.supplierRowsDrained, false,
    "a row still on the old lookup key must not authorise removing it");

  // 而家用新 active key 嘅 service 去加返**舊 key 嗰行**嘅帳號。設計 §5.8：查重要
  // 對 ring 入面每條 key 計 candidate index，所以就算嗰行仲用緊舊 key，都要擋得住。
  const service = serviceOn(connection, afterLookup);
  const [[oldRow]] = await connection.query(
    "SELECT id FROM supplier_bank_accounts WHERE supplier_id = ? AND blind_index_key_id = 'look-old'", [supplierId]
  );
  const stillOldAccount = oldRow ? `${ACCOUNT}2` : `${ACCOUNT}1`;
  await assert.rejects(
    () => service.create({
      actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"],
      supplierId, accountHolderName: "Dup Holder", bankName: "Dup Bank",
      accountNumber: stillOldAccount, reason: "輪替途中查重測試", requestId: "req-rot", ip: "127.0.0.1"
    }),
    (error) => error.publicCode === "BANK_ACCOUNT_DUPLICATE",
    "a half-rotated ring must not open a path around the duplicate check"
  );
});

integrationTest("an interrupted rotation resumes and finishes on real rows", async (t) => {
  const connection = await mysql.createConnection(config());
  let supplierId = null;
  t.after(async () => { await cleanup(connection, [supplierId]); await connection.end(); });

  const { before, afterEncryption } = cryptoPair();
  supplierId = await seedSupplier(connection, randomUUID().slice(0, 8));
  for (const slot of [1, 2, 3, 4, 5]) {
    await seedAccount(connection, before, { supplierId, account: `${ACCOUNT}${slot}`, slot });
  }

  const first = await runRotation({
    database: databaseOn(connection), crypto: afterEncryption,
    kind: ROTATION_KINDS.ENCRYPTION, from: "enc-old", to: "enc-new", limit: 2
  });
  assert.equal(first.processed, 2);
  assert.equal(first.supplierRowsDrained, false);
  assert.equal(await remainingRows(databaseOn(connection), ROTATION_KINDS.ENCRYPTION, "enc-old"), 3);

  // 續跑唔傳 after —— 條件本身就係進度。
  const second = await runRotation({
    database: databaseOn(connection), crypto: afterEncryption,
    kind: ROTATION_KINDS.ENCRYPTION, from: "enc-old", to: "enc-new"
  });
  assert.equal(second.processed, 3);
  assert.equal(second.remaining, 0);
  assert.equal(second.supplierRowsDrained, true);

  const [rows] = await connection.query(
    "SELECT encryption_key_id FROM supplier_bank_accounts WHERE supplier_id = ?", [supplierId]
  );
  assert.deepEqual([...new Set(rows.map((row) => row.encryption_key_id))], ["enc-new"]);
});
