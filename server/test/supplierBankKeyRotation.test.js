import assert from "node:assert/strict";
import test from "node:test";

import { SupplierBankCrypto } from "../src/modules/supplier/SupplierBankCrypto.js";
import { normalizeSupplierConfig } from "../src/modules/supplier/normalizeSupplierConfig.js";
import { ROTATION_KINDS, ringWarnings, runRotation } from "../src/modules/supplier/bankKeyRotation.js";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const KEY_C = Buffer.alloc(32, 3).toString("base64");
const ACCOUNT = "12345678901234";

/**
 * 行返 `normalizeSupplierConfig`，唔自己砌個 ring。個 ring 入面係 `SecretValue`
 * 包住嘅 key，唔係 base64 字串 —— 自己砌就會砌出一個同正式設定唔同形狀嘅嘢，而
 * 嗰種分別就係呢個模組一路揾到嘅缺陷來源。
 */
function crypto({ encActive = "e2", encRing = { e1: KEY_A, e2: KEY_B }, lookActive = "l2", lookRing = { l1: KEY_A, l2: KEY_C } } = {}) {
  const normalized = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: encActive, keyRing: JSON.stringify(encRing) },
    bankLookup: { activeKeyId: lookActive, keyRing: JSON.stringify(lookRing) }
  });
  return new SupplierBankCrypto({ encryption: normalized.bankEncryption, lookup: normalized.bankLookup });
}

/**
 * 一個記住行嘅假資料庫。佢唔係扮一個 MySQL —— 佢係一張表，而輪替邏輯唯一需要嘅
 * 就係「揀舊 key 而且 id 大過 X 嘅行」同「更新一行」。真 MySQL 嗰邊由
 * `test/integration/supplierBankRotation.integration.test.js` 負責。
 */
function fakeDatabase(rows, { failOn = new Set(), failAfterWrite = new Set() } = {}) {
  const table = rows.map((row) => ({ ...row }));
  const db = {
    table,
    async query(sql, params) {
      if (sql.includes("COUNT(*)")) {
        const column = sql.includes("encryption_key_id") ? "encryption_key_id" : "blind_index_key_id";
        return [[{ remaining: table.filter((r) => r[column] === params[0]).length }]];
      }
      const column = sql.includes("WHERE encryption_key_id") ? "encryption_key_id" : "blind_index_key_id";
      const limit = Number(/LIMIT (\d+)/u.exec(sql)[1]);
      return [table.filter((r) => r[column] === params[0] && r.id > params[1]).sort((a, b) => a.id - b.id).slice(0, limit)];
    },
    async withTransaction(work) {
      return work({
        /**
         * 讀個 SET 子句嚟決定邊個欄位收邊個參數，唔係照參數位置硬派。
         *
         * 之前呢度係硬派嘅，而咁樣個 double 就唔再係喺度扮 MySQL —— 我改個 SQL
         * 字串（例如剷走 `blind_index_key_id = ?`），佢照樣寫入，所以兩個真缺陷
         * 喺 mutation 之下生還。真 MySQL 係跟 SQL 行事嘅；呢度都要。
         */
        async execute(sql, params) {
          const setClause = /SET ([\s\S]*?)\s+WHERE/u.exec(sql)[1];
          const assignments = setClause.split(",").map((part) => part.trim());
          const row = table.find((r) => r.id === params[params.length - 2]);
          const next = {};
          let cursor = 0;
          for (const assignment of assignments) {
            const [column, value] = assignment.split("=").map((part) => part.trim());
            // 右邊唔係 `?` 就係「寫返自己」，即係冇變 —— 同真 SQL 一樣。
            if (value === "?") next[column] = params[cursor++];
          }
          if (failOn.has(row.id)) throw new Error("simulated row failure");
          Object.assign(row, next);
          // 寫咗之後先死 —— 例如 commit 階段出事。呢個係唯一一種「舊 key 已經冇
          // 行用緊，但今次 run 有失敗」嘅情況，而佢正正係 safeToRemoveFromKey
          // 唔可以淨係睇 remaining 嘅原因。
          if (failAfterWrite.has(row.id)) throw new Error("simulated failure after the write landed");
        }
      });
    }
  };
  return db;
}

/**
 * 種一行，形狀同 `supplier_bank_accounts` 一樣。密文同 blind index 係**分開兩個
 * call** —— `encryptAccountNumber` 唔會順手計 index，而嗰個分工正正就係兩條輪替
 * 命令可以獨立行嘅原因。
 */
