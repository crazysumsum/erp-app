import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";

import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";
import { normalizeIdentifier } from "../../src/modules/supplier/supplierNormalization.js";
import { createSupplierHarness } from "./supplierHttpHarness.js";
import { ADMIN, ADMIN_CONFIG } from "./supplierScratchDatabase.js";

/**
 * DEF-031／HD-115 A：兩個請求同時寫同一個 unique 值，InnoDB 偶然會 deadlock；輸咗嗰個要重試一次，
 * 見到贏咗嗰個之後回正常嘅 409，唔可以係 500。
 *
 * 穩定重現：第三個交易先插入同一個值但唔 commit。兩個請求嘅重複檢查都要等佢（S 鎖）；由
 * performance_schema 確認兩個都喺度等之後，第三個 rollback。兩個請求同時攞到 S 鎖、再同時要插入，
 * 一定有一個被 InnoDB 選中 rollback（ER_LOCK_DEADLOCK）。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = Object.assign(createSupplierHarness("dlk31"), { users: {} });
let admin = null;

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  assert.ok(ADMIN.user, "DB_ADMIN_USER is required: the lock waits are read from performance_schema");
  await h.start();
  // 兩個請求用兩個用戶：同一個用戶嘅請求會喺 users 嗰行排隊（authorize），唔會兩個都去到 unique key。
  h.users.mgmt = await h.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
  h.users.other = await h.makeUser("other", ["supplier.view", "supplier.mgmt"]);
  admin = await mysql.createConnection({ ...ADMIN_CONFIG(), database: process.env.DB_NAME });
});

after(async () => {
  await admin?.end();
  await h.stop();
});

const tag = () => randomUUID().slice(0, 8).toUpperCase();

/** 等到 `table` 上面有 `count` 個 lock wait（5 秒內）。 */
async function waitersOn(table, count) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [[row]] = await admin.query(
      `SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
         JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
        WHERE l.OBJECT_SCHEMA = ? AND l.OBJECT_NAME = ?`, [process.env.DB_NAME, table]);
    if (Number(row.n) >= count) return Number(row.n);
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  return 0;
}

/**
 * `blocker` 喺一個冇 commit 嘅交易入面插入同一個值；`requests` 兩個同時送出，等齊兩個都喺 `table` 排隊，
 * 再 rollback blocker。回傳兩個 response，同埋 InnoDB 最近一次 deadlock 係咪就係呢次：計數有加，而且
 * `SHOW ENGINE INNODB STATUS` 最近嗰個 deadlock 喺 blocker 之後發生、喺 `index` 上面。計數係成部 server 嘅，
 * 淨係睇計數會俾其他測試嘅 deadlock 誤導（REV-104 L-1）。Record dump 唔可以用：鎖嘅係下一行嘅 gap，唔係呢次嘅值。
 */
async function forcedDeadlock(table, index, blocker, requests) {
  const holder = await mysql.createConnection({ ...ADMIN_CONFIG(), database: process.env.DB_NAME });
  let pending = [];
  try {
    const [[before]] = await admin.query(
      "SELECT COUNT AS n, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS at FROM information_schema.innodb_metrics WHERE NAME = 'lock_deadlocks'");
    await holder.beginTransaction();
    await blocker(holder);
    pending = requests.map((send) => send());
    assert.equal(await waitersOn(table, 2), 2, "both requests queue behind the uncommitted duplicate");
    await holder.rollback();
    const responses = await Promise.all(pending);
    const [[afterwards]] = await admin.query("SELECT COUNT AS n FROM information_schema.innodb_metrics WHERE NAME = 'lock_deadlocks'");
    const [[status]] = await admin.query("SHOW ENGINE INNODB STATUS");
    const text = status.Status ?? "";
    const latest = text.slice(text.indexOf("LATEST DETECTED DEADLOCK"));
    const at = /\n(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) /u.exec(latest)?.[1] ?? "";
    const deadlocked = Number(afterwards.n) > Number(before.n) && at >= before.at
      && latest.slice(0, latest.indexOf("WE ROLL BACK")).includes(`index ${index} of table \`${process.env.DB_NAME}\`.\`${table}\``);
    return { responses, deadlocked };
  } finally {
    await holder.end();
    // 等唔齊兩個排隊就失敗嗰陣，請求仲喺度：等佢哋完先俾 after() 清資料（REV-104 L-4）。
    await Promise.allSettled(pending);
  }
}

