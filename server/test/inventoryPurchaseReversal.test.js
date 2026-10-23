import assert from "node:assert/strict";
import test from "node:test";
import * as validation from "../src/modules/inventory/inventoryPurchaseValidation.js";

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
