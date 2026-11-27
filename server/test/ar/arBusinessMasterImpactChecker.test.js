/**
 * AR 對 Business Master 的影響檢查（不連資料庫；真 SQL 在 arMigrations.integration.test.js 驗）。
 * Business Master 用它判斷一個幣別還有沒有進行中的 AR 單據；結果不對或分類不了就必須 fail closed。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ArBusinessMasterImpactChecker } from "../../src/modules/ar/ArBusinessMasterImpactChecker.js";

function fakeDatabase({ present = 2, creditPresent = 0, rows = [] } = {}) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    return sql.includes("information_schema.tables") ? [[{ present, credit_present: creditPresent }]] : [rows];
  } };
}
const row = (document_type, status, unsettled, reference_count, extra = {}) => ({ document_type, status, unsettled, reference_count,
  version_sum: reference_count, latest_updated_at: 1000, max_id: 7, ...extra });
const check = (options, subject = { entityType: "CURRENCY", entityKey: "HKD" }) => new ArBusinessMasterImpactChecker({ database: fakeDatabase(options) }).check(subject);

test("drafts and unsettled confirmed documents are open; settled, void and cancelled ones are historical", async () => {
  const database = fakeDatabase({ rows: [row("invoice", "CANCELLED", 1, 1), row("invoice", "CONFIRMED", 0, 2), row("invoice", "CONFIRMED", 1, 4), row("invoice", "DRAFT", 1, 8),
    row("invoice", "VOID", 1, 16), row("receipt", "CANCELLED", 1, 32), row("receipt", "CONFIRMED", 0, 64), row("receipt", "CONFIRMED", 1, 128), row("receipt", "DRAFT", 1, 256),
    row("receipt", "VOID", 0, 512)] });
  const result = await new ArBusinessMasterImpactChecker({ database }).check({ entityType: "CURRENCY", entityKey: "HKD" });
  assert.deepEqual({ ...result, watermark: undefined }, { status: "READY", activeDefaultCount: 0, openUseCount: 4 + 8 + 128 + 256, historicalCount: 1 + 2 + 16 + 32 + 64 + 512, watermark: undefined });
  assert.match(result.watermark, /^ar:CURRENCY:HKD:[0-9a-f]{64}$/u);
  // 幣別代碼一定是參數，發票及收款各查一次。
  const lookup = database.calls.at(-1);
  assert.deepEqual(lookup.params, ["HKD", "HKD"]);
  assert.match(lookup.sql, /FROM ar_invoices WHERE currency_code = \? GROUP BY status, unsettled/u);
  assert.match(lookup.sql, /FROM ar_receipts WHERE currency_code = \? GROUP BY status, unsettled/u);
});

test("no AR tables means not installed; no reference, and any payment term, is ready with zero counts", async () => {
  assert.deepEqual(await check({ present: 0 }), { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed:ar" });
  const empty = await check({});
  assert.deepEqual([empty.status, empty.openUseCount, empty.historicalCount], ["READY", 0, 0]);
  // AR 不保存付款條款 ID（只保存代碼及名稱的快照），所以條款沒有引用，亦不查單據表。
  const database = fakeDatabase({ rows: [row("invoice", "DRAFT", 1, 5)] });
  const term = await new ArBusinessMasterImpactChecker({ database }).check({ entityType: "PAYMENT_TERM", entityKey: "12" });
  assert.deepEqual(term, { status: "READY", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "ar:PAYMENT_TERM:12:no-reference" });
  assert.equal(database.calls.length, 1);
});

test("credit drafts, credit with a positive available balance and refund drafts count as open currency use", async () => {
  const database = fakeDatabase({ creditPresent: 2, rows: [
    row("credit_note", "DRAFT", 1, 1), row("credit_note", "CONFIRMED", 1, 2), row("credit_note", "CONFIRMED", 0, 1),
    row("credit_note", "VOID", 0, 1), row("refund", "DRAFT", 0, 1), row("refund", "CONFIRMED", 0, 1), row("refund", "CANCELLED", 0, 1)
  ] });
  const result = await new ArBusinessMasterImpactChecker({ database }).check({ entityType: "CURRENCY", entityKey: "HKD" });
  assert.deepEqual([result.openUseCount, result.historicalCount], [4, 4]);
  assert.deepEqual(database.calls.at(-1).params, ["HKD", "HKD", "HKD", "HKD"]);
});

test("the watermark changes when a referencing document changes and only then", async () => {
  const mark = (rows) => check({ rows }).then((result) => result.watermark);
  const base = await mark([row("invoice", "DRAFT", 1, 1)]);
  assert.equal(await mark([row("invoice", "DRAFT", 1, 1)]), base);
  for (const changed of [[row("invoice", "DRAFT", 1, 1, { version_sum: 2 })], [row("invoice", "DRAFT", 1, 1, { latest_updated_at: 1001 })],
    [row("invoice", "DRAFT", 1, 1, { max_id: 8 })], [row("invoice", "CONFIRMED", 1, 1)], [row("invoice", "CONFIRMED", 0, 1)], [row("receipt", "DRAFT", 1, 1)], []]) {
    assert.notEqual(await mark(changed), base, JSON.stringify(changed));
  }
});

test("anything it cannot classify or trust fails closed instead of reporting no use", async () => {
  await assert.rejects(check({ rows: [row("invoice", "PAID", 1, 1)] }), /Unclassified AR impact status/u);
  await assert.rejects(check({ creditPresent: 2, rows: [row("refund", "PAID", 0, 1)] }), /Unclassified AR impact status/u);
  await assert.rejects(check({ rows: [row("invoice", "DRAFT", 1, -1)] }), /Invalid AR impact reference_count/u);
  await assert.rejects(check({ rows: [row("invoice", "DRAFT", 1, 1, { max_id: "x" })] }), /Invalid AR impact max_id/u);
  await assert.rejects(check({ rows: [row("invoice", "DRAFT", 1, Number.MAX_SAFE_INTEGER), row("receipt", "DRAFT", 1, 1)] }), /count overflow/u);
  await assert.rejects(check({ present: 1 }), /schema is incomplete/u); // 只有一張表：不可當作沒有引用。
  await assert.rejects(check({ creditPresent: 1 }), /schema is incomplete/u);
  await assert.rejects(check({ present: 0, creditPresent: 2 }), /schema is incomplete/u);
  for (const subject of [{ entityType: "CURRENCY", entityKey: "hkd" }, { entityType: "CURRENCY", entityKey: 1 }, { entityType: "PAYMENT_TERM", entityKey: "0" },
    { entityType: "PAYMENT_TERM", entityKey: "1.5" }, { entityType: "CUSTOMER", entityKey: "1" }, {}]) {
    await assert.rejects(check({}, subject), TypeError);
  }
  assert.throws(() => new ArBusinessMasterImpactChecker({ database: {} }), TypeError);
});
