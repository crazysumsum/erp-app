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
