import assert from "node:assert/strict";
import test from "node:test";

import { assertSupplierDeletable, transitionSupplierStatus } from "../src/modules/supplier/supplierStateMachine.js";

test("Supplier lifecycle accepts every documented transition and makes same-target retries idempotent", () => {
  const allowed = [
    ["draft", "active"], ["draft", "pending_approval"], ["draft", "archived"],
    ["pending_approval", "active"], ["pending_approval", "draft"],
    ["active", "suspended"], ["active", "blocked"], ["active", "archived"],
    ["suspended", "active"], ["suspended", "blocked"], ["suspended", "archived"],
    ["blocked", "suspended"], ["archived", "suspended"]
  ];
  for (const [from, to] of allowed) {
    assert.deepEqual(transitionSupplierStatus(from, to), { from, to, changed: true });
  }
  assert.deepEqual(transitionSupplierStatus("active", "active"), { from: "active", to: "active", changed: false });
});

test("Supplier lifecycle rejects undocumented transitions and never unblocks or restores directly to Active", () => {
  for (const [from, to] of [["blocked", "active"], ["archived", "active"], ["pending_approval", "suspended"], ["draft", "blocked"]]) {
    assert.throws(() => transitionSupplierStatus(from, to), (error) => error.publicCode === "STATUS_TRANSITION_INVALID");
  }
});

test("permanent deletion only accepts an unreferenced Draft", () => {
  assert.doesNotThrow(() => assertSupplierDeletable("draft", { total: 0, references: {} }));
  assert.throws(() => assertSupplierDeletable("active", { total: 0, references: {} }), (error) => error.publicCode === "SUPPLIER_DELETE_NOT_ALLOWED");
  assert.throws(() => assertSupplierDeletable("draft", { total: 1, references: { purchaseOrders: 1 } }), (error) => error.publicCode === "SUPPLIER_REFERENCED");
});
