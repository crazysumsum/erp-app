import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ShipmentReversalService } from "../../src/modules/fulfillment/ShipmentReversalService.js";
import { facts, reversalFixture } from "../fulfillment/shipmentReversalFixture.js";

const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

nativeTest("Shipment Reverse gates Phase A on matching invoice and return counts in the same transaction", async t => {
  const f = await reversalFixture(t, { archives: true });
  const expectedSource = { shipmentIds: [f.shipmentId] };
  let invoiceCount = 1;
  let returnCount = 0;
  const calls = [];
  const providers = {
    invoicing: { async findShipmentInvoiceClaimsInTransaction(tx, scope) {
      assert.equal(tx, f.database.context.get().databaseTransaction);
      assert.deepEqual(scope, expectedSource);
      calls.push(["invoice", tx]);
      return [{ shipmentId: f.shipmentId, activeInvoiceLineCount: invoiceCount }];
    } },
    returns: { async findShipmentReturnsInTransaction(tx, scope) {
      assert.equal(tx, f.database.context.get().databaseTransaction);
      assert.deepEqual(scope, expectedSource);
      calls.push(["return", tx]);
      return [{ shipmentId: f.shipmentId, openReturnCount: returnCount }];
    } }
  };
  const reversal = new ShipmentReversalService({ ...f.options, downstreamProviders: providers });
  const before = await facts(f);
  const start = () => f.execute(() => reversal.startReversal(f.shipmentId, { ...f.command, eventId: randomUUID() }));

  await assert.rejects(start, { code: "DOWNSTREAM_MATTER_BLOCKS_REVERSAL" });
  assert.deepEqual(await facts(f), before);

  invoiceCount = 0;
  returnCount = 1;
  await assert.rejects(start, { code: "DOWNSTREAM_MATTER_BLOCKS_REVERSAL" });
  assert.deepEqual(await facts(f), before);

  returnCount = null;
  await assert.rejects(start, { code: "FULFILLMENT_DEPENDENCY_UNAVAILABLE" });
  assert.deepEqual(await facts(f), before);

  returnCount = 0;
  const started = await start();
  assert.equal(started.outcome, "REVERSING");
  assert.deepEqual(calls.map(([owner]) => owner), ["invoice", "return", "invoice", "return", "invoice", "return", "invoice", "return"]);
  assert.equal(calls[6][1], calls[7][1]);

  const completed = await f.execute(() => reversal.completeReversalPhaseB(started));
  assert.equal(completed.outcome, "REVERSED");
  assert.equal(calls.length, 8);
});

nativeTest("Shipment Reverse provider-mode Recovery preserves an expired legacy intent without a provider witness", async t => {
  const f = await reversalFixture(t, { archives: true, noDownstream: true });
  await f.execute(() => f.reversal.startReversal(f.shipmentId, f.command));
  await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=1 WHERE event_id=?", [f.command.eventId]);
  const before = await facts(f);
  const signal = new AbortController().signal;
  const reversal = new ShipmentReversalService({
    ...f.options,
    downstreamProviders: {
      invoicing: { async findShipmentInvoiceClaimsInTransaction() { throw new Error("Legacy intent is not provider-bound"); } },
      returns: { async findShipmentReturnsInTransaction() { throw new Error("Legacy intent is not provider-bound"); } }
    },
    recoveryVerifier: async () => signal
  });

  const result = await f.execute(() => reversal.recoverExpiredReversal(f.command.eventId, {}, { signal }));
  assert.deepEqual(result, { state: "UNKNOWN" });
  assert.deepEqual(await facts(f), before);
});

function clearDownstream() {
  return {
    invoicing: { async findShipmentInvoiceClaimsInTransaction(_tx, { shipmentIds: [shipmentId] }) {
      return [{ shipmentId, activeInvoiceLineCount: 0 }];
    } },
    returns: { async findShipmentReturnsInTransaction(_tx, { shipmentIds: [shipmentId] }) {
      return [{ shipmentId, openReturnCount: 0 }];
    } }
  };
}

