/**
 * HD-013：Purchasing 對 Business Master 嘅影響檢查。Business Master 用佢判斷一個 Currency／Payment Term
 * 仲有冇進行中嘅 PO；結果唔啱或者分類唔晒就要 fail closed（BusinessMasterImpactRegistry 會轉成 UNAVAILABLE）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HISTORICAL_PO_STATUSES, OPEN_PO_STATUSES, PurchasingBusinessMasterImpactChecker
} from "../../src/modules/purchasing/PurchasingBusinessMasterImpactChecker.js";

function fakeDatabase({ present = 1, rows = [] } = {}) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("information_schema.tables")) return [[{ present }]];
    return [rows];
  } };
}

const row = (status, reference_count, extra = {}) => ({ status, reference_count, version_sum: reference_count,
  latest_updated_at: 1000, max_id: 7, ...extra });

test("HD-013 open and historical counts follow the PO status a document is in", async () => {
  const database = fakeDatabase({ rows: [row("CANCELLED", 1), row("CLOSED", 2), row("CONFIRMED", 3), row("DRAFT", 4),
    row("FULLY_RECEIVED", 5), row("PARTIALLY_RECEIVED", 6), row("PENDING_APPROVAL", 7)] });
  const result = await new PurchasingBusinessMasterImpactChecker({ database }).check({ entityType: "CURRENCY", entityKey: "HKD" });
  assert.deepEqual({ ...result, watermark: undefined },
    { status: "READY", activeDefaultCount: 0, openUseCount: 3 + 4 + 6 + 7, historicalCount: 1 + 2 + 5, watermark: undefined });
  assert.match(result.watermark, /^purchasing:CURRENCY:HKD:[0-9a-f]{64}$/u);
  // Key 一定係參數，column 只可以由 entityType 揀。
  const lookup = database.calls.at(-1);
  assert.match(lookup.sql, /WHERE currency_code = \? GROUP BY status/u);
  assert.deepEqual(lookup.params, ["HKD"]);

  const term = fakeDatabase({ rows: [row("DRAFT", 1)] });
  const byTerm = await new PurchasingBusinessMasterImpactChecker({ database: term }).check({ entityType: "PAYMENT_TERM", entityKey: "12" });
  assert.equal(byTerm.openUseCount, 1);
  assert.match(term.calls.at(-1).sql, /WHERE payment_term_id = \?/u);
  assert.deepEqual(term.calls.at(-1).params, [12]);
});

test("HD-013 no purchase_orders table means not installed, and no references means ready with zero counts", async () => {
  const absent = await new PurchasingBusinessMasterImpactChecker({ database: fakeDatabase({ present: 0 }) })
    .check({ entityType: "CURRENCY", entityKey: "HKD" });
  assert.deepEqual(absent, { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0,
    watermark: "not-installed:purchasing" });
  const empty = await new PurchasingBusinessMasterImpactChecker({ database: fakeDatabase() })
    .check({ entityType: "PAYMENT_TERM", entityKey: 3 });
  assert.equal(empty.status, "READY");
  assert.deepEqual([empty.openUseCount, empty.historicalCount], [0, 0]);
});

test("HD-013 the watermark changes when a referencing PO changes and only then", async () => {
  const check = (rows) => new PurchasingBusinessMasterImpactChecker({ database: fakeDatabase({ rows }) })
    .check({ entityType: "CURRENCY", entityKey: "USD" }).then((result) => result.watermark);
  const base = await check([row("DRAFT", 1)]);
  assert.equal(await check([row("DRAFT", 1)]), base);
  for (const changed of [[row("DRAFT", 1, { version_sum: 2 })], [row("DRAFT", 1, { latest_updated_at: 1001 })],
    [row("DRAFT", 1, { max_id: 8 })], [row("CONFIRMED", 1)], [row("DRAFT", 2)]]) {
    assert.notEqual(await check(changed), base);
  }
});

test("HD-013 unclassified statuses, malformed counts and invalid subjects fail closed", async () => {
  const checker = (rows) => new PurchasingBusinessMasterImpactChecker({ database: fakeDatabase({ rows }) });
  await assert.rejects(checker([row("ARCHIVED", 1)]).check({ entityType: "CURRENCY", entityKey: "HKD" }), /Unclassified/u);
  for (const bad of [-1, 1.5, "x", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(checker([row("DRAFT", bad)]).check({ entityType: "CURRENCY", entityKey: "HKD" }), /Invalid Purchasing impact/u);
  }
  for (const subject of [{ entityType: "CURRENCY", entityKey: "hkd" }, { entityType: "CURRENCY", entityKey: "HKDX" },
    { entityType: "PAYMENT_TERM", entityKey: 0 }, { entityType: "PAYMENT_TERM", entityKey: "01" },
    { entityType: "PAYMENT_TERM", entityKey: "9007199254740993" }, { entityType: "SUPPLIER", entityKey: 1 }, undefined]) {
    await assert.rejects(checker([]).check(subject), TypeError, JSON.stringify(subject));
  }
  assert.throws(() => new PurchasingBusinessMasterImpactChecker(), TypeError);
});

test("HD-013 every status the schema allows is classified exactly once", () => {
  // 同 0112 嘅 chk_po_status 綁死：schema 加狀態而呢度唔分類，呢個 test 就會紅。
  const source = readFileSync(new URL("../../database/migrations/0112_create_purchase_orders.js", import.meta.url), "utf8");
  const clause = source.match(/CONSTRAINT chk_po_status CHECK \(status IN \(([^)]*)\)\)/u)[1];
  const allowed = [...clause.matchAll(/'([A-Z_]+)'/gu)].map((match) => match[1]).sort();
  const classified = [...OPEN_PO_STATUSES, ...HISTORICAL_PO_STATUSES];
  assert.equal(new Set(classified).size, classified.length, "no status is both open and historical");
  assert.deepEqual([...classified].sort(), allowed);
});
