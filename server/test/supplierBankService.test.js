import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { normalizeSupplierConfig } from "../src/modules/supplier/normalizeSupplierConfig.js";
import { SupplierBankCrypto } from "../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../src/modules/supplier/SupplierBankService.js";

/**
 * 呢個檔案用假連線，所以佢證唔到 SQL 本身跑唔跑得 —— 嗰半喺
 * `test/integration/supplierBank.integration.test.js` 打真 MySQL。呢度證嘅係**決定**：
 * 邊啲欄位會被讀、次序、明文會唔會漏去 audit 或者錯誤訊息、邊個分支會拒絕。
 *
 * crypto 刻意用真嘅 `SupplierBankCrypto`，唔用 stub：一個 stub crypto 會令「明文有冇
 * 漏出去」呢類斷言變成喺度比較測試自己砌嘅假值，證唔到任何嘢。
 */
const ACCOUNT = "123-456789-001";
const NORMALIZED = "123456789001";

function realCrypto() {
  const config = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: JSON.stringify({ "enc-1": randomBytes(32).toString("base64") }) },
    bankLookup: { activeKeyId: "look-1", keyRing: JSON.stringify({ "look-1": randomBytes(32).toString("base64") }) }
  });
  return new SupplierBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

function bankRow(overrides = {}) {
  return {
    id: 41, supplier_id: 7, account_holder_name: "Example Supplier Limited", bank_name: "Example Bank",
    bank_country_code: "HK", bank_code: "999", branch_code: "001", swift_bic: "EXAMPLEHH",
    account_currency_code: "HKD", last_four: "9001", account_length: 12,
    is_default: 0, status: "active", version: 1, created_at: 100, updated_at: 100,
    crypto_context: "ctx-41", encryption_key_id: "enc-1", blind_index_key_id: "look-1",
    ...overrides
  };
}

function harness({ row = bankRow(), duplicates = [], permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"], crypto = realCrypto(), sealRow = null } = {}) {
  const events = [];
  const current = row;
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM suppliers") && sql.includes("FOR UPDATE")) return [[{ id: 7, supplier_code: "SUP-007" }]];
      if (sql.includes("FROM suppliers WHERE id")) return [[{ id: 7 }]];
      if (sql.includes("JOIN suppliers s")) return [duplicates];
      if (sql.includes("account_ciphertext") && sql.includes("WHERE id = ?")) {
        return [[sealRow ? { ...current, ...sealRow } : null].filter(Boolean)];
      }
      if (sql.includes("FROM supplier_bank_accounts") && sql.includes("status = ? ORDER BY id FOR UPDATE")) {
        return [[{ id: 40, is_default: 1, status: "active" }]];
      }
      if (sql.includes("FROM supplier_bank_accounts")) return [[current].filter(Boolean)];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("INSERT INTO supplier_bank_accounts")) return [{ insertId: 41, affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    }
  };
  const audited = [];
  const service = new SupplierBankService({
    database: {
      async withTransaction(work) { return work(connection); },
      query: (...args) => connection.query(...args)
    },
    logger: { warn() {} },
    time: { nowMs: () => 200 },
    crypto,
    authorize: async () => ({ id: 1, username: "tester", permissions }),
    audit: { async record(txn, entry) { audited.push(entry); events.push(["audit", entry.action]); } }
  });
  return { service, events, audited, connection, crypto };
}

