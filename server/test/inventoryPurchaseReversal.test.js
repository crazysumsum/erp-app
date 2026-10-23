import assert from "node:assert/strict";
import test from "node:test";
import * as validation from "../src/modules/inventory/inventoryPurchaseValidation.js";
import { InventoryOperationService } from "../src/modules/inventory/InventoryOperationService.js";
import * as receipts from "../src/modules/inventory/inventoryPurchaseReceipts.js";

function command() {
  return { actor: { userId: 7, serviceName: "", claimedRoles: ["adjuster"],
    claimedPermissions: ["purchasing.view", "inventory.adjust"] }, correlationId: "reverse-test-1",
  source: { documentId: "51", eventId: "11111111-1111-4111-8111-111111111111" },
  goodsReceiptId: "42", reasonText: "Correct received quantity",
  lines: [{ sourceLineId: "91", originalSourceLineId: "81", originalMovementId: 100, baseQuantity: 2 }] };
}

test("Purchase reversal accepts the exact partial-reversal ABI without mutating its input", () => {
  const input = command(), original = structuredClone(input);
  assert.deepEqual(validation.normalizePurchaseReversal(input), original);
  assert.deepEqual(input, original);
});

for (const [name, change] of [
  ["caller-selected permission", c => { c.permission = "inventory.operation"; }],
  ["caller-selected source module", c => { c.source.module = "RETURNS"; }],
  ["unsafe original movement", c => { c.lines[0].originalMovementId = Number.MAX_SAFE_INTEGER + 1; }],
  ["zero quantity", c => { c.lines[0].baseQuantity = 0; }],
  ["negative quantity", c => { c.lines[0].baseQuantity = -1; }],
  ["fractional quantity", c => { c.lines[0].baseQuantity = 1.5; }],
  ["coerced quantity", c => { c.lines[0].baseQuantity = "2"; }],
  ["noncanonical source ID", c => { c.lines[0].sourceLineId = "091"; }],
  ["numeric original detail ID", c => { c.lines[0].originalSourceLineId = 81; }],
  ["unsafe receipt ID", c => { c.goodsReceiptId = "9007199254740992"; }],
  ["extra physical dimension", c => { c.lines[0].binId = 1; }],
  ["duplicate original movement", c => { c.lines.push({ ...c.lines[0], sourceLineId: "92" }); }],
  ["duplicate reversal detail", c => { c.lines.push({ ...c.lines[0], originalMovementId: 101, originalSourceLineId: "82" }); }],
  ["empty batch", c => { c.lines = []; }],
  ["sparse batch", c => { c.lines = new Array(1); }],
  ["201-line batch", c => { c.lines = Array.from({ length: 201 }, (_, i) => ({ sourceLineId: String(i + 1),
    originalSourceLineId: String(i + 1), originalMovementId: i + 1, baseQuantity: 1 })); }],
  ["uppercase event UUID", c => { c.source.eventId = "AAAAAAAA-1111-4111-8111-111111111111"; }],
  ["missing adjustment permission", c => { c.actor.claimedPermissions = ["purchasing.view", "receiving.operation"]; }],
  ["control character reason", c => { c.reasonText = "Invalid\nreason"; }],
  ["empty reason", c => { c.reasonText = "   "; }],
  ["oversize UTF8 reason", c => { c.reasonText = "界".repeat(167); }]
]) test(`Purchase reversal rejects ${name}`, () => {
  const input = command(); change(input);
  assert.throws(() => validation.normalizePurchaseReversal(input), error =>
    ["INVENTORY_INPUT_INVALID", "INVENTORY_QUANTITY_INVALID", "PERMISSION_STALE"].includes(error.code));
});

test("Purchase reversal accepts all200 unique details and preserves response ordering input", () => {
  const input = command(); input.lines = Array.from({ length: 200 }, (_, i) => ({ sourceLineId: String(200 - i),
    originalSourceLineId: String(i + 1), originalMovementId: i + 1, baseQuantity: 1 }));
  const normalized = validation.normalizePurchaseReversal(input);
  assert.equal(normalized.lines.length, 200); assert.equal(normalized.lines[0].sourceLineId, "200");
});

test("Purchase reversal business hash excludes new actor, correlation, context and input permutation", () => {
  const a = command(); a.lines.push({ sourceLineId: "9", originalSourceLineId: "82", originalMovementId: 101, baseQuantity: 1 });
  const b = structuredClone(a); b.actor.userId = 8; b.correlationId = "different-attempt"; b.context = {}; b.lines.reverse();
  assert.equal(validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(a)),
    validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(b)));
  assert.deepEqual(validation.purchaseReversalBusinessPayload(validation.normalizePurchaseReversal(b)).lines.map(l => l.sourceLineId), ["9", "91"]);
});

