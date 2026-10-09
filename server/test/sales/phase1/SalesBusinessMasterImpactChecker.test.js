import assert from "node:assert/strict";
import test from "node:test";
import { SalesBusinessMasterImpactChecker } from "../../../src/modules/sales/SalesBusinessMasterImpactChecker.js";

const installed = [{ name: "sales_orders" }, { name: "sales_quotations" }];
function fixture(tables = installed, rows = []) {
  const calls = [];
  const checker = new SalesBusinessMasterImpactChecker({ database: { async query(sql, args) {
    calls.push({ sql, args }); return [calls.length % 2 === 1
      ? [{ present: tables.length, archived: Number(tables.some(row => row.name === "sales_orders_archive")) }] : rows];
  } } });
  return { checker, calls };
}
const subject = { entityType: "CURRENCY", entityKey: "HKD" };
const row = (document_type, status, reference_count = 1) => ({ document_type, status, reference_count, version_sum: reference_count, latest_updated_at: 1, max_id: 1 });

test("Sales impact classifies all persisted document statuses and exposes only aggregate counts", async () => {
  const rows = ["DRAFT", "ISSUED", "EXPIRED", "CONVERTED", "CANCELLED"].map(status => row("quotation", status));
  rows.push(...["DRAFT", "CONFIRMING", "CONFIRMED", "PARTIALLY_FULFILLED", "COMPLETED", "CLOSED", "CANCELLED"].map(status => row("order", status)));
  const { checker, calls } = fixture(installed, rows);
  const result = await checker.check(subject);
  assert.deepEqual({ ...result, watermark: undefined }, { status: "READY", activeDefaultCount: 0, openUseCount: 6, historicalCount: 6, watermark: undefined });
  assert.match(result.watermark, /^sales:CURRENCY:HKD:[a-f0-9]{64}$/u);
  assert.deepEqual(calls[1].args, ["HKD", "HKD"]);
  assert.match(calls[1].sql, /UNION ALL/u);
  assert.doesNotMatch(calls[1].sql, /customer_name|notes|SELECT \*/u);
});

test("Sales impact empty installation is READY; absence, partial schemas and archive installation stay distinct", async () => {
  assert.equal((await fixture().checker.check(subject)).status, "READY");
  assert.equal((await fixture([], []).checker.check(subject)).status, "NOT_INSTALLED");
  for (const tables of [[installed[0]], [...installed, { name: "sales_orders_archive" }]]) {
    await assert.rejects(() => fixture(tables).checker.check(subject), /schema/u);
  }
});

test("Sales impact validates keys, status and arithmetic; Payment Term uses bound IDs", async () => {
  for (const value of [{ entityType: "CURRENCY", entityKey: "HKD'" }, { entityType: "PAYMENT_TERM", entityKey: -1 },
    { entityType: "PAYMENT_TERM", entityKey: "9007199254740992" }, { entityType: "OTHER", entityKey: 1 }]) {
    const { checker, calls } = fixture();
    await assert.rejects(() => checker.check(value), TypeError); assert.equal(calls.length, 0);
  }
  const { checker, calls } = fixture();
  await checker.check({ entityType: "PAYMENT_TERM", entityKey: "17" });
  assert.deepEqual(calls[1].args, [17, 17]); assert.match(calls[1].sql, /payment_term_id = \?/u);
  for (const rows of [[row("order", "UNKNOWN")], [row("quotation", "DRAFT", -1)],
    [row("order", "DRAFT", Number.MAX_SAFE_INTEGER), row("quotation", "DRAFT", 1)]]) {
    await assert.rejects(() => fixture(installed, rows).checker.check(subject));
  }
});

test("Sales impact watermark changes when references or versions change and database errors fail closed", async () => {
  const rows = [row("order", "DRAFT")], { checker } = fixture(installed, rows);
  const before = await checker.check(subject);
  rows[0].version_sum++; assert.notEqual((await checker.check(subject)).watermark, before.watermark);
  rows[0].reference_count++; assert.notEqual((await checker.check(subject)).watermark, before.watermark);
  const failing = new SalesBusinessMasterImpactChecker({ database: { async query() { throw new Error("unavailable"); } } });
  await assert.rejects(() => failing.check(subject), /unavailable/u);
});