const actor = { actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.bank.mgmt"], requestId: "req-1", ip: "127.0.0.1" };
const bankDetails = {
  accountHolderName: "Example Supplier Limited", bankName: "Example Bank",
  bankCountryCode: "hk", bankCode: "999", branchCode: "001", swiftBic: "examplehh", accountCurrencyCode: "hkd"
};

/** 每一句 SQL 拼埋一齊，攞嚟證某啲欄位名由頭到尾冇出現過。 */
function allSql(events) {
  return events.filter(([kind]) => kind !== "audit").map(([, sql]) => sql).join("\n");
}

test("the service refuses to exist without a crypto, so there is no unencrypted fallback", () => {
  // 一個「冇 key 就唔加密」嘅後備路徑會令一個忘記配置 key ring 嘅環境靜靜哋用明文
  // 寫入 —— 而嗰個環境唔會有任何嘢出聲。
  const base = { database: {}, logger: { warn() {} }, time: { nowMs: () => 1 } };
  assert.throws(() => new SupplierBankService(base), TypeError);
  assert.throws(() => new SupplierBankService({ ...base, crypto: { encryptAccountNumber() {} } }), TypeError);
  assert.doesNotThrow(() => new SupplierBankService({ ...base, crypto: realCrypto() }));
});

test("the masked list never selects an encrypted column", async () => {
  // BR-020：最穩陣嘅做法係啲密文根本冇離開過資料庫。
  const { service, events } = harness();
  const result = await service.list({ ...actor, supplierId: 7 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].maskedAccountNumber, "•••• 9001");
  assert.equal(result.items[0].accountNumber, undefined);

  const sql = allSql(events);
  for (const forbidden of ["account_ciphertext", "account_iv", "account_auth_tag", "account_blind_index", "encryption_key_id"]) {
    assert.ok(!sql.includes(forbidden), `the list path must not read ${forbidden}`);
  }
  assert.ok(!sql.includes("SELECT *"), "a SELECT * would pull the ciphertext along with everything else");
});

test("create encrypts, indexes and audits, and no plaintext reaches the audit entry", async () => {
  const { service, events, audited } = harness();
  const result = await service.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: ACCOUNT, reason: "新增已核對的收款帳戶" });

  assert.equal(result.id, 41);
  assert.equal(result.bankCountryCode, "HK", "codes are upper-cased");
  const insert = events.find(([kind, sql]) => kind === "execute" && sql.includes("INSERT INTO supplier_bank_accounts"));
  const params = insert[2];
  assert.ok(params.some((value) => Buffer.isBuffer(value) && value.length === 12), "a 96-bit IV is stored");
  assert.ok(params.some((value) => Buffer.isBuffer(value) && value.length === 16), "a 128-bit tag is stored");
  assert.ok(params.some((value) => Buffer.isBuffer(value) && value.length === 32), "a blind index is stored");
  assert.ok(!params.includes(ACCOUNT) && !params.includes(NORMALIZED), "the account is never a bind parameter in the clear");

  const entry = audited.at(-1);
  assert.equal(entry.action, "supplier.bank.create");
  const serialized = JSON.stringify(entry);
  assert.ok(!serialized.includes(ACCOUNT) && !serialized.includes(NORMALIZED),
    "FR-BANK-007: an audit entry must not carry the account");
  assert.ok(!serialized.includes("enc-1") && !serialized.includes("look-1"),
    "nor the key IDs, which would narrow an attacker's search");
});

test("a same-Supplier duplicate is blocked and a cross-Supplier one is only a warning", async () => {
  // 兩間公司共用一個收款帳號係合法嘅業務情況，唔應該封死；同一間公司入兩次就係錯。
  const mine = harness({ duplicates: [{ id: 40, supplier_id: 7, supplier_code: "SUP-007" }] });
  await assert.rejects(
    () => mine.service.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: ACCOUNT, reason: "重覆帳戶測試原因" }),
    (error) => error.publicCode === "BANK_ACCOUNT_DUPLICATE" && error.statusCode === 409
  );

  const theirs = harness({ duplicates: [{ id: 90, supplier_id: 9, supplier_code: "SUP-009" }] });
  const result = await theirs.service.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: ACCOUNT, reason: "跨供應商重覆測試原因" });
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "BANK_ACCOUNT_DUPLICATE_OTHER_SUPPLIER");
  assert.deepEqual(result.warnings[0].supplierCodes, ["SUP-009"]);
  assert.ok(!JSON.stringify(result.warnings).includes(NORMALIZED), "a warning must not carry the other Supplier's account");
});

test("without supplier.view the cross-Supplier warning names no Supplier at all", async () => {
  const { service } = harness({
    duplicates: [{ id: 90, supplier_id: 9, supplier_code: "SUP-009" }],
    permissions: ["supplier.bank.view", "supplier.bank.mgmt"]
  });
  const result = await service.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: ACCOUNT, reason: "無 supplier.view 測試原因" });
  assert.deepEqual(result.warnings[0].supplierCodes, [], "a Supplier Code identifies a company; it is not free to hand out");
});

test("duplicate checking uses every lookup key, not just the active one", async () => {
  // 設計 §5.8：輪替期間同一個帳號喺新舊 key 之下計出唔同 index，淨係查 active key
  // 就變成一條繞過重覆檢查嘅路。
  const config = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: JSON.stringify({ "enc-1": randomBytes(32).toString("base64") }) },
    bankLookup: {
      activeKeyId: "look-2",
      keyRing: JSON.stringify({ "look-1": randomBytes(32).toString("base64"), "look-2": randomBytes(32).toString("base64") })
    }
  });
  const crypto = new SupplierBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
  const { service, events } = harness({ crypto });
  await service.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: ACCOUNT, reason: "輪替期間查重測試原因" });

  const lookup = events.find(([kind, sql]) => kind === "query" && sql.includes("JOIN suppliers s"));
  const indexes = lookup[2].filter((value) => Buffer.isBuffer(value));
  assert.equal(indexes.length, 2, "both ring keys must be searched");
  assert.notEqual(indexes[0].toString("hex"), indexes[1].toString("hex"));
});