test("Purchase reversal business hash binds receipt, event, membership, original and quantity", () => {
  const original = command(), hash = validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(original));
  for (const change of [c => { c.goodsReceiptId = "43"; }, c => { c.reasonText = "Different valid reason"; },
    c => { c.source.documentId = "52"; }, c => { c.lines[0].originalMovementId++; },
    c => { c.lines[0].originalSourceLineId = "82"; }, c => { c.lines[0].baseQuantity++; }]) {
    const input = structuredClone(original); change(input);
    assert.notEqual(validation.purchaseReversalBusinessHash(validation.normalizePurchaseReversal(input)), hash);
  }
});

function schemaTransport({ existing = false, invalidColumn = false, badTrigger = false } = {}) {
  let present = existing;
  const statements = [], triggers = new Map();
  if (badTrigger) triggers.set("trg_purchase_reversal_links_update", { trigger_name: "trg_purchase_reversal_links_update",
    event_manipulation: "UPDATE", action_timing: "BEFORE", action_statement: "SET @ignored = 1" });
  return { statements, async query(sql) {
    statements.push(sql);
    if (sql.includes("information_schema.columns")) return [present ?
      ["id", "original_movement_id", "reversal_movement_id", "operation_request_id", "quantity", "created_at"].map(name => ({
        column_name: name, column_type: "bigint unsigned", is_nullable: invalidColumn && name === "quantity" ? "YES" : "NO",
        column_default: null, extra: name === "id" ? "auto_increment" : "" })) : []];
    if (sql.includes("information_schema.statistics")) return [[
      ["PRIMARY", 0, "id"], ["uq_purchase_reversal_movement", 0, "reversal_movement_id"],
      ["uq_purchase_reversal_operation", 0, "operation_request_id"],
      ["idx_purchase_reversal_original", 1, "original_movement_id"], ["idx_purchase_reversal_original", 1, "id"]
    ].map(([index_name, non_unique, column_name], i) => ({ index_name, non_unique, column_name,
      seq_in_index: i === 4 ? 2 : 1 }))];
    if (sql.includes("information_schema.key_column_usage")) return [[
      ["fk_purchase_reversal_original", "original_movement_id", "inventory_movements"],
      ["fk_purchase_reversal_movement", "reversal_movement_id", "inventory_movements"],
      ["fk_purchase_reversal_operation", "operation_request_id", "inventory_operation_requests"]
    ].map(([constraint_name, column_name, referenced_table_name]) => ({ constraint_name, column_name, referenced_table_name,
      referenced_column_name: "id", delete_rule: "RESTRICT", update_rule: "RESTRICT", same_schema: 1 }))];
    if (sql.includes("information_schema.check_constraints")) return [[{ constraint_name: "chk_purchase_reversal_quantity",
      check_clause: "(`quantity` > 0)", enforced: "YES" }]];
    if (sql.includes("information_schema.tables")) return [[{ engine: "InnoDB" }]];
    if (sql.includes("information_schema.triggers")) return [[...triggers.values()]];
    if (sql.includes("CREATE TABLE")) { present = true; return [[]]; }
    if (sql.includes("CREATE TRIGGER")) {
      const [, trigger_name, event_manipulation, action_statement] = sql.match(/CREATE TRIGGER (\w+) BEFORE (UPDATE|DELETE) ON \w+ FOR EACH ROW (.+)/s);
      triggers.set(trigger_name, { trigger_name, event_manipulation, action_timing: "BEFORE", action_statement });
      return [[]];
    }
    throw new Error(`Unexpected schema test SQL: ${sql}`);
  } };
}

test("Purchase reversal link migration creates additive constraints and immutable triggers, then safely reruns", async () => {
  const { up } = await import("../database/migrations/0101_create_inventory_purchase_reversal_links.js");
  const tx = schemaTransport(); await up(tx); await up(tx);
  assert.equal(tx.statements.filter(sql => sql.includes("CREATE TABLE")).length, 1);
  assert.equal(tx.statements.filter(sql => sql.includes("CREATE TRIGGER")).length, 2);
  const ddl = tx.statements.find(sql => sql.includes("CREATE TABLE"));
  assert.match(ddl, /UNIQUE KEY uq_purchase_reversal_movement/);
  assert.match(ddl, /UNIQUE KEY uq_purchase_reversal_operation/);
  assert.match(ddl, /KEY idx_purchase_reversal_original \(original_movement_id, id\)/);
  for (const [column, parent] of [["original_movement_id", "inventory_movements"],
    ["reversal_movement_id", "inventory_movements"], ["operation_request_id", "inventory_operation_requests"]]) {
    assert.match(ddl, new RegExp(`FOREIGN KEY \\(${column}\\)\\s+REFERENCES ${parent} \\(id\\) ON DELETE RESTRICT ON UPDATE RESTRICT`));
  }
  assert.match(ddl, /CHECK \(quantity > 0\)/);
  assert.ok(tx.statements.every(sql => !/DROP |ALTER /u.test(sql)));
});