/** 重試要留低 warn（REV-104 L-3）：喺 harness 嘅 log 目錄搵 `operation`。 */
async function retryLogged(operation) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const files = await fs.readdir(h.logRoot, { recursive: true });
    for (const file of files) {
      const text = await fs.readFile(path.join(h.logRoot, file), "utf8").catch(() => "");
      if (text.split("\n").some((line) => line.includes("supplier.write.deadlock_retried") && line.includes(`"${operation}"`))) return true;
    }
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  return false;
}

integrationTest("DEF-031 (HD-115 A): two Suppliers adding the same identifier at the same moment get one 201 and one 409, never a 500, even when InnoDB picks one as a deadlock victim", async () => {
  const t = tag();
  // blocker 用第三個 Supplier：佢嘅 FK 檢查會鎖住自己嗰行 Supplier，唔可以係兩個請求之一。
  const [left, right, third] = [await h.seedSupplier(`DLK-A-${t}`, `Deadlock A ${t}`, "draft"),
    await h.seedSupplier(`DLK-B-${t}`, `Deadlock B ${t}`, "draft"), await h.seedSupplier(`DLK-C-${t}`, `Deadlock C ${t}`, "draft")];
  const value = `DLK${t}`;
  const { key } = normalizeIdentifier({ type: "business_registration", issuerCountryCode: "HK", value });
  const add = (supplierId, user) => () => h.send(user, h.route("POST /api/v1/suppliers/:supplierId/identifiers/create"),
    { ids: { supplierId }, body: { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: value } });
  const { responses, deadlocked } = await forcedDeadlock("supplier_identifiers", "uq_supplier_identifier_value",
    (connection) => connection.query(
      `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
       VALUES (?, 'business_registration', 'HK', ?, ?, 1, 1)`, [third, value, key]),
    [add(left, h.users.mgmt), add(right, h.users.other)]);
  assert.equal(deadlocked, true, "control: InnoDB really rolled one request back as a deadlock on this unique key");
  assert.equal(await retryLogged("supplier.identifier.create"), true, "the retry is logged");
  assert.deepEqual(responses.map((response) => `${response.status} ${response.code ?? ""}`.trim()).sort(), ["201", "409 SUPPLIER_IDENTIFIER_TAKEN"],
    responses.map((response) => response.text).join(" | "));
  const [[row]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_identifiers WHERE identifier_value_key = ?", [key]);
  assert.equal(Number(row.n), 1);
  await h.db.query("DELETE FROM supplier_identifiers WHERE supplier_id IN (?, ?)", [left, right]);
});

integrationTest("DEF-031 (HD-115 A): two Suppliers changing their identifiers to the same value at the same moment get one 200 and one 409, never a 500, even when InnoDB picks one as a deadlock victim", async () => {
  const t = tag();
  const [left, right, third] = [await h.seedSupplier(`DLU-A-${t}`, `Deadlock Update A ${t}`, "draft"),
    await h.seedSupplier(`DLU-B-${t}`, `Deadlock Update B ${t}`, "draft"), await h.seedSupplier(`DLU-C-${t}`, `Deadlock Update C ${t}`, "draft")];
  const identifiers = [];
  for (const [supplierId, value] of [[left, `OLDA${t}`], [right, `OLDB${t}`]]) {
    const created = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:supplierId/identifiers/create"),
      { ids: { supplierId }, body: { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: value } });
    assert.equal(created.status, 201, created.text);
    identifiers.push({ supplierId, id: created.json.data.id, version: created.json.data.version });
  }
  const value = `NEW${t}`;
  const { key } = normalizeIdentifier({ type: "business_registration", issuerCountryCode: "HK", value });
  const change = ({ supplierId, id, version }, index) => () => h.send(index ? h.users.other : h.users.mgmt,
    h.route("POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/update"),
    { ids: { supplierId, identifierId: id }, body: { version, identifierType: "business_registration", issuerCountryCode: "HK",
      identifierValue: value, notes: "", reason: "DEF-031 race" } });
  const { responses, deadlocked } = await forcedDeadlock("supplier_identifiers", "uq_supplier_identifier_value",
    (connection) => connection.query(
      `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
       VALUES (?, 'business_registration', 'HK', ?, ?, 1, 1)`, [third, value, key]),
    identifiers.map(change));
  assert.equal(deadlocked, true, "control: InnoDB really rolled one request back as a deadlock on this unique key");
  assert.equal(await retryLogged("supplier.identifier.update"), true, "the retry is logged");
  assert.deepEqual(responses.map((response) => `${response.status} ${response.code ?? ""}`.trim()).sort(), ["200", "409 SUPPLIER_IDENTIFIER_TAKEN"],
    responses.map((response) => response.text).join(" | "));
  await h.db.query("DELETE FROM supplier_identifiers WHERE supplier_id IN (?, ?)", [left, right]);
});