test("update re-encrypts only when the account itself changed", async () => {
  // 每次重新加密都係一次 audit 上嘅「帳號改過」訊號。改個銀行名唔應該睇落似改過帳號。
  const unchanged = harness();
  await unchanged.service.update({ ...actor, ...bankDetails, bankName: "Renamed Bank", supplierId: 7, bankAccountId: 41, version: 1, reason: "只改銀行名稱測試原因" });
  const plainUpdate = unchanged.events.find(([kind, sql]) => kind === "execute" && sql.includes("UPDATE supplier_bank_accounts"));
  assert.ok(!plainUpdate[1].includes("account_ciphertext"), "an unchanged account must not be re-encrypted");
  assert.equal(unchanged.audited.at(-1).detail.changes.accountNumberChanged, false);

  const changed = harness();
  await changed.service.update({ ...actor, ...bankDetails, supplierId: 7, bankAccountId: 41, version: 1, accountNumber: "999-888777-666", reason: "更換帳號測試原因" });
  const sealedUpdate = changed.events.find(([kind, sql]) => kind === "execute" && sql.includes("UPDATE supplier_bank_accounts"));
  assert.ok(sealedUpdate[1].includes("account_ciphertext") && sealedUpdate[1].includes("account_blind_index"));
  assert.equal(changed.audited.at(-1).detail.changes.accountNumberChanged, true);
  assert.ok(!JSON.stringify(changed.audited.at(-1)).includes("999888777666"));
});

test("re-encrypting an account keeps the row's crypto context, because it is the row's identity", async () => {
  // 換咗 crypto_context，AAD 就綁去一個新身分，而 `crypto_context` 欄位本身唔會被
  // 更新 —— 所以個 row 之後永遠解唔返。
  //
  // 第一版呢個測試斷言 UPDATE 嘅參數入面冇 "ctx-41"，而佢**過唔到**變異測試：
  // `crypto_context` 根本唔喺 SET 清單入面，所以無論用新定舊 context 加密，個參數
  // 清單都唔會有佢。個斷言喺兩邊都成立，即係乜都冇分辨到。
  //
  // 真正嘅性質係：重新加密之後嗰段密文，要用**行入面存住嗰個** context 解得返。
  const { service, events, crypto } = harness();
  await service.update({
    ...actor, ...bankDetails, supplierId: 7, bankAccountId: 41, version: 1,
    // 刻意用一個長度唔等於 12／16／32 嘅帳號，咁下面先分得出邊個 buffer 係邊個 ——
    // GCM 密文長度等於明文 byte 數，一個十二位嘅帳號會同個 IV 一樣長。
    accountNumber: "999-888777-666555-444", reason: "保留 crypto context 測試原因"
  });

  const update = events.find(([kind, sql]) => kind === "execute" && sql.includes("account_ciphertext"));
  const buffers = update[2].filter((value) => Buffer.isBuffer(value));
  const ciphertext = buffers.find((value) => value.length === 18);
  const iv = buffers.find((value) => value.length === 12);
  const authTag = buffers.find((value) => value.length === 16);
  assert.ok(ciphertext && iv && authTag, "the update must carry a ciphertext, an IV and a tag");
  assert.equal(
    crypto.decryptAccountNumber({
      supplierId: 7, cryptoContext: "ctx-41", ciphertext, iv, authTag, encryptionKeyId: "enc-1"
    }),
    "999888777666555444",
    "the row's stored context must still open the re-encrypted account"
  );
  assert.ok(!allSql(events).includes("crypto_context = ?"), "and the column is never rewritten");
});

test("setting a default clears the old one in the same transaction, after locking the active rows", async () => {
  // 設計 §2.6：先鎖 Supplier 全部 Active Bank rows，再清舊 default、設新 default。
  const { service, events } = harness();
  await service.setDefault({ ...actor, supplierId: 7, bankAccountId: 41, version: 1, reason: "更改預設帳戶測試原因" });

  const order = events.filter(([kind]) => kind !== "audit").map(([, sql]) => sql);
  const lockAll = order.findIndex((sql) => sql.includes("status = ? ORDER BY id FOR UPDATE"));
  const clearOld = order.findIndex((sql) => sql.includes("SET is_default = 0"));
  const setNew = order.findIndex((sql) => sql.includes("SET is_default = 1"));
  assert.ok(lockAll >= 0 && lockAll < clearOld && clearOld < setNew,
    `lock all active rows, then clear, then set; got ${lockAll}/${clearOld}/${setNew}`);
  assert.equal(events.at(-1)[1], "supplier.bank.default");
});