test("Purchase reversal link migration rejects incompatible pre-existing columns before any mutation", async () => {
  const { up } = await import("../database/migrations/0101_create_inventory_purchase_reversal_links.js");
  const tx = schemaTransport({ existing: true, invalidColumn: true });
  await assert.rejects(up(tx), /Incompatible.*quantity/);
  assert.ok(tx.statements.every(sql => !/CREATE |DROP |ALTER /u.test(sql)));
});

test("Purchase reversal link migration refuses an existing non-immutable trigger instead of replacing it", async () => {
  const { up } = await import("../database/migrations/0101_create_inventory_purchase_reversal_links.js");
  const tx = schemaTransport({ existing: true, badTrigger: true });
  await assert.rejects(up(tx), /Incompatible.*trigger/);
  assert.ok(tx.statements.every(sql => !/CREATE |DROP |ALTER /u.test(sql)));
});

for (const [name, part, corrupt] of [
  ["missing lookup index", "statistics", rows => rows.filter(row => row.index_name !== "idx_purchase_reversal_original")],
  ["non-unique reversal movement", "statistics", rows => rows.map(row => row.index_name === "uq_purchase_reversal_movement" ? { ...row, non_unique: 1 } : row)],
  ["missing foreign key", "key_column_usage", rows => rows.slice(1)],
  ["wrong foreign parent", "key_column_usage", rows => rows.map(row => ({ ...row, referenced_table_name: "users" }))],
  ["foreign cascade", "key_column_usage", rows => rows.map(row => ({ ...row, delete_rule: "CASCADE" }))],
  ["cross-schema foreign key", "key_column_usage", rows => rows.map(row => ({ ...row, same_schema: 0 }))],
  ["missing quantity check", "check_constraints", () => []],
  ["unenforced quantity check", "check_constraints", rows => rows.map(row => ({ ...row, enforced: "NO" }))],
  ["weakened quantity check", "check_constraints", rows => rows.map(row => ({ ...row, check_clause: "quantity >= 0" }))]
]) test(`Purchase reversal link migration rejects ${name} before mutation`, async () => {
  const { up } = await import("../database/migrations/0101_create_inventory_purchase_reversal_links.js");
  const tx = schemaTransport({ existing: true }), query = tx.query.bind(tx);
  tx.query = async sql => { const [rows] = await query(sql); return [sql.includes(`information_schema.${part}`) ? corrupt(rows) : rows]; };
  await assert.rejects(up(tx), /Incompatible/);
  assert.ok(tx.statements.every(sql => !/CREATE |DROP |ALTER /u.test(sql)));
});

