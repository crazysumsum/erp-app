import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPLIER_PO_COUNT_SQL,
  openPurchaseOrderChecker,
  purchaseOrderReferenceChecker
} from "../../src/modules/purchasing/PurchasingSupplierReferenceCheckers.js";

// TL ruling 4（purchasing-cross-module-rulings-20261117）：Purchasing 俾 Supplier 兩個 checker。
function connection(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push([sql, params]);
      return [rows];
    }
  };
}

test("TL ruling 4: the reference checker sends one locking GROUP BY read on the caller's connection and counts every classified status", async () => {
  const fake = connection([
    { status: "DRAFT", reference_count: 1 }, { status: "CONFIRMED", reference_count: 2 },
    { status: "CLOSED", reference_count: 3 }, { status: "CANCELLED", reference_count: 4 }
  ]);
  assert.equal(await purchaseOrderReferenceChecker.count(fake, 7), 10);
  assert.deepEqual(fake.calls, [[SUPPLIER_PO_COUNT_SQL, [7]]]);
  assert.match(SUPPLIER_PO_COUNT_SQL, /WHERE supplier_id = \? GROUP BY status FOR SHARE$/u);
  assert.equal(purchaseOrderReferenceChecker.name, "採購單");
});

test("TL ruling 4: the open-flow checker counts only open PO statuses", async () => {
  const fake = connection([
    { status: "DRAFT", reference_count: 1 }, { status: "PENDING_APPROVAL", reference_count: 1 },
    { status: "CONFIRMED", reference_count: 1 }, { status: "PARTIALLY_RECEIVED", reference_count: 1 },
    { status: "FULLY_RECEIVED", reference_count: 5 }, { status: "CLOSED", reference_count: 5 }, { status: "CANCELLED", reference_count: 5 }
  ]);
  assert.equal(await openPurchaseOrderChecker.count(fake, 7), 4);
  assert.equal(await openPurchaseOrderChecker.count(connection([]), 7), 0);
  assert.equal(openPurchaseOrderChecker.name, "未完成採購單");
});

test("TL ruling 4: an unclassified PO status fails closed in both checkers", async () => {
  for (const checker of [purchaseOrderReferenceChecker, openPurchaseOrderChecker]) {
    await assert.rejects(() => checker.count(connection([{ status: "ON_HOLD", reference_count: 1 }]), 7), /Unclassified Purchasing PO status/u);
  }
});

test("TL ruling 4: a count that is not a non-negative safe integer is refused", async () => {
  for (const value of [-1, 1.5, "x", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => purchaseOrderReferenceChecker.count(connection([{ status: "DRAFT", reference_count: value }]), 7),
      /Invalid Purchasing Supplier reference count/u,
      String(value)
    );
  }
});