test("deactivating clears the default so a later reactivation cannot silently retake the slot", async () => {
  const { service, events, audited } = harness({ row: bankRow({ is_default: 1 }) });
  await service.deactivate({ ...actor, supplierId: 7, bankAccountId: 41, version: 1, reason: "停用帳戶測試原因" });
  const update = events.find(([kind, sql]) => kind === "execute" && sql.includes("UPDATE supplier_bank_accounts"));
  assert.ok(update[1].includes("is_default = 0") && update[1].includes("status = ?"));
  assert.deepEqual(audited.at(-1).detail.after, { status: "inactive", isDefault: false });
});

test("a bank account belonging to another Supplier is not found rather than refused", async () => {
  // 設計 §6.3：唔屬於你嘅嘢一律回 404，唔可以靠錯誤碼分辨「存在但唔俾你掂」。
  const { service } = harness({ row: null });
  for (const call of [
    (service) => service.update({ ...actor, ...bankDetails, supplierId: 8, bankAccountId: 41, version: 1, reason: "IDOR 測試原因" }),
    (service) => service.setDefault({ ...actor, supplierId: 8, bankAccountId: 41, version: 1, reason: "IDOR 測試原因" }),
    (service) => service.deactivate({ ...actor, supplierId: 8, bankAccountId: 41, version: 1, reason: "IDOR 測試原因" })
  ]) {
    await assert.rejects(() => call(service), (error) => error.statusCode === 404);
  }
});

test("every write re-checks the permission, so a revoked token cannot keep writing", async () => {
  // assertActorFresh 只比對 claim 同現況，佢唔執行任何 permission。一個誠實地冇
  // bank.mgmt 嘅 caller 要喺呢度停低。
  const { service } = harness({ permissions: ["supplier.view"] });
  for (const call of [
    (s) => s.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: ACCOUNT, reason: "撤權測試原因" }),
    (s) => s.update({ ...actor, ...bankDetails, supplierId: 7, bankAccountId: 41, version: 1, reason: "撤權測試原因" }),
    (s) => s.setDefault({ ...actor, supplierId: 7, bankAccountId: 41, version: 1, reason: "撤權測試原因" }),
    (s) => s.deactivate({ ...actor, supplierId: 7, bankAccountId: 41, version: 1, reason: "撤權測試原因" })
  ]) {
    await assert.rejects(() => call(service), (error) => error.publicCode === "BANK_PERMISSION_LOST");
  }
});

test("reveal needs bank.view specifically, not bank.mgmt", async () => {
  // AC-023：只有 supplier.view 嘅人直接要求完整值亦都被後端拒絕。而 bank.mgmt 係
  // 「管理」唔係「查看」—— 設計 §6.6 兩條 route 嘅 policy 就係唔同。
  const { service } = harness({ permissions: ["supplier.view", "supplier.bank.mgmt"] });
  await assert.rejects(
    () => service.reveal({ ...actor, supplierId: 7, bankAccountId: 41, reason: "查看完整帳號測試原因" }),
    (error) => error.publicCode === "BANK_PERMISSION_LOST"
  );
});

test("reveal writes the audit inside the transaction and only returns the account after it commits", async () => {
  // 次序係呢個 method 嘅全部重點：一個「先回帳號、事後補 audit」嘅實作喺 audit 寫入
  // 失敗嗰陣會派咗個帳號出去而冇任何紀錄 —— 而嗰個正正係最需要紀錄嘅情況。
  const crypto = realCrypto();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: "ctx-41", accountNumber: ACCOUNT });
  const { service, audited, events } = harness({
    crypto,
    sealRow: {
      account_ciphertext: sealed.ciphertext, account_iv: sealed.iv,
      account_auth_tag: sealed.authTag, encryption_key_id: sealed.encryptionKeyId
    }
  });
  const result = await service.reveal({ ...actor, supplierId: 7, bankAccountId: 41, reason: "查看完整帳號測試原因" });

  assert.equal(result.accountNumber, NORMALIZED);
  assert.equal(audited.at(-1).action, "supplier.bank.reveal");
  assert.equal(events.at(-1)[0], "audit", "the audit is the last thing the transaction does");
  assert.deepEqual(audited.at(-1).detail, { after: { revealed: true } },
    "the audit records that someone looked, not what they saw");
  assert.ok(!JSON.stringify(audited.at(-1)).includes(NORMALIZED));
});

