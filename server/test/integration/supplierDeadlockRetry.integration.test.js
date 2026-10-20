import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";

import { normalizeIdentifier } from "../../src/modules/supplier/supplierNormalization.js";
import { createSupplierHarness } from "./supplierHttpHarness.js";
import { ADMIN_CONFIG } from "./supplierScratchDatabase.js";

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
  await h.start();
  h.users.mgmt = await h.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
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
 * 再 rollback blocker。回傳兩個 response 同 InnoDB 嘅 deadlock 計數變化。
 */
async function forcedDeadlock(table, blocker, requests) {
  const holder = await mysql.createConnection({ ...ADMIN_CONFIG(), database: process.env.DB_NAME });
  try {
    const [[before]] = await admin.query("SELECT COUNT AS n FROM information_schema.innodb_metrics WHERE NAME = 'lock_deadlocks'");
    await holder.beginTransaction();
    await blocker(holder);
    const pending = requests.map((send) => send());
    assert.equal(await waitersOn(table, 2), 2, "both requests queue behind the uncommitted duplicate");
    await holder.rollback();
    const responses = await Promise.all(pending);
    const [[afterwards]] = await admin.query("SELECT COUNT AS n FROM information_schema.innodb_metrics WHERE NAME = 'lock_deadlocks'");
    return { responses, deadlocks: Number(afterwards.n) - Number(before.n) };
  } finally {
    await holder.end();
  }
}

integrationTest("DEF-031 (HD-115 A): two Suppliers adding the same identifier at the same moment get one 201 and one 409, never a 500, even when InnoDB picks one as a deadlock victim", async () => {
  const t = tag();
  // blocker 用第三個 Supplier：佢嘅 FK 檢查會鎖住自己嗰行 Supplier，唔可以係兩個請求之一。
  const [left, right, third] = [await h.seedSupplier(`DLK-A-${t}`, `Deadlock A ${t}`, "draft"),
    await h.seedSupplier(`DLK-B-${t}`, `Deadlock B ${t}`, "draft"), await h.seedSupplier(`DLK-C-${t}`, `Deadlock C ${t}`, "draft")];
  const value = `DLK${t}`;
  const { key } = normalizeIdentifier({ type: "business_registration", issuerCountryCode: "HK", value });
  const add = (supplierId) => () => h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:supplierId/identifiers/create"),
    { ids: { supplierId }, body: { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: value } });
  const { responses, deadlocks } = await forcedDeadlock("supplier_identifiers",
    (connection) => connection.query(
      `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
       VALUES (?, 'business_registration', 'HK', ?, ?, 1, 1)`, [third, value, key]),
    [add(left), add(right)]);
  assert.equal(deadlocks, 1, "control: InnoDB really rolled one request back as a deadlock");
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
  const change = ({ supplierId, id, version }) => () => h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/update"),
    { ids: { supplierId, identifierId: id }, body: { version, identifierType: "business_registration", issuerCountryCode: "HK",
      identifierValue: value, notes: "", reason: "DEF-031 race" } });
  const { responses, deadlocks } = await forcedDeadlock("supplier_identifiers",
    (connection) => connection.query(
      `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
       VALUES (?, 'business_registration', 'HK', ?, ?, 1, 1)`, [third, value, key]),
    identifiers.map(change));
  assert.equal(deadlocks, 1, "control: InnoDB really rolled one request back as a deadlock");
  assert.deepEqual(responses.map((response) => `${response.status} ${response.code ?? ""}`.trim()).sort(), ["200", "409 SUPPLIER_IDENTIFIER_TAKEN"],
    responses.map((response) => response.text).join(" | "));
  await h.db.query("DELETE FROM supplier_identifiers WHERE supplier_id IN (?, ?)", [left, right]);
});

integrationTest("DEF-031 (HD-115 A): two creates of the same Supplier Code at the same moment get one 201 and one 409, never a 500, even when InnoDB picks one as a deadlock victim", async () => {
  const code = `DLK-N-${tag()}`;
  const create = (index) => async () => {
    const response = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/create"),
      { body: { supplierCode: code, supplierName: `Deadlock Create ${code} ${index}`, defaultCurrencyCode: "HKD" } });
    if (response.status === 201) h.supplierIds.push(response.json.data.id);
    return response;
  };
  const { responses, deadlocks } = await forcedDeadlock("suppliers",
    (connection) => connection.query(
      `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
         website, general_phone, general_email, notes, status, created_at, updated_at)
       VALUES (?, ?, 'Blocker', 'blocker', '', 'HKD', '', '', '', '', 'draft', 1, 1)`, [code, code.toLowerCase()]),
    [create(0), create(1)]);
  assert.equal(deadlocks, 1, "control: InnoDB really rolled one request back as a deadlock");
  assert.deepEqual(responses.map((response) => `${response.status} ${response.code ?? ""}`.trim()).sort(), ["201", "409 SUPPLIER_CODE_TAKEN"],
    responses.map((response) => response.text).join(" | "));
});
