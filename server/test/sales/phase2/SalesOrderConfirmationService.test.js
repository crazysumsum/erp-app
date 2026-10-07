import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SalesOrderConfirmationService } from "../../../src/modules/sales/SalesOrderConfirmationService.js";

const claims = { actorId: 7, claimedRoles: ["sales"], claimedPermissions: ["sales.mgmt", "sales.view"] };
function fixture({ status = "DRAFT", auditFailure = false, revoked = false } = {}) {
  let state = { order: { id: 1, sales_order_number: "SO-202610-000001", status, version: 1 }, intents: [], history: [], audits: [] };
  const tx = {
    async query(sql, args) {
      if (sql.includes("SELECT username FROM users")) return [[{ username: "Synthetic" }]];
      if (sql.includes("SELECT r.name")) return [[{ name: "sales" }]];
      if (sql.includes("SELECT DISTINCT p.name")) return [revoked ? [] : claims.claimedPermissions.map(name => ({ name }))];
      if (sql.includes("FROM sales_operation_requests")) return [[state.intents.find(i => i.event_id === args[0])].filter(Boolean)];
      if (sql.includes("FROM sales_orders")) return [args[0] === 1 ? [state.order] : []];
      throw new Error("Unexpected fixture query");
    },
    async execute(sql, a) {
      if (sql.includes("INSERT INTO sales_operation_requests")) {
        if (state.intents.some(i => i.event_id === a[0])) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        const id = state.intents.length + 1;
        state.intents.push({ id, event_id: a[0], command_type: "CONFIRM_ORDER", target_type: "SALES_ORDER", target_id: a[1],
          request_hash: a[2], recovery_payload: JSON.parse(a[3]), status: "IN_PROGRESS", actor_user_id: a[4], lease_owner: a[8], lease_until: 60001 });
        return [{ insertId: id }];
      }
      if (sql.includes("UPDATE sales_orders")) {
        state.order = { ...state.order, status: "CONFIRMING", confirmation_event_id: a[0], version: state.order.version + 1 };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO sales_order_status_history")) { state.history.push(a); return [{ insertId: 1 }]; }
      if (sql.includes("INSERT INTO sales_audit_logs")) { if (auditFailure) throw new Error("Required audit unavailable"); state.audits.push(a); return [{ insertId: 1 }]; }
      throw new Error("Unexpected fixture write");
    }
  };
  const database = { async withTransaction(work) { const before = structuredClone(state); try { return await work(tx); } catch (e) { state = before; throw e; } } };
  const service = () => new SalesOrderConfirmationService({ database, time: { nowMs: () => 1 } });
  return { service, revoke() { revoked = true; }, state: () => state, request: () => ({ claims, id: 1, input: { eventId: randomUUID(), version: 1 } }) };
}

test("TC-022 Phase A durably records one CONFIRMING intent, event, lease and append-only history/audit", async () => {
  const f = fixture(), request = f.request(), result = await f.service().startConfirmation(request);
  assert.equal(result.status, "IN_PROGRESS"); assert.equal(result.eventId, request.input.eventId);
  const s = f.state(); assert.equal(s.order.status, "CONFIRMING"); assert.equal(s.order.version, 2);
  assert.equal(s.order.confirmation_event_id, request.input.eventId); assert.equal(s.intents.length, 1);
  assert.deepEqual(s.intents[0].recovery_payload, { version: 1 }); assert.equal(s.intents[0].actor_user_id, 7);
  assert.match(s.intents[0].lease_owner, /^[a-f0-9-]{36}$/u); assert.equal(s.history.length, 1); assert.equal(s.audits.length, 1);
});
test("TC-024 Phase A replay after a new service instance preserves original event/lease/version without a second effect", async () => {
  const f = fixture(), request = f.request(); const first = await f.service().startConfirmation(request);
  assert.deepEqual(await f.service().startConfirmation(request), first);
  assert.equal(f.state().order.version, 2); assert.equal(f.state().intents.length, 1); assert.equal(f.state().history.length, 1);
});
test("TC-022 Phase A rejects different payload, actor and a second intent on the same CONFIRMING order", async () => {
  const f = fixture(), request = f.request(); await f.service().startConfirmation(request);
  await assert.rejects(() => f.service().startConfirmation({ ...request, input: { ...request.input, version: 2 } }), { code: "SALES_EVENT_CONFLICT" });
  await assert.rejects(() => f.service().startConfirmation({ ...request, claims: { ...claims, actorId: 8 } }), { code: "SALES_EVENT_CONFLICT" });
  await assert.rejects(() => f.service().startConfirmation(f.request()), { code: "SALES_CONFIRMATION_IN_PROGRESS" });
  assert.equal(f.state().intents.length, 1); assert.equal(f.state().order.version, 2);
});
test("TC-022 Phase A stale version, invalid input and non-Draft state leave no committed intent", async () => {
  const f = fixture();
  await assert.rejects(() => f.service().startConfirmation({ ...f.request(), input: { eventId: randomUUID(), version: 2 } }), { code: "VERSION_CONFLICT" });
  for (const change of [{ version: 0 }, { eventId: "invalid" }, { actor: "spoof" }, { warehouseId: 9 }]) {
    const request = f.request(); await assert.rejects(() => f.service().startConfirmation({ ...request, input: { ...request.input, ...change } }), { code: "SALES_INPUT_INVALID" });
  }
  assert.equal(f.state().intents.length, 0); assert.equal(f.state().order.status, "DRAFT");
  const confirmed = fixture({ status: "CONFIRMED" });
  await assert.rejects(() => confirmed.service().startConfirmation(confirmed.request()), { code: "SALES_STATE_CONFLICT" });
  assert.equal(confirmed.state().intents.length, 0);
});
test("TC-030 Phase A rechecks permissions before replay and rolls back required audit failure", async () => {
  const revoked = fixture({ revoked: true });
  await assert.rejects(() => revoked.service().startConfirmation(revoked.request()), { code: "PERMISSION_STALE" });
  assert.equal(revoked.state().intents.length, 0);
  const replay = fixture(), request = replay.request(); await replay.service().startConfirmation(request); replay.revoke();
  await assert.rejects(() => replay.service().startConfirmation(request), { code: "PERMISSION_STALE" });
  assert.equal(replay.state().intents.length, 1); assert.equal(replay.state().order.version, 2);
  const failing = fixture({ auditFailure: true });
  await assert.rejects(() => failing.service().startConfirmation(failing.request()), /Required audit unavailable/u);
  assert.equal(failing.state().intents.length, 0); assert.equal(failing.state().history.length, 0); assert.equal(failing.state().order.status, "DRAFT");
});