function seed(c, { id, supplierId = 7 }) {
  const context = c.newCryptoContext();
  const account = `${ACCOUNT}${id}`;
  const sealed = c.encryptAccountNumber({ supplierId, cryptoContext: context, accountNumber: account });
  const indexed = c.blindIndex(account);
  return {
    id, supplier_id: supplierId, crypto_context: context,
    account_ciphertext: sealed.ciphertext, account_iv: sealed.iv, account_auth_tag: sealed.authTag,
    encryption_key_id: sealed.encryptionKeyId,
    account_blind_index: indexed.index, blind_index_key_id: indexed.keyId
  };
}

// AC：encryption command 只處理 from key 嘅行，並且用 active key 重新加密。
test("encryption rotation only touches rows on the from key, and re-encrypts under the active one", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const rows = [
    seed(oldCrypto, { id: 1 }), seed(oldCrypto, { id: 2 }),
    { ...seed(c, { id: 3 }) }
  ];
  const db = fakeDatabase(rows);
  const before = new Map(db.table.map((r) => [r.id, r.account_ciphertext]));

  const report = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2" });

  assert.equal(report.processed, 2, "only the two rows on e1");
  assert.equal(report.remaining, 0);
  assert.equal(report.safeToRemoveFromKey, true);
  assert.deepEqual(db.table.map((r) => r.encryption_key_id), ["e2", "e2", "e2"]);
  // 第三行完全冇郁過 —— 連密文都一樣。
  assert.deepEqual(db.table[2].account_ciphertext, before.get(3));
  // 頭兩行解得返，而且解出嚟係原本個帳號：AAD 綁定冇斷。
  for (const row of db.table.slice(0, 2)) {
    assert.equal(c.decryptAccountNumber({
      supplierId: row.supplier_id, cryptoContext: row.crypto_context,
      ciphertext: row.account_ciphertext, iv: row.account_iv,
      authTag: row.account_auth_tag, encryptionKeyId: row.encryption_key_id
    }), `${ACCOUNT}${row.id}`);
  }
  // Blind index 完全唔關 encryption 輪替事。
  assert.deepEqual(db.table.map((r) => r.blind_index_key_id), ["l2", "l2", "l2"]);
});

// AC：lookup command 同一個交易更新 index ＋ key ID。
test("lookup rotation rewrites the index and its key id together", async () => {
  const oldCrypto = crypto({ lookActive: "l1" });
  const c = crypto();
  const rows = [seed(oldCrypto, { id: 1 }), seed(oldCrypto, { id: 2 })];
  const db = fakeDatabase(rows);
  const beforeIndex = db.table[0].account_blind_index;
  const beforeCipher = db.table[0].account_ciphertext;

  const report = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.LOOKUP, from: "l1", to: "l2" });

  assert.equal(report.processed, 2);
  assert.equal(report.safeToRemoveFromKey, true);
  for (const row of db.table) {
    assert.equal(row.blind_index_key_id, "l2");
    // 個 index 要真係用新 key 計過，唔係照抄。
    assert.deepEqual(row.account_blind_index, c.blindIndex(`${ACCOUNT}${row.id}`).index);
  }
  assert.notDeepEqual(db.table[0].account_blind_index, beforeIndex);
  // 密文完全唔關 lookup 輪替事。
  assert.deepEqual(db.table[0].account_ciphertext, beforeCipher);
});

// AC：兩者按 ID 續跑。
test("a half-finished run resumes without external progress state", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const db = fakeDatabase([1, 2, 3, 4, 5].map((id) => seed(oldCrypto, { id })));

  const first = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2", limit: 2 });
  assert.equal(first.processed, 2);
  assert.equal(first.remaining, 3);
  assert.equal(first.safeToRemoveFromKey, false, "three rows still hold the old key");

  // 第二次唔傳 `after` —— 條件本身就係進度。
  const second = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2" });
  assert.equal(second.processed, 3, "picks up exactly the rows the first run did not reach");
  assert.equal(second.remaining, 0);
  assert.equal(second.safeToRemoveFromKey, true);
  assert.deepEqual(db.table.map((r) => r.encryption_key_id), ["e2", "e2", "e2", "e2", "e2"]);
});

