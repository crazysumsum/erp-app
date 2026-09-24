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
/** 一個同 mysql2 同形狀嘅重覆鍵錯誤 —— 連 MySQL 會嵌落去嗰個 key 值都有。 */
function duplicateKeyError(indexBytes) {
  const escaped = [...indexBytes].map((byte) => `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
  return Object.assign(new Error(
    `Duplicate entry '${escaped}' for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'`
  ), { errno: 1062, code: "ER_DUP_ENTRY", sqlMessage:
    `Duplicate entry '${escaped}' for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'` });
}

function fakeDatabase(rows, { failOn = new Set(), failAfterWrite = new Set(), duplicateOn = new Map() } = {}) {
  const table = rows.map((row) => ({ ...row }));
  const db = {
    table,
    async query(sql, params) {
      if (sql.includes("COUNT(*)")) {
        const column = sql.includes("encryption_key_id") ? "encryption_key_id" : "blind_index_key_id";
        return [[{ remaining: table.filter((r) => r[column] === params[0]).length }]];
      }
      /**
       * `WHERE` 要**照住 SQL 行**，唔可以硬寫。
       *
       * 之前呢度硬寫咗 `r[column] === params[0] && r.id > params[1]`，即係個 cursor
       * 條件 `AND id > ?` —— **令個輪替會停嘅嗰一句** —— 由呢個 double 自己補返，
       * 而唔係由被測嘅 SQL 提供。結果：剷走 `AND id > ?`，356 條測試全部照綠，而喺
       * 真 MySQL 上面個迴圈會永遠攞返同一批行。
       *
       * 呢個係呢個 task 第四個 double 失真，而且就喺我三次修 `execute` 都冇掂過嗰
       * 一個 method 度。（REV-052 M-2）
       */
      const limit = Number(/LIMIT (\d+)/u.exec(sql)[1]);
      const whereClause = /WHERE ([\s\S]*?)\s+ORDER BY/u.exec(sql)[1];
      let cursor = 0;
      const tests = [];
      for (const predicate of whereClause.split(/\s+AND\s+/u).map((part) => part.trim())) {
        const equals = /^([a-z_]+) = \?$/u.exec(predicate);
        const greater = /^([a-z_]+) > \?$/u.exec(predicate);
        if (equals) { const [column, value] = [equals[1], params[cursor++]]; tests.push((r) => r[column] === value); }
        else if (greater) { const [column, value] = [greater[1], params[cursor++]]; tests.push((r) => r[column] > value); }
        else if (/^\? IS NOT NULL$/u.test(predicate)) { cursor += 1; }   // 恆真，同真 SQL 一樣
        else throw new Error(`the double cannot parse the predicate ${predicate}`);
      }
      // **回副本**，唔回 live reference。真 MySQL 回嘅係一份已經脫離咗表嘅資料，
      // 而呢個分別唔係學術嘅：靠 reference 嘅話，一個模擬並發嘅測試改個 table 就
      // 連手上嗰行都改埋，於是個 guard 無論啱定錯都會「通過」，兩個 mutant 一齊
      // 生還。（REV-051 F-M3 嘅第一次修法就係咁樣測唔到嘢。）
      return [table.filter((r) => tests.every((matches) => matches(r)))
        .sort((a, b) => a.id - b.id).slice(0, limit).map((r) => ({ ...r }))];
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
          const whereClause = /WHERE ([\s\S]*)$/u.exec(sql)[1];
          const next = {};
          let cursor = 0;
          for (const assignment of setClause.split(",").map((part) => part.trim())) {
            const [column, value] = assignment.split("=").map((part) => part.trim());
            // 右邊唔係 `?` 就係「寫返自己」，即係冇變 —— 同真 SQL 一樣。
            if (value === "?") next[column] = params[cursor++];
          }
          /**
           * `WHERE` 一樣要跟住行，唔係靠 `params` 尾二個當作 id。
           *
           * 之前呢度淨係 parse `SET`，而呢個 task 兩樣最要緊嘅嘢 —— 續跑用嘅
           * `encryption_key_id = ?` 過濾，同防並發覆寫嗰個 guard —— **兩個都住喺
           * `WHERE` 入面**。即係我可以把個 guard 改成 `OR 1 = 1` 而成套測試照綠。
           * （REV-051 F-M3）
           */
          const predicates = whereClause.split(/\s+AND\s+/u).map((part) => part.trim());
          const wanted = {};
          for (const predicate of predicates) {
            const [column, value] = predicate.split("=").map((part) => part.trim());
            if (value === "?") wanted[column] = params[cursor++];
            else if (column === "1" && value === "1") continue; // `OR 1 = 1` 類嘅恆真
          }
          const row = table.find((candidate) =>
            Object.entries(wanted).every(([column, value]) => candidate[column] === value));
          // 冇行 match 就係 affectedRows 0 —— 唔係錯，但亦都唔係寫入。
          if (!row) return [{ affectedRows: 0 }];
          if (duplicateOn.has(row.id)) throw duplicateKeyError(duplicateOn.get(row.id));
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

/**
 * REV-051 F-M1。MySQL 喺 `ER_DUP_ENTRY` 嘅訊息入面會嵌住撞咗嗰個 key 嘅值，而對
 * `uq_supplier_bank_blind_index` 嚟講，嗰個值**就係 blind index**。轉發
 * `error.message` 就等於把半個 HMAC 印落 report。
 */
test("a duplicate key failure reports the constraint, never the index MySQL echoes back", async () => {
  const oldCrypto = crypto({ lookActive: "l1" });
  const c = crypto();
  const rows = [seed(oldCrypto, { id: 1 })];
  const index = c.blindIndex(`${ACCOUNT}1`).index;
  const db = fakeDatabase(rows, { duplicateOn: new Map([[1, index]]) });

  const report = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.LOOKUP, from: "l1", to: "l2" });

  assert.equal(report.failed, 1);
  assert.equal(report.failures[0].reason, "DUPLICATE_KEY");
  assert.equal(report.failures[0].constraint, "uq_supplier_bank_blind_index",
    "the constraint name is schema, not data, and it is what an operator needs");

  const serialised = JSON.stringify(report);
  // MySQL 用 `\xAB` 咁嘅形式嵌住佢 —— base64 掃描係捉唔到嘅，所以要照佢個形式掃。
  const escaped = [...index].map((byte) => `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
  assert.ok(!serialised.includes(escaped.slice(0, 24)), "no escaped index bytes may reach the report");
  assert.ok(!serialised.includes("Duplicate entry"), "no driver message may be forwarded verbatim");
  assert.ok(!serialised.includes(index.toString("hex").slice(0, 16)), "nor the index in hex");
});

// REV-051 F-M2：`--limit` 限嘅係做幾多行，唔係成功幾多行。
test("--limit bounds the work attempted, not just the rows that succeed", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const db = fakeDatabase(ids.map((id) => seed(oldCrypto, { id })), { failOn: new Set(ids) });

  const report = await runRotation({
    database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2", limit: 2
  });

  assert.equal(report.processed, 0, "every row fails");
  assert.equal(report.attempted, 2, "but a --limit=2 run must still stop after two");
  assert.equal(report.failed, 2,
    "a cautious probe must not turn into a full table scan just because the rows fail");
});

// REV-051 F-M3：防並發覆寫嗰個 guard 住喺 WHERE 入面。
for (const [kind, fromKey, toKey, keyColumn, witness] of [
  [ROTATION_KINDS.ENCRYPTION, "e1", "e2", "encryption_key_id", "account_ciphertext"],
  [ROTATION_KINDS.LOOKUP, "l1", "l2", "blind_index_key_id", "account_blind_index"]
]) {
  test(`${kind}: a row whose key changed under us is not overwritten`, async () => {
    const oldCrypto = crypto(kind === ROTATION_KINDS.ENCRYPTION ? { encActive: "e1" } : { lookActive: "l1" });
    const c = crypto();
    const db = fakeDatabase([seed(oldCrypto, { id: 1 }), seed(oldCrypto, { id: 2 })]);
    const before = db.table[0][witness];

    // 模擬另一個 process 喺 SELECT 同 UPDATE 之間換走咗第一行嘅 key。
    const originalQuery = db.query.bind(db);
    db.query = async (sql, params) => {
      const result = await originalQuery(sql, params);
      if (sql.includes(`WHERE ${keyColumn}`)) db.table[0][keyColumn] = toKey;
      return result;
    };

    const report = await runRotation({ database: db, crypto: c, kind, from: fromKey, to: toKey });

    assert.deepEqual(db.table[0][witness], before,
      "the guard must refuse to write a row whose key id no longer matches the one we read");
    assert.equal(db.table[1][keyColumn], toKey, "the untouched row still rotates");
    assert.equal(report.remaining, 0);
  });
}

/**
 * REV-052 M-1。一個打錯咗嘅 `--from` 之前會行到尾，然後報
 * `processed 0 / failed 0 / remaining 0 / safeToRemoveFromKey true` 同 exit 0 ——
 * **同一個做完咗嘅輪替一模一樣**。Operator 收到嘅係「做完，可以剷 key」。
 */
test("refuses a --from that is not in the ring, instead of reporting a finished rotation", async () => {
  const c = crypto();
  const db = fakeDatabase([]);
  await assert.rejects(
    () => runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "TYPO", to: "e2" }),
    /--from key id TYPO is not in the encryption ring/u
  );
  // Lookup 嗰邊查嘅要係 lookup ring，唔係 encryption ring。
  await assert.rejects(
    () => runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.LOOKUP, from: "e1", to: "l2" }),
    /not in the lookup ring/u,
    "an encryption key id must not be accepted as a lookup source"
  );
  // 一個真係喺 ring 入面嘅 from 照樣行得到。
  const ok = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2" });
  assert.equal(ok.processed, 0);
});

/**
 * REV-052 M-2。`AND id > ?` 係令個迴圈會停嘅嗰一句。之前個 double 自己硬寫咗佢，
 * 所以剷走佢 356 條測試照綠，而喺真 MySQL 上面會永遠攞返同一批行。
 */
test("the cursor advances, so a rotation terminates instead of re-reading the same batch", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const db = fakeDatabase([1, 2, 3, 4, 5].map((id) => seed(oldCrypto, { id })), { failOn: new Set([1, 2, 3, 4, 5]) });

  const batches = [];
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    const result = await originalQuery(sql, params);
    if (sql.includes("ORDER BY id")) batches.push(result[0].map((r) => r.id));
    return result;
  };

  // 每行都會失敗，所以冇一行會離開「舊 key」—— 個迴圈只可以靠 cursor 前進。
  const report = await runRotation({
    database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2", batchSize: 2
  });

  assert.equal(report.failed, 5, "every row is attempted exactly once");
  const seen = batches.flat();
  assert.deepEqual(seen, [...new Set(seen)], "no row may be re-read: the cursor must move past a failed row");
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
});

/**
 * REV-052 M-3。`safeReason` 個 `named` 分支之前對 crypto 係死嘅 —— crypto 掟純
 * Error／TypeError，一個 code 都冇 —— 所以每個 crypto 失敗都報 `UNKNOWN`，而
 * 嗰個正正係實作報告 §5 當成特點嚟寫嘅 fail-closed 情境。
 */
test("a tampered row is reported by name, not as UNKNOWN", async () => {
  const oldCrypto = crypto({ encActive: "e1" });
  const c = crypto();
  const rows = [seed(oldCrypto, { id: 1 })];
  // 改一個 byte：AAD／auth tag 就對唔上，crypto 會掟「被竄改」。
  rows[0].account_ciphertext = Buffer.from(rows[0].account_ciphertext);
  rows[0].account_ciphertext[0] ^= 0xff;
  const db = fakeDatabase(rows);

  const report = await runRotation({ database: db, crypto: c, kind: ROTATION_KINDS.ENCRYPTION, from: "e1", to: "e2" });

  assert.equal(report.failed, 1);
  assert.equal(report.failures[0].reason, "BANK_ACCOUNT_TAMPERED",
    "an operator must be able to tell a tampered row from an unclassified failure");
  assert.notEqual(report.failures[0].reason, "UNKNOWN");
  // 而個 reason 仍然唔可以帶住任何資料。
  assert.ok(!JSON.stringify(report).includes(rows[0].account_ciphertext.toString("hex").slice(0, 12)));
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
  // 邊界：啱啱三條係設計容許嘅上限，亦都係過渡期嘅正常狀態 —— 唔可以警告。
  // 冇呢句，一個 `>` 改 `>=` 嘅 mutant 會生還。（REV-051）
  assert.deepEqual(codes(ringWarnings({ crypto: crypto({ encRing: { e1: KEY_A, e2: KEY_B, e3: KEY_C } }) })), [],
    "exactly three keys is the permitted maximum");
  // Lookup 嗰半一樣要有嘢釘住 —— 拆走佢之前冇任何測試會紅。
  assert.deepEqual(ringWarnings({ crypto: crypto({ lookRing: { l1: KEY_A, l2: KEY_B, l3: KEY_C, l4: KEY_A } }) })
    .map((w) => w.kind), ["lookup"]);

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