integrationTest("DEF-031 (HD-115 A): two creates of the same Supplier Code at the same moment get one 201 and one 409, never a 500, even when InnoDB picks one as a deadlock victim", async () => {
  const code = `DLK-N-${tag()}`;
  const create = (index) => async () => {
    const response = await h.send(index ? h.users.other : h.users.mgmt, h.route("POST /api/v1/suppliers/create"),
      { body: { supplierCode: code, supplierName: `Deadlock Create ${code} ${index}`, defaultCurrencyCode: "HKD" } });
    if (response.status === 201) h.supplierIds.push(response.json.data.id);
    return response;
  };
  const { responses, deadlocked } = await forcedDeadlock("suppliers", "uq_suppliers_code_key",
    (connection) => connection.query(
      `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
         website, general_phone, general_email, notes, status, created_at, updated_at)
       VALUES (?, ?, 'Blocker', 'blocker', '', 'HKD', '', '', '', '', 'draft', 1, 1)`, [code, code.toLowerCase()]),
    [create(0), create(1)]);
  assert.equal(deadlocked, true, "control: InnoDB really rolled one request back as a deadlock on this unique key");
  assert.equal(await retryLogged("supplier.create"), true, "the retry is logged");
  assert.deepEqual(responses.map((response) => `${response.status} ${response.code ?? ""}`.trim()).sort(), ["201", "409 SUPPLIER_CODE_TAKEN"],
    responses.map((response) => response.text).join(" | "));
});

integrationTest("DEF-031 (HD-115 A, REV-104 M-1): two Suppliers changing to the same Supplier Code at the same moment get one 200 and one 409, never a 500, even when InnoDB picks one as a deadlock victim", async () => {
  const t = tag();
  const [left, right] = [await h.seedSupplier(`DLM-A-${t}`, `Deadlock Code A ${t}`, "draft"), await h.seedSupplier(`DLM-B-${t}`, `Deadlock Code B ${t}`, "draft")];
  const target = `DLM-T-${t}`;
  const change = (id, user) => () => h.send(user, h.route("POST /api/v1/suppliers/:id/code/change"),
    { ids: { id }, body: { supplierCode: target, reason: "DEF-031 race", version: 1 } });
  const { responses, deadlocked } = await forcedDeadlock("suppliers", "uq_suppliers_code_key",
    (connection) => connection.query(
      `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
         website, general_phone, general_email, notes, status, created_at, updated_at)
       VALUES (?, ?, 'Blocker', 'blocker', '', 'HKD', '', '', '', '', 'draft', 1, 1)`, [target, target.toLowerCase()]),
    [change(left, h.users.mgmt), change(right, h.users.other)]);
  assert.equal(deadlocked, true, "control: InnoDB really rolled one request back as a deadlock on this unique key");
  assert.equal(await retryLogged("supplier.code.change"), true, "the retry is logged");
  assert.deepEqual(responses.map((response) => `${response.status} ${response.code ?? ""}`.trim()).sort(), ["200", "409 SUPPLIER_CODE_TAKEN"],
    responses.map((response) => response.text).join(" | "));
});

