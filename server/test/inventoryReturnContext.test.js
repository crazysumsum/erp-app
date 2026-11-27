import assert from "node:assert/strict";
import test from "node:test";
import { issueInventoryReturnContext, consumeInventoryReturnContext } from "../src/modules/inventory/InventoryReturnContext.js";
import { withPurchaseUnitRequest } from "../test-support/inventoryPurchaseFixtures.js";

function fixture(f, kind = "customer") {
  const permission = `returns.${kind}.mgmt`;
  f.state.permissions = [permission];
  f.req.auth.claims.permissions = [permission];
  f.req.apiRoute.path = `/api/v1/${kind}-returns/:id/post`;
  const command = { actor: { userId: 7, claimedRoles: ["receiver"], claimedPermissions: [permission] },
    source: { documentId: "42", eventId: f.command.source.eventId },
    lines: [{ sourceLineId: "81", originalMovementId: "101", baseQuantity: "2", binId: "3",
      ...(kind === "supplier" ? { stockStatus: "AVAILABLE" } : {}) }] };
  const facts = [{ sourceLineId: "81", originalMovementId: "101", warehouseId: "2", skuId: "4", lotId: null }];
  return { command, facts, options: { ...f.options, kind } };
}

for (const kind of ["customer", "supplier"]) {
  test(`Return context binds ${kind} source facts and current permission to active RR JWT`, async () => {
    await withPurchaseUnitRequest(async f => {
      const { command, facts, options } = fixture(f, kind);
      const capsule = issueInventoryReturnContext(f.req, f.tx, command, facts, options);
      facts[0].warehouseId = "9";
      const guard = consumeInventoryReturnContext(f.tx, capsule, command, options);
      assert.deepEqual(capsule, {});
      assert.equal(guard.factFor("81").warehouseId, "2");
      const actor = await guard.check({ locking: true });
      assert.equal(actor.username, "sam");
      assert.ok(f.queries.filter(sql => sql.startsWith("SELECT")).every(sql => sql.endsWith("FOR SHARE")));
      assert.throws(() => consumeInventoryReturnContext(f.tx, capsule, command, options), { code: "PERMISSION_STALE" });
    });
  });
}

test("Return context rejects substituted source facts, changed intent and wrong auth route", async () => {
  for (const mutate of [
    (f, p) => { p.facts[0].originalMovementId = "103"; },
    (f) => { f.req.apiRoute.path = "/api/v1/goods-receipts/:id/confirm"; },
    (f) => { f.req.input.params.id = "43"; }
  ]) {
    await withPurchaseUnitRequest(async f => {
      const p = fixture(f);
      mutate(f, p);
      assert.throws(() => issueInventoryReturnContext(f.req, f.tx, p.command, p.facts, p.options), { code: "PERMISSION_STALE" });
    });
  }
  await withPurchaseUnitRequest(async f => {
    const { command, facts, options } = fixture(f);
    const capsule = issueInventoryReturnContext(f.req, f.tx, command, facts, options);
    command.lines[0].baseQuantity = "3";
    assert.throws(() => consumeInventoryReturnContext(f.tx, capsule, command, options), { code: "PERMISSION_STALE" });
  });
});

test("Return context refuses revoked privileges and expired or replaced request contexts", async () => {
  await withPurchaseUnitRequest(async f => {
    const { command, facts, options } = fixture(f);
    const capsule = issueInventoryReturnContext(f.req, f.tx, command, facts, options);
    const guard = consumeInventoryReturnContext(f.tx, capsule, command, options);
    f.state.permissions = [];
    await assert.rejects(guard.check({ locking: true }), { code: "PERMISSION_STALE" });
    f.state.now += 901_000;
    await assert.rejects(guard.check({ locking: true }), { code: "JWT_INVALID" });
  });
});