function reversalLedger() {
  const rows = [], statements = [];
  return { rows, statements, async execute(sql, p) {
    statements.push(sql);
    if (sql.startsWith("INSERT INTO inventory_operation_requests")) {
      if (rows.some(r => [r.source_module, r.source_document_type, r.source_document_id, r.source_line_id, r.source_event_id]
        .every((v, i) => v === p[i + 1]))) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      rows.push({ ...Object.fromEntries(["command_type", "source_module", "source_document_type", "source_document_id", "source_line_id",
        "source_event_id", "request_hash", "actor_user_id", "actor_label", "request_id", "correlation_id", "created_at"].map((k, i) => [k, p[i]])),
      id: rows.length + 1, completed_at: null });
      return [{ insertId: rows.length }];
    }
    assert.match(sql, /UPDATE inventory_operation_requests/);
    Object.assign(rows.find(r => r.id === p[4]), { result_type: p[0], result_id: p[1], result_summary: p[2], completed_at: p[3] });
    return [{ affectedRows: 1 }];
  }, async query(sql, p) {
    statements.push(sql);
    return [rows.filter(r => p.length === 5 ?
      [r.source_module, r.source_document_type, r.source_document_id, r.source_line_id, r.source_event_id].every((v, i) => v === p[i]) :
      r.source_document_type === p[0] && r.source_document_id === p[1] && r.source_event_id === p[2])];
  } };
}
const reversalQuery = input => ({ documentType: "GOODS_RECEIPT_REVERSAL", ...input.source });
async function claimReversal(tx, input = command()) {
  return receipts.claimPurchaseReversal(tx, { command: validation.normalizePurchaseReversal(input), actorLabel: "sam", requestId: "reverse-test",
    timestamp: 1_800_000_000_000, operations: new InventoryOperationService() });
}
function reversalResults(batch) {
  return batch.members.map((m, i) => ({ sourceLineId: m.sourceLineId, operationId: m.operationId,
    movementId: 300 + i, originalMovementId: m.line.originalMovementId, baseQuantity: m.line.baseQuantity,
    movementGroupId: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}` }));
}

test("Purchase reversal ledger claims the complete numeric-sorted batch before any stock work", async () => {
  const tx = reversalLedger(), input = command();
  input.lines.push({ sourceLineId: "9", originalSourceLineId: "82", originalMovementId: 101, baseQuantity: 1 });
  const batch = await claimReversal(tx, input);
  assert.equal(batch.replay, false);
  assert.deepEqual(tx.rows.map(r => [r.command_type, r.source_line_id]),
    [["PURCHASE_REVERSE_BATCH", ""], ["PURCHASE_REVERSE_LINE", "9"], ["PURCHASE_REVERSE_LINE", "91"]]);
  assert.ok(tx.statements.every(sql => sql.startsWith("INSERT INTO inventory_operation_requests")));
});

test("Purchase reversal ledger uses real scalar serialization and independently decodes the exact source receipt", async () => {
  const tx = reversalLedger(), input = command(), batch = await claimReversal(tx, input), results = reversalResults(batch);
  await receipts.completePurchaseReversal(tx, batch, results);
  const row = JSON.parse(tx.rows[1].result_summary);
  assert.equal(row.originalMovementId, 100); assert.equal(row.rootOperationId, batch.operationId);
  assert.ok(tx.rows.every(r => Buffer.byteLength(r.result_summary) < 8192));
  assert.deepEqual(await receipts.readPurchaseReceipt(tx, reversalQuery(input)),
    { status: "COMPLETED", result: { status: "POSTED", operationId: batch.operationId, lines: results } });
});

test("Purchase reversal ledger replay preserves original IDs and conflicts on changed quantity", async () => {
  const tx = reversalLedger(), input = command(), batch = await claimReversal(tx, input), results = reversalResults(batch);
  await receipts.completePurchaseReversal(tx, batch, results);
  input.actor.userId = 8; input.correlationId = "new-attempt";
  const replay = await claimReversal(tx, input); assert.equal(replay.replay, true); assert.equal(tx.rows.length, 2);
  assert.deepEqual((await receipts.readPurchaseReceipt(tx, reversalQuery(input), { expectedBatch: replay })).result.lines, results);
  input.lines[0].baseQuantity++;
  await assert.rejects(claimReversal(tx, input), e => e.code === "INVENTORY_SOURCE_CONFLICT");
});

test("Purchase reversal ledger fails closed on mixed replay or an uncompleted visible root", async () => {
  const tx = reversalLedger(), input = command(), batch = await claimReversal(tx, input);
  await assert.rejects(receipts.readPurchaseReceipt(tx, reversalQuery(input)), e => e.code === "INVENTORY_SOURCE_CONFLICT");
  await receipts.completePurchaseReversal(tx, batch, reversalResults(batch));
  tx.rows.shift(); await assert.rejects(claimReversal(tx, input), e => e.code === "INVENTORY_SOURCE_CONFLICT");
});

test("Purchase reversal ledger rejects corrupt original ID, membership and persistent quantity", async () => {
  for (const corrupt of [rows => { rows.pop(); }, rows => { rows[1].request_hash = "a".repeat(64); }, rows => {
    const v = JSON.parse(rows[1].result_summary); v.originalMovementId = 0; rows[1].result_summary = JSON.stringify(v);
  }, rows => { const v = JSON.parse(rows[1].result_summary); v.baseQuantity = "2"; rows[1].result_summary = JSON.stringify(v); }]) {
    const tx = reversalLedger(), input = command(), batch = await claimReversal(tx, input);
    await receipts.completePurchaseReversal(tx, batch, reversalResults(batch)); corrupt(tx.rows);
    await assert.rejects(receipts.readPurchaseReceipt(tx, reversalQuery(input)), e => e.code === "INVENTORY_SOURCE_CONFLICT");
  }
});

test("Purchase reversal ledger does not complete a root with a missing or mismatched result", async () => {
  for (const change of [rows => rows.pop(), rows => { rows[0].originalMovementId++; }, rows => { rows[0].movementId = rows[0].originalMovementId; }]) {
    const tx = reversalLedger(), batch = await claimReversal(tx), results = reversalResults(batch); change(results);
    await assert.rejects(receipts.completePurchaseReversal(tx, batch, results), e => e.code === "INVENTORY_SOURCE_CONFLICT");
    assert.ok(tx.rows.every(r => r.completed_at === null));
  }
});
