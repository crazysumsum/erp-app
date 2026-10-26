import assert from "node:assert/strict";
import test from "node:test";
import { InventoryOperationService } from "../src/modules/inventory/InventoryOperationService.js";
import { normalizePurchaseReceipt } from "../src/modules/inventory/inventoryPurchaseValidation.js";
import { claimPurchaseReceipt, completePurchaseReceipt, readPurchaseReceipt } from "../src/modules/inventory/inventoryPurchaseReceipts.js";
import { purchaseReceiptCommand } from "../test-support/inventoryPurchaseFixtures.js";

// Real Operation serializer/hash/parser with an in-memory SQL transport, not native transaction evidence.
function ledger() {
  const rows = [], statements = [];
  return { rows, statements,
    async execute(sql, p) {
      statements.push(String(sql));
      if (sql.startsWith("INSERT INTO inventory_operation_requests")) {
        if (rows.some(r => [r.source_module, r.source_document_type, r.source_document_id, r.source_line_id, r.source_event_id]
          .every((value, index) => value === p[index + 1]))) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        const row = Object.fromEntries(["command_type", "source_module", "source_document_type", "source_document_id",
          "source_line_id", "source_event_id", "request_hash", "actor_user_id", "actor_label", "request_id", "correlation_id", "created_at"]
          .map((key, index) => [key, p[index]]));
        rows.push({ ...row, id: rows.length + 1, completed_at: null });
        return [{ insertId: rows.length }];
      }
      assert.match(sql, /UPDATE inventory_operation_requests/);
      const row = rows.find(r => r.id === p[4]);
      Object.assign(row, { result_type: p[0], result_id: p[1], result_summary: p[2], completed_at: p[3] });
      return [{ affectedRows: 1 }];
    },
    async query(sql, p) {
      statements.push(String(sql));
      if (p.length === 5) return [rows.filter(r => [r.source_module, r.source_document_type, r.source_document_id,
        r.source_line_id, r.source_event_id].every((value, index) => value === p[index]))];
      assert.equal(p.length, 3);
      return [rows.filter(r => r.source_document_type === p[0] && r.source_document_id === p[1] && r.source_event_id === p[2])];
    }
  };
}

async function prepare(tx, command = purchaseReceiptCommand()) {
  return claimPurchaseReceipt(tx, { command: normalizePurchaseReceipt(command), actorLabel: "sam", requestId: "request-1",
    timestamp: 1_800_000_000_000, operations: new InventoryOperationService() });
}
async function finish(tx, batch) {
  const results = batch.members.map((m, index) => ({ sourceLineId: m.line.sourceLineId, operationId: m.operationId,
    movementId: index + 100, movementGroupId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    baseQuantity: m.line.baseQuantity }));
  await completePurchaseReceipt(tx, batch, results);
  return results;
}

test("Purchase ABI claims root then all numeric-sorted details before stock work", async () => {
  const tx = ledger(), command = purchaseReceiptCommand();
  command.lines.push({ ...command.lines[0], sourceLineId: "9", binId: 3 });
  const batch = await prepare(tx, command);
  assert.deepEqual(tx.rows.map(r => r.source_line_id), ["", "9", "81"]);
  assert.equal(batch.replay, false);
  assert.equal(tx.statements.length, 3);
  assert.ok(tx.statements.every(sql => sql.startsWith("INSERT INTO inventory_operation_requests")));
});

test("Purchase ABI uses real scalar serializer and persists policy for reversal", async () => {
  const tx = ledger(), batch = await prepare(tx);
  await finish(tx, batch);
  const member = JSON.parse(tx.rows[1].result_summary), root = JSON.parse(tx.rows[0].result_summary);
  assert.equal(member.trackingPolicy, "none"); assert.equal(member.baseUomId, 4); assert.equal(member.baseUomCode, "EA");
  assert.equal(member.rootOperationId, 1);
  assert.deepEqual(Object.keys(root).sort(), ["membershipDigest", "operationId", "rowCount", "status"]);
  assert.ok(tx.rows.every(r => Buffer.byteLength(r.result_summary) < 8192));
});

test("Purchase ABI returns NOT_FOUND without asserting whether another request is in flight", async () => {
  const tx = ledger();
  assert.deepEqual(await readPurchaseReceipt(tx, { ...purchaseReceiptCommand().source, documentType: "GOODS_RECEIPT" }), { status: "NOT_FOUND" });
  assert.equal(tx.statements.length, 1); assert.doesNotMatch(tx.statements[0], /FOR (SHARE|UPDATE)/);
  assert.match(tx.statements[0], /LIMIT 202/);
});

