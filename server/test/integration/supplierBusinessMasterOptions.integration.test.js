import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { createSupplierHarness } from "./supplierHttpHarness.js";

/**
 * DEF-036（HD-126 A）：CLERK（supplier.view＋supplier.mgmt，冇 business_master.view）喺真 app、真 MySQL 讀到表單用嘅
 * 幣別同付款條件，而且只有 Active。Business Master 嗰兩條 list 對同一個人仍然係 403，即係冇放寬佢哋。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = createSupplierHarness("d036");
const tag = randomUUID().replace(/[^a-z]/gu, "").slice(0, 3).toUpperCase().padEnd(3, "Q");
const inactiveCurrency = `Z${tag.slice(0, 2)}`;
const inactiveTerm = `D036-${tag}`;
const activeTerm = `D036A-${tag}`;
let clerk;

const get = (path) => h.send(clerk, { key: `GET ${path}`, method: "GET", path, authType: "jwt", idempotent: false });

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  await h.start();
  clerk = await h.makeUser("clerk", ["supplier.view", "supplier.mgmt"]);
  const now = Date.now();
  await h.db.execute("INSERT INTO currencies (code, name, decimal_places, status, version, created_at, updated_at) VALUES (?, 'DEF-036 inactive', 2, 'INACTIVE', 1, ?, ?)",
    [inactiveCurrency, now, now]);
  h.cleanup.push(["DELETE FROM currencies WHERE code = ?", [inactiveCurrency]]);
  await h.db.execute(`INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
    VALUES (?, ?, 'DEF-036 inactive', 'NET_DAYS', 30, 'INACTIVE', 1, ?, ?)`, [inactiveTerm, inactiveTerm, now, now]);
  h.cleanup.push(["DELETE FROM payment_terms WHERE code_key = ?", [inactiveTerm]]);
  await h.db.execute(`INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
    VALUES (?, ?, 'DEF-036 active', 'NET_DAYS', 30, 'ACTIVE', 1, ?, ?)`, [activeTerm, activeTerm, now, now]);
  h.cleanup.push(["DELETE FROM payment_terms WHERE code_key = ?", [activeTerm]]);
});

after(async () => {
  if (process.env.DB_INTEGRATION_TESTS === "1") await h.stop();
});

integrationTest("a CLERK reads the Active currencies and payment terms the Supplier forms offer, and only those", async () => {
  const currencies = await get("/api/v1/supplier-lookups/currencies");
  assert.equal(currencies.status, 200, currencies.text);
  assert.ok(currencies.json.data.items.some((item) => item.code === "HKD"), "HKD is seeded Active");
  assert.ok(currencies.json.data.items.every((item) => item.status === "ACTIVE"));
  assert.equal(currencies.json.data.items.some((item) => item.code === inactiveCurrency), false, "an Inactive currency is not offered");
  assert.deepEqual(Object.keys(currencies.json.data.items[0]).sort(), ["code", "decimalPlaces", "name", "status", "version"]);

  const terms = await get("/api/v1/supplier-lookups/payment-terms");
  assert.equal(terms.status, 200, terms.text);
  assert.ok(terms.json.data.items.every((item) => item.status === "ACTIVE"));
  assert.equal(terms.json.data.items.some((item) => item.code === inactiveTerm), false, "an Inactive payment term is not offered");
  assert.ok(terms.json.data.items.some((item) => item.code === activeTerm), "an Active payment term is offered");
  assert.deepEqual(Object.keys(terms.json.data.items[0]).sort(), ["calculationType", "code", "dueDays", "id", "name", "status", "version"]);
});

integrationTest("the Business Master lists themselves still refuse the same CLERK", async () => {
  // 冇郁 Business Master：佢嘅 VIEW_POLICY 仲包住佢嘅稽核記錄（HD-022），所以 Supplier 用自己嘅 lookup。
  assert.equal((await get("/api/v1/business-master/currencies")).status, 403);
  assert.equal((await get("/api/v1/business-master/payment-terms")).status, 403);
});