// AC：舊 key row count 為 0 先可以移除。
test("a failed row keeps the old key un-removable and is reported by id", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const db = fakeDatabase([1, 2, 3].map((id) => seed(oldCrypto, { id })), { failOn: new Set([2]) });

  const report = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2" });

  assert.equal(report.processed, 2);
  assert.equal(report.failed, 1);
  assert.deepEqual(report.failures.map((f) => f.id), [2]);
  assert.equal(report.remaining, 1);
  assert.equal(report.safeToRemoveFromKey, false,
    "one row still on the old key must block removing it");
});

// 剷舊 key 嘅條件唔可以淨係「冇行用緊佢」。
test("a failure that lands after the write still blocks removing the old key", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const db = fakeDatabase([1, 2].map((id) => seed(oldCrypto, { id })), { failAfterWrite: new Set([2]) });

  const report = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2" });

  assert.equal(report.remaining, 0, "both rows now carry the new key id");
  assert.equal(report.failed, 1, "but one of them did not finish cleanly");
  assert.equal(report.safeToRemoveFromKey, false,
    "remaining === 0 is not sufficient: a run with an unexplained failure must not authorise removing the key");
});

// `--to` 係確認唔係選擇器。
test("refuses a --to that is not the active key, instead of silently using the active one", async () => {
  const c = crypto();
  const db = fakeDatabase([]);
  await assert.rejects(
    () => runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e9" }),
    /must be the active encryption key id \(e2\)/u
  );
  await assert.rejects(
    () => runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e2", to: "e2" }),
    /same key id/u
  );
});

// AC：report 唔含 key、明文、ciphertext 或 blind index。
test("the report carries ids and counts, never key material, plaintext, ciphertext or an index", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const db = fakeDatabase([1, 2].map((id) => seed(oldCrypto, { id })), { failOn: new Set([2]) });
  const progress = [];

  const report = await runRotation({
    database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2",
    onProgress: (p) => progress.push(p)
  });

  const serialised = JSON.stringify({ report, progress });
  for (const secret of [KEY_A, KEY_B, KEY_C, ACCOUNT, `${ACCOUNT}1`]) {
    assert.ok(!serialised.includes(secret), `report must not contain ${secret.slice(0, 8)}…`);
  }
  // Base64 嘅 key 會唔會以另一種編碼漏出去？掃 raw bytes。
  for (const raw of [Buffer.from(KEY_A, "base64").toString("hex"), Buffer.from(KEY_B, "base64").toString("hex")]) {
    assert.ok(!serialised.includes(raw), "no key material in any encoding");
  }
  assert.ok(!serialised.includes(db.table[0].account_blind_index.toString("hex")), "no blind index");
  // Key **id** 係應該喺度嘅 —— 佢一行行寫咗喺資料庫，唔係祕密。
  assert.ok(serialised.includes("e1") && serialised.includes("e2"));
});

// AC：ring 超 3 或過渡超 30 日告警。
test("warns when the ring grows past three keys or the transition runs past thirty days", () => {
  const big = crypto({ encRing: { e1: KEY_A, e2: KEY_B, e3: KEY_C, e4: KEY_A } });
  const codes = (w) => w.map((item) => item.code).sort();

  assert.deepEqual(codes(ringWarnings({ crypto: big })), ["RING_TOO_LARGE"]);
  assert.deepEqual(codes(ringWarnings({ crypto: crypto() })), [], "a healthy ring warns about nothing");

  const now = Date.UTC(2026, 0, 31);
  assert.deepEqual(codes(ringWarnings({ crypto: crypto(), transitionStartedAt: Date.UTC(2025, 11, 1), now })),
    ["TRANSITION_TOO_LONG"]);
  assert.deepEqual(codes(ringWarnings({ crypto: crypto(), transitionStartedAt: Date.UTC(2026, 0, 10), now })), [],
    "21 days is inside the limit");
  // 邊界：30 日啱啱好唔警告，31 日要警告。冇呢兩句，一個 off-by-one 會生還。
  assert.deepEqual(codes(ringWarnings({ crypto: crypto(), transitionStartedAt: now - 30 * 86_400_000, now })), [],
    "exactly thirty days is still inside the limit");
  assert.deepEqual(codes(ringWarnings({ crypto: crypto(), transitionStartedAt: now - 31 * 86_400_000, now })),
    ["TRANSITION_TOO_LONG"], "thirty-one days is outside it");
  assert.deepEqual(codes(ringWarnings({ crypto: big, transitionStartedAt: Date.UTC(2025, 11, 1), now })),
    ["RING_TOO_LARGE", "TRANSITION_TOO_LONG"]);
});