test("Purchase ABI completes exact result set with a recomputable digest and sorted query result", async () => {
  const tx = ledger(), command = purchaseReceiptCommand();
  command.lines.push({ ...command.lines[0], sourceLineId: "9", binId: 3 });
  const batch = await prepare(tx, command), expected = await finish(tx, batch);
  const result = await readPurchaseReceipt(tx, { ...command.source, documentType: "GOODS_RECEIPT" });
  assert.deepEqual(result, { status: "COMPLETED", result: { status: "POSTED", operationId: 1, lines: expected } });
});

test("Purchase ABI exact event replay ignores actor/correlation/order but returns original scalar results", async () => {
  const tx = ledger(), command = purchaseReceiptCommand();
  command.lines.push({ ...command.lines[0], sourceLineId: "9", binId: 3 });
  const original = await prepare(tx, command); await finish(tx, original);
  command.actor.userId = 8; command.correlationId = "request-2"; command.lines.reverse();
  const replay = await prepare(tx, command);
  assert.equal(replay.replay, true); assert.equal(replay.operationId, original.operationId); assert.equal(tx.rows.length, 3);
  const decoded = await readPurchaseReceipt(tx, { ...command.source, documentType: "GOODS_RECEIPT" }, { expectedBatch: replay });
  assert.deepEqual(decoded.result.lines.map(line => [line.sourceLineId, line.baseQuantity, line.movementId]), [["9", 3, 100], ["81", 3, 101]]);
  command.lines[0].baseQuantity += 1;
  await assert.rejects(prepare(tx, command), error => error.code === "INVENTORY_SOURCE_CONFLICT");
});

test("Purchase ABI rejects visible unfinished, missing, extra and corrupt members", async () => {
  for (const corrupt of [rows => { rows[0].completed_at = null; }, rows => { rows.pop(); },
    rows => { rows.push({ ...rows[1], id: 3, source_line_id: "82" }); },
    rows => { rows[1].result_summary = "{broken"; }, rows => { rows[1].request_hash = "a".repeat(64); },
    rows => { const s = JSON.parse(rows[1].result_summary); s.rootOperationId = 999; rows[1].result_summary = JSON.stringify(s); }]) {
    const tx = ledger(), batch = await prepare(tx); await finish(tx, batch); corrupt(tx.rows);
    await assert.rejects(readPurchaseReceipt(tx, { ...purchaseReceiptCommand().source, documentType: "GOODS_RECEIPT" }),
      error => error.code === "INVENTORY_SOURCE_CONFLICT");
  }
});

test("Purchase ABI refuses partial replay and completes no root when member result set is wrong", async () => {
  const tx = ledger(), batch = await prepare(tx); await finish(tx, batch);
  tx.rows.shift();
  await assert.rejects(prepare(tx), error => error.code === "INVENTORY_SOURCE_CONFLICT");
  const fresh = ledger(), pending = await prepare(fresh);
  await assert.rejects(completePurchaseReceipt(fresh, pending, []), error => error.code === "INVENTORY_SOURCE_CONFLICT");
  assert.ok(fresh.rows.every(row => row.completed_at === null));
});

test("Purchase ABI rejects invalid query fields and unsupported document kinds", async () => {
  for (const patch of [{ documentType: "CUSTOMER_RETURN" }, { permission: "inventory.view" }, { documentId: "01" }]) {
    await assert.rejects(readPurchaseReceipt(ledger(), { ...purchaseReceiptCommand().source, documentType: "GOODS_RECEIPT", ...patch }));
  }
});

test("Purchase ABI rejects nonnumeric scalar quantities/IDs, and replay snapshot contradictions", async () => {
  for (const [field, value, expected] of [["movementId", "100", false], ["baseQuantity", "3", false],
    ["skuId", "12", false], ["baseUomId", "4", false], ["baseQuantity", 4, true], ["skuId", 13, true],
    ["trackingPolicy", "batch", true], ["baseUomId", 123, true], ["baseUomCode", "OTHER", true]]) {
    const tx = ledger(), batch = await prepare(tx); await finish(tx, batch);
    const summary = JSON.parse(tx.rows[1].result_summary); summary[field] = value;
    tx.rows[1].result_summary = JSON.stringify(summary);
    await assert.rejects(readPurchaseReceipt(tx, { ...purchaseReceiptCommand().source, documentType: "GOODS_RECEIPT" },
      { expectedBatch: expected ? batch : null }), error => error.code === "INVENTORY_SOURCE_CONFLICT");
  }
  const tx = ledger(), batch = await prepare(tx);
  await assert.rejects(completePurchaseReceipt(tx, batch, [{ sourceLineId: "81", operationId: 2, movementId: "100",
    movementGroupId: "11111111-1111-4111-8111-111111111111", baseQuantity: 3 }]), error => error.code === "INVENTORY_SOURCE_CONFLICT");
});
