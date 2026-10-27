import assert from "node:assert/strict";
import test from "node:test";
import { withPurchaseUnitRequest } from "../test-support/inventoryPurchaseFixtures.js";
import { issuePurchaseReceiptContext, consumePurchaseReceiptContext } from "../src/modules/inventory/InventoryPurchaseContext.js";
import * as purchaseContexts from "../src/modules/inventory/InventoryPurchaseContext.js";

function reversalRequest(f) {
  f.command = { actor: { ...f.command.actor, claimedPermissions: ["purchasing.view", "inventory.adjust"] },
    correlationId: "reversal-context", source: f.command.source, goodsReceiptId: "42", reasonText: "Wrong received quantity",
    lines: [{ sourceLineId: "81", originalSourceLineId: "81", originalMovementId: 100, baseQuantity: 1 }] };
  f.state.permissions = [...f.command.actor.claimedPermissions];
  f.req.auth.claims.permissions = [...f.state.permissions]; f.req.auth.type = "jwt-device-password";
  f.req.auth.claims.did = "a".repeat(64);
  f.state.deviceBinding = { id: 2, user_id: 7, device_id: f.req.auth.claims.did, public_key: Buffer.from("synthetic unit key"), status: "approved" };
  f.req.auth.deviceBinding = { ...f.state.deviceBinding };
  f.req.apiRoute.path = "/api/v1/goods-receipts/:id/reversals/create";
  f.req.apiRoute.authType = "jwt-device-password";
  f.req.get = () => String(1_800_000_000_000);
  f.options.signatureMaxSkewSeconds = 300;
  f.options.ownerProof = { goodsReceiptId: "42", status: "CONFIRMED",
    details: [{ sourceLineId: "81", goodsReceiptId: "42", originalMovementId: 100 }] };
  return f;
}
const issueReversal = f => purchaseContexts.issuePurchaseReversalContext(f.req, f.tx, f.command, f.options);
const consumeReversal = (f, capsule) => purchaseContexts.consumePurchaseReversalContext(f.tx, capsule, f.command, f.options.database);

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

test("Purchase reversal context seals original GR proof and fixed device-password route without inventory.view", async () => {
  await withPurchaseUnitRequest(async f => {
    reversalRequest(f); const capsule = issueReversal(f), guard = consumeReversal(f, capsule);
    assert.deepEqual(capsule, {}); assert.equal(guard.ownerStatus, "CONFIRMED");
    const actor = await guard.check({ locking: true }); assert.equal(actor.id, 7);
    assert.equal(actor.permissions.includes("inventory.view"), false);
    assert.ok(f.queries.filter(sql => sql.startsWith("SELECT")).every(sql => sql.endsWith("FOR SHARE")));
    assert.deepEqual(guard.audit, { deviceId: "a".repeat(64), signedRequestAt: 1_800_000_000_000 });
  });
});

test("Purchase reversal context rejects fake, reused, cross-kind and changed-intent capsules", async () => {
  await withPurchaseUnitRequest(async f => {
    reversalRequest(f); assert.throws(() => consumeReversal(f, {}));
    const capsule = issueReversal(f); assert.throws(() => issueReversal(f));
    assert.throws(() => consume(f, capsule));
    f.command.lines[0].baseQuantity = 2; assert.throws(() => consumeReversal(f, capsule));
    f.command.lines[0].baseQuantity = 1; consumeReversal(f, capsule); assert.throws(() => consumeReversal(f, capsule));
  });
});

test("Purchase reversal context rejects extra, missing, duplicate and mismatched owner projections", async () => {
  for (const change of [f => { delete f.options.ownerProof; }, f => { f.options.ownerProof.requestBody = true; },
    f => { f.options.ownerProof.goodsReceiptId = "43"; }, f => { f.options.ownerProof.status = "DRAFT"; },
    f => { f.options.ownerProof.details = []; }, f => { f.options.ownerProof.details.push({ ...f.options.ownerProof.details[0] }); },
    f => { f.options.ownerProof.details[0].goodsReceiptId = "43"; }, f => { f.options.ownerProof.details[0].sourceLineId = "82"; },
    f => { f.options.ownerProof.details[0].originalMovementId = 101; }, f => { f.options.ownerProof.details[0].extra = true; }]) {
    await withPurchaseUnitRequest(async f => { reversalRequest(f); change(f); assert.throws(() => issueReversal(f)); });
  }
});

test("Purchase reversal context accepts terminal owner proof for replay but freezes it at issuance", async () => {
  await withPurchaseUnitRequest(async f => {
    reversalRequest(f); f.options.ownerProof.status = "REVERSED";
    const capsule = issueReversal(f); f.options.ownerProof.status = "CONFIRMED";
    assert.equal(consumeReversal(f, capsule).ownerStatus, "REVERSED");
  });
});

test("Purchase reversal proof rejects same-cardinality duplicate and missing original detail", async () => {
  await withPurchaseUnitRequest(async f => {
    reversalRequest(f); f.command.lines.push({ sourceLineId: "82", originalSourceLineId: "82", originalMovementId: 101, baseQuantity: 1 });
    f.options.ownerProof.details.push({ ...f.options.ownerProof.details[0] });
    assert.throws(() => issueReversal(f), error => error.code === "PERMISSION_STALE");
  });
});

test("Purchase reversal context rejects wrong request identity, route, resource and auth strategy", async () => {
  for (const change of [f => { f.req.context = { ...f.req.context }; }, f => { f.req.apiRoute.path += "/fake"; },
    f => { f.req.input.params.id = "51"; }, f => { f.req.auth.type = "jwt"; },
    f => { f.req.input.params.extra = "x"; }, f => { f.req.method = "GET"; }]) {
    await withPurchaseUnitRequest(async f => { reversalRequest(f); change(f); assert.throws(() => issueReversal(f)); });
  }
});

test("Purchase reversal context rechecks device revocation, changed key and binding identity", async () => {
  for (const change of [f => { f.state.deviceBinding.status = "revoked"; }, f => { f.state.deviceBinding.public_key = Buffer.from("changed"); },
    f => { f.state.deviceBinding.id++; }, f => { f.state.deviceBinding.user_id++; }, f => { f.state.deviceBinding.device_id = "b".repeat(64); }]) {
    await withPurchaseUnitRequest(async f => {
      reversalRequest(f); const guard = consumeReversal(f, issueReversal(f)); await guard.check(); change(f);
      await assert.rejects(guard.check({ locking: true }));
    });
  }
});

test("Purchase reversal context rechecks permission, token and signature/session deadlines", async () => {
  for (const change of [f => { f.state.permissions = ["purchasing.view"]; }, f => { f.state.version++; },
    f => { f.state.now += 300001; }, f => { f.state.status = "inactive"; }]) {
    await withPurchaseUnitRequest(async f => {
      reversalRequest(f); const guard = consumeReversal(f, issueReversal(f)); change(f); await assert.rejects(guard.check());
    });
  }
  await withPurchaseUnitRequest(async f => { reversalRequest(f); f.req.auth.claims.auth_time -= 86401; assert.throws(() => issueReversal(f)); });
  await withPurchaseUnitRequest(async f => { reversalRequest(f); delete f.options.signatureMaxSkewSeconds; assert.throws(() => issueReversal(f)); });
});