integrationTest("DEF-024 (HD-116 A, REV-106 M-1): two new Suppliers getting their first default bank account at the same moment both succeed, even when InnoDB picks one as a deadlock victim", async () => {
  // 兩個相鄰嘅新 Supplier 都未有帳戶：`#activeRowsForUpdate` 喺同一段空範圍攞 gap lock，之後兩邊嘅 INSERT 互相等。
  const t = tag();
  const suppliers = [await h.seedSupplier(`DLB-A-${t}`, `Deadlock Bank A ${t}`, "draft"), await h.seedSupplier(`DLB-B-${t}`, `Deadlock Bank B ${t}`, "draft")];
  // 兩個交易都鎖完「呢個 Supplier 嘅 active 帳戶」先放行（只係第一次；重試唔再等）。
  let arrived = 0;
  let release;
  const bothLocked = new Promise((resolve) => { release = resolve; });
  const database = {
    query: (...args) => h.db.query(...args),
    withTransaction: (work) => h.db.withTransaction((connection) => work(new Proxy(connection, {
      get(target, property) {
        const value = target[property];
        if (property !== "query" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
        return async (sql, ...rest) => {
          const result = await value.call(target, sql, ...rest);
          if (/FROM supplier_bank_accounts\s+WHERE supplier_id = \? AND status = \? ORDER BY id FOR UPDATE/u.test(String(sql)) && arrived < 2) {
            arrived += 1;
            if (arrived === 2) release();
            await bothLocked;
          }
          return result;
        };
      }
    })))
  };
  const warnings = [];
  const service = new SupplierBankService({
    database, time: { nowMs: () => Date.now() },
    logger: { warn: (event, message, context) => warnings.push([event, context]), info() {}, error() {} },
    crypto: new SupplierBankCrypto({ encryption: h.application.services.config.supplier.bankEncryption,
      lookup: h.application.services.config.supplier.bankLookup }),
    authorize: async () => ({ id: null, username: "dlk31-bank", permissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"] }),
    audit: { async record() {} }
  });
  const [[before]] = await admin.query("SELECT COUNT AS n FROM information_schema.innodb_metrics WHERE NAME = 'lock_deadlocks'");
  const results = await Promise.allSettled(suppliers.map((supplierId, index) => service.create({ actorId: null, claimedRoles: [], claimedPermissions: [],
    supplierId, accountHolderName: `Holder ${index}`, bankName: "Bank", accountNumber: `5${t.replace(/\D/gu, "1").padEnd(8, "1")}${index}`,
    isDefault: true, reason: "DEF-024 race", requestId: `dlb-${index}` })));
  const [[afterwards]] = await admin.query("SELECT COUNT AS n FROM information_schema.innodb_metrics WHERE NAME = 'lock_deadlocks'");
  assert.ok(Number(afterwards.n) > Number(before.n), "control: InnoDB really rolled one create back as a deadlock");
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"], results.map((result) => result.reason?.message ?? "ok").join(" | "));
  assert.equal(warnings.filter(([event, context]) => event === "supplier.write.deadlock_retried" && context.operation === "supplier.bank.create").length, 1,
    "the retry is logged");
  const [rows] = await h.db.query("SELECT supplier_id, is_default FROM supplier_bank_accounts WHERE supplier_id IN (?) ORDER BY supplier_id", [suppliers]);
  assert.deepEqual(rows.map((row) => [Number(row.supplier_id), Number(row.is_default)]), suppliers.map((id) => [id, 1]), "each Supplier has its one default account");
});
