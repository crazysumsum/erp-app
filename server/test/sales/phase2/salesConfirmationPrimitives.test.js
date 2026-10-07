import assert from "node:assert/strict";
import test from "node:test";
import { requireSalesRecoveryActor } from "../../../src/modules/sales/salesAuthorization.js";
import { SalesAuditService } from "../../../src/modules/sales/SalesAuditService.js";
import { salesError } from "../../../src/modules/sales/salesErrors.js";

function directory({ active = true, permissions = ["sales.mgmt", "sales.view"] } = {}) {
  const calls = [];
  return { calls, async query(sql, args) {
    calls.push(args);
    return [sql.includes("SELECT username") ? active ? [{ username: "Original human" }] : [] :
      (sql.includes("SELECT DISTINCT") ? permissions : ["sales"]).map(name => ({ name }))];
  } };
}
test("TC-025 recovery loads the original active human and current directory permissions without token claims", async () => {
  const db = directory(), actor = await requireSalesRecoveryActor(db, 17);
  assert.deepEqual(actor, { id: 17, username: "Original human", roles: ["sales"], permissions: ["sales.mgmt", "sales.view"] });
  assert.ok(db.calls.every(args => args[0] === 17));
  for (const settings of [{ active: false }, { permissions: ["sales.view"] }, { permissions: ["sales.mgmt"] }])
    await assert.rejects(() => requireSalesRecoveryActor(directory(settings), 17), { code: "FORBIDDEN" });
  for (const id of [null, 0, -1, "17"])
    await assert.rejects(() => requireSalesRecoveryActor(directory(), id), TypeError);
});
test("TC-021 confirmation transitions retain safe mandatory audit summaries", async () => {
  const writes = [], audit = new SalesAuditService(), tx = { execute: async (...args) => { writes.push(args); } };
  for (const [action, toStatus] of [["sales_order.confirmed", "CONFIRMED"], ["sales_order.confirm_failed", "DRAFT"]])
    await audit.record(tx, { actor: { id: 17, username: "Original human" }, action, targetId: 1,
      targetNumber: "SO-202610-000001", eventId: "11111111-1111-4111-8111-111111111111", nowMs: 1,
      details: { fromStatus: "CONFIRMING", toStatus, version: 3 } });
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[0][1][8]), { fromStatus: "CONFIRMING", toStatus: "CONFIRMED", version: 3 });
});
test("TC-021 malformed Inventory confirmation results have a stable unavailable error", () => {
  assert.equal(salesError("INVENTORY_CONTRACT_MISMATCH").statusCode, 503);
});