nativeTest("Shipment Reverse checks every stored ISSUE and rolls back Phase A on missing or unknown cost", async t => {
  const f = await reversalFixture(t, { archives: true, twoLines: true });
  const before = await facts(f);
  const movementIds = before.shipment_issue_details.map(issue => String(issue.inventory_movement_id));
  assert.equal(movementIds.length, 2);
  let answer = { state: "MISSING", costingEnabled: true };
  let calls = 0;
  const issueCostProvider = { async assertIssueCostAvailableInTransaction(tx, scope) {
    assert.equal(tx, f.database.context.get().databaseTransaction);
    assert.deepEqual(scope, { movementIds });
    const [[shipment]] = await tx.query("SELECT status FROM shipments WHERE id=?", [f.shipmentId]);
    assert.equal(shipment.status, "SHIPPED");
    calls++;
    if (answer instanceof Error) throw answer;
    return answer;
  } };
  const reversal = new ShipmentReversalService({ ...f.options, downstreamProviders: clearDownstream(), issueCostProvider });
  const start = () => f.execute(() => reversal.startReversal(f.shipmentId, f.command));
  await assert.rejects(start, { code: "SHIPMENT_ISSUE_COST_UNAVAILABLE", statusCode: 409 });
  assert.deepEqual(await facts(f), before);
  for (const unavailable of [
    { state: "AVAILABLE", costingEnabled: false },
    { state: "UNKNOWN", costingEnabled: true },
    new Error("Synthetic cost provider failure")
  ]) {
    answer = unavailable;
    await assert.rejects(start, { code: "FULFILLMENT_DEPENDENCY_UNAVAILABLE", statusCode: 503 });
    assert.deepEqual(await facts(f), before);
  }
  answer = { state: "AVAILABLE", costingEnabled: true };
  const pending = await start();
  assert.equal(pending.outcome, "REVERSING");
  assert.deepEqual(await start(), pending);
  const [[row]] = await f.db.query("SELECT before_summary FROM shipment_reversals WHERE event_id=?", [f.command.eventId]);
  const summary = typeof row.before_summary === "string" ? JSON.parse(row.before_summary) : row.before_summary;
  assert.deepEqual(summary.issueCost, { enabled: true, movementIds });
  assert.equal(summary.summaryVersion, 2);
  assert.equal(calls, 5);
});

nativeTest("Shipment Reverse cost-enabled Recovery preserves expired provider-mode v1 attempts", async t => {
  const f = await reversalFixture(t, { archives: true });
  const signal = new AbortController().signal;
  const options = { ...f.options, downstreamProviders: clearDownstream(), recoveryVerifier: async () => signal };
  const previous = new ShipmentReversalService(options);
  await f.execute(() => previous.startReversal(f.shipmentId, f.command));
  await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=1 WHERE event_id=?", [f.command.eventId]);
  const before = await facts(f);
  let costReads = 0;
  const afterCutover = new ShipmentReversalService({
    ...options,
    issueCostProvider: { async assertIssueCostAvailableInTransaction() {
      costReads++;
      return { state: "AVAILABLE", costingEnabled: true };
    } }
  });
  const recover = service => f.execute(() => service.recoverExpiredReversal(f.command.eventId, {}, { signal }));

  assert.deepEqual(await recover(afterCutover), { state: "UNKNOWN" });
  assert.deepEqual(await facts(f), before);
  const completed = await recover(previous);
  assert.equal(completed.state, "SUCCEEDED");
  assert.equal(completed.result.outcome, "REVERSED");
  assert.deepEqual(await recover(afterCutover), completed);
  assert.equal(costReads, 0);
});

nativeTest("Shipment Reverse Recovery verifies the versioned cost witness against stored ISSUEs after restart", async t => {
  const f = await reversalFixture(t, { archives: true });
  let calls = 0;
  const options = {
    ...f.options,
    downstreamProviders: clearDownstream(),
    issueCostProvider: { async assertIssueCostAvailableInTransaction() {
      calls++;
      return { state: "AVAILABLE", costingEnabled: true };
    } }
  };
  const first = new ShipmentReversalService(options);
  await f.execute(() => first.startReversal(f.shipmentId, f.command));
  await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=1 WHERE event_id=?", [f.command.eventId]);
  const signal = new AbortController().signal;
  const restarted = new ShipmentReversalService({ ...options, recoveryVerifier: async () => signal });
  const recover = service => f.execute(() => service.recoverExpiredReversal(f.command.eventId, {}, { signal }));
  const withoutCost = new ShipmentReversalService({ ...f.options, downstreamProviders: clearDownstream(), recoveryVerifier: async () => signal });
  const pending = await facts(f);
  assert.deepEqual(await recover(withoutCost), { state: "UNKNOWN" });
  assert.deepEqual(await facts(f), pending);

  const transaction = f.database.withTransaction;
  let witnessReads = 0;
  f.database.withTransaction = function(work, options) {
    return transaction.call(this, async (tx, details) => {
      const query = tx.query.bind(tx);
      tx.query = async (sql, params) => {
        const reply = await query(sql, params);
        if (sql !== "SELECT * FROM shipment_reversals WHERE event_id=? LIMIT 2") return reply;
        const [[row], fields] = reply;
        const summary = typeof row.before_summary === "string" ? JSON.parse(row.before_summary) : row.before_summary;
        witnessReads++;
        return [[{ ...row, before_summary: { ...summary, issueCost: { enabled: true, movementIds: ["99999"] } } }], fields];
      };
      return work(tx, details);
    }, options);
  };
  try {
    assert.deepEqual(await recover(restarted), { state: "UNKNOWN" });
    assert.equal(witnessReads, 2);
    assert.deepEqual(await facts(f), pending);
  } finally {
    f.database.withTransaction = transaction;
  }
  const result = await recover(restarted);
  assert.equal(result.state, "SUCCEEDED");
  assert.equal(result.result.outcome, "REVERSED");
  assert.deepEqual(await recover(restarted), result);
  assert.equal(calls, 1);
});
