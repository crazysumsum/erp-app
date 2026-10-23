import assert from "node:assert/strict";
import test from "node:test";
import { withPurchaseUnitRequest } from "../test-support/inventoryPurchaseFixtures.js";
import { issuePurchaseReceiptContext, consumePurchaseReceiptContext } from "../src/modules/inventory/InventoryPurchaseContext.js";

const issue = f => issuePurchaseReceiptContext(f.req, f.tx, f.command, f.confirmedLines, f.options);
const consume = (f, capsule) => consumePurchaseReceiptContext(f.tx, capsule, f.command, f.options.database);

test("Purchase context authenticates exact route/intent in a real framework-owned transaction", async () => {
  await withPurchaseUnitRequest(async f => {
    const capsule = issue(f), guard = consume(f, capsule);
    assert.deepEqual(capsule, {});
    const actor = await guard.check({ locking: true });
    assert.equal(actor.id, 7); assert.equal(actor.username, "sam");
    assert.ok(f.queries.filter(sql => sql.startsWith("SELECT")).every(sql => sql.endsWith("FOR SHARE")));
    assert.equal(actor.permissions.includes("inventory.view"), false);
  });
});

test("Purchase context rejects forged, consumed and second-issued capsules", async () => {
  await withPurchaseUnitRequest(async f => {
    assert.throws(() => consume(f, {}));
    const capsule = issue(f); assert.throws(() => issue(f)); consume(f, capsule);
    assert.throws(() => consume(f, capsule));
  });
});

test("Purchase context binds original server request context/auth/route identities", async () => {
  for (const mutate of [f => { f.req.context = { ...f.req.context }; },
    f => { f.req.auth = structuredClone(f.req.auth); }, f => { f.req.apiRoute = { ...f.req.apiRoute }; }]) {
    await withPurchaseUnitRequest(async f => { mutate(f); assert.throws(() => issue(f)); });
  }
});

test("Purchase context rejects mismatched route URL resource and authentication type", async () => {
  for (const mutate of [f => { f.req.input.params.id = "43"; }, f => { f.req.method = "GET"; },
    f => { f.req.apiRoute.path = "/api/v1/inventory/receipts"; }, f => { f.req.auth.type = "jwt-device-password"; }]) {
    await withPurchaseUnitRequest(async f => { mutate(f); assert.throws(() => issue(f)); });
  }
});

test("Purchase context rejects every changed line snapshot, actor or correlation after issue", async () => {
  for (const mutate of [f => { f.command.lines[0].baseQuantity += 1; }, f => { f.command.correlationId = "other"; },
    f => { f.command.actor.userId = 8; }, f => { f.command.lines[0].commitment.confirmedVersion += 1; }]) {
    await withPurchaseUnitRequest(async f => { const capsule = issue(f); mutate(f); assert.throws(() => consume(f, capsule)); });
  }
});

test("Purchase context verifies exact locked Confirmed PO projection and detail membership", async () => {
  for (const mutate of [f => { f.confirmedLines = []; }, f => { f.confirmedLines.push({ ...f.confirmedLines[0] }); },
    f => { f.confirmedLines[0].status = "DRAFT"; }, f => { f.confirmedLines[0].baseUomIdSnapshot = 99; },
    f => { f.confirmedLines[0].purchaseOrderId = 99; }, f => { f.confirmedLines[0].sourceLineId = "82"; }]) {
    await withPurchaseUnitRequest(async f => { mutate(f); assert.throws(() => issue(f)); });
  }
});

test("Purchase context requires active REPEATABLE READ, not a duck-typed or finished executor", async () => {
  await withPurchaseUnitRequest(async f => {
    const tx = { query: f.tx.query, execute: f.tx.execute };
    assert.throws(() => issuePurchaseReceiptContext(f.req, tx, f.command, f.confirmedLines, f.options));
  });
  await withPurchaseUnitRequest(async f => { assert.throws(() => issue(f)); }, { isolationLevel: "READ COMMITTED" });
  let late;
  await withPurchaseUnitRequest(async f => { late = consume(f, issue(f)); });
  await assert.rejects(late.check());
});

test("Purchase context rechecks active user and changed permissions at decisive write/replay", async () => {
  for (const mutate of [f => { f.state.status = "inactive"; }, f => { f.state.permissions = ["purchasing.view"]; }]) {
    await withPurchaseUnitRequest(async f => {
      const guard = consume(f, issue(f)); await guard.check(); mutate(f);
      await assert.rejects(guard.check({ locking: true }), error => error.code === "PERMISSION_STALE");
    });
  }
});

test("Purchase context rechecks JWT expiry, token revocation, session expiry and request abort", async () => {
  for (const mutate of [f => { f.state.now += 900000; }, f => { f.state.version += 1; }]) {
    await withPurchaseUnitRequest(async f => {
      const guard = consume(f, issue(f)); mutate(f); await assert.rejects(guard.check());
    });
  }
  let rejection;
  await assert.rejects(withPurchaseUnitRequest(async f => {
    const guard = consume(f, issue(f)); f.controller.abort(new Error("request aborted"));
    rejection = assert.rejects(guard.check()); await rejection;
  }), error => error.code === "DATABASE_OPERATION_ABORTED");
  await rejection;
  await withPurchaseUnitRequest(async f => { f.req.auth.claims.auth_time -= 86401; assert.throws(() => issue(f)); });
});

test("Purchase context retains original time limits and rejects changed request after consume", async () => {
  await withPurchaseUnitRequest(async f => {
    const guard = consume(f, issue(f)); f.req.context.auth = structuredClone(f.req.auth);
    await assert.rejects(guard.check());
  });
  await withPurchaseUnitRequest(async f => { delete f.options.clockToleranceSeconds; assert.throws(() => issue(f)); });
});