test("a reveal whose audit fails returns no account at all", async () => {
  const crypto = realCrypto();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: "ctx-41", accountNumber: ACCOUNT });
  const { service } = harness({
    crypto,
    sealRow: {
      account_ciphertext: sealed.ciphertext, account_iv: sealed.iv,
      account_auth_tag: sealed.authTag, encryption_key_id: sealed.encryptionKeyId
    }
  });
  service.audit = { async record() { throw new Error("audit store unavailable"); } };
  await assert.rejects(
    () => service.reveal({ ...actor, supplierId: 7, bankAccountId: 41, reason: "稽核失敗測試原因" }),
    /audit store unavailable/
  );
});

test("a reveal of a tampered row fails instead of returning something", async () => {
  // 解密喺交易入面做：解唔到就成個交易 rollback，唔會留低一筆「有人睇過」但其實
  // 乜都冇睇到嘅稽核。
  const crypto = realCrypto();
  const sealed = crypto.encryptAccountNumber({ supplierId: 7, cryptoContext: "ctx-41", accountNumber: ACCOUNT });
  const broken = Buffer.from(sealed.ciphertext);
  broken[0] ^= 0x01;
  const { service, audited } = harness({
    crypto,
    sealRow: {
      account_ciphertext: broken, account_iv: sealed.iv,
      account_auth_tag: sealed.authTag, encryption_key_id: sealed.encryptionKeyId
    }
  });
  await assert.rejects(
    () => service.reveal({ ...actor, supplierId: 7, bankAccountId: 41, reason: "竄改資料測試原因" }),
    /failed authentication/
  );
  assert.equal(audited.length, 0, "no audit row may claim a reveal that never produced an account");
});

test("an account the normalizer cannot represent is refused, and the error does not echo it", async () => {
  // DEF-021／HD-029 喺 service 層嘅出口：設計 §6.6 講明 validation error 同
  // ApplicationError.details 都唔可以包含 accountNumber。
  const { service } = harness();
  let thrown = null;
  try {
    await service.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: "ÅB12345", reason: "非法字元測試原因" });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "a character the normalizer cannot represent must not be silently deleted");
  assert.ok(!JSON.stringify({ message: thrown.message, details: thrown.details ?? null }).includes("B12345"),
    "a validation error must never echo the account it rejected");
});

test("every write demands a reason, because the audit is useless without one", async () => {
  const { service } = harness();
  for (const call of [
    (s) => s.create({ ...actor, ...bankDetails, supplierId: 7, accountNumber: ACCOUNT, reason: "短" }),
    (s) => s.update({ ...actor, ...bankDetails, supplierId: 7, bankAccountId: 41, version: 1, reason: "" }),
    (s) => s.setDefault({ ...actor, supplierId: 7, bankAccountId: 41, version: 1 }),
    (s) => s.deactivate({ ...actor, supplierId: 7, bankAccountId: 41, version: 1, reason: "    " }),
    (s) => s.reveal({ ...actor, supplierId: 7, bankAccountId: 41, reason: "x" })
  ]) {
    await assert.rejects(() => call(service), (error) => error.publicCode === "SUPPLIER_REASON_REQUIRED");
  }
});

test("a stale version is a conflict on every write path", async () => {
  const { service } = harness();
  for (const call of [
    (s) => s.update({ ...actor, ...bankDetails, supplierId: 7, bankAccountId: 41, version: 99, reason: "版本衝突測試原因" }),
    (s) => s.setDefault({ ...actor, supplierId: 7, bankAccountId: 41, version: 99, reason: "版本衝突測試原因" }),
    (s) => s.deactivate({ ...actor, supplierId: 7, bankAccountId: 41, version: 99, reason: "版本衝突測試原因" })
  ]) {
    await assert.rejects(() => call(service), (error) => error.publicCode === "VERSION_CONFLICT");
  }
});

test("an inactive account cannot be updated, defaulted or deactivated again", async () => {
  const { service } = harness({ row: bankRow({ status: "inactive" }) });
  for (const call of [
    (s) => s.update({ ...actor, ...bankDetails, supplierId: 7, bankAccountId: 41, version: 1, reason: "已停用測試原因" }),
    (s) => s.setDefault({ ...actor, supplierId: 7, bankAccountId: 41, version: 1, reason: "已停用測試原因" }),
    (s) => s.deactivate({ ...actor, supplierId: 7, bankAccountId: 41, version: 1, reason: "已停用測試原因" })
  ]) {
    await assert.rejects(() => call(service), (error) => error.publicCode === "BANK_ACCOUNT_INACTIVE");
  }
});
