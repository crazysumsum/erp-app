import assert from "node:assert/strict";
import test from "node:test";

import { inspectSupplierActivationRequestSchema } from "../database/migrations/0035_create_supplier_activation_requests.js";

// The real DDL is verified against MySQL in supplierCoreMigrations.integration.test.js.
// What that cannot show is what the inspection REJECTS, because proving it would mean
// deliberately corrupting the shared erp_dev schema. A fake connection can hand back a
// schema MySQL never produced here, so each property the inspection claims to enforce
// is exercised against a schema that violates exactly that property and nothing else.
const COLUMNS = [
  "id", "supplier_id", "requested_by", "assigned_approver_id", "supplier_version", "summary",
  "status", "pending_slot", "request_note", "decision_reason", "requested_at", "decided_at",
  "decided_by", "version"
];

function schema(overrides = {}) {
  return {
    columns: COLUMNS.map((name) => ({
      column_name: name,
      extra: name === "pending_slot" ? "STORED GENERATED" : "",
      generation_expression: name === "pending_slot" ? "if((`status` = _utf8mb4\\'pending\\'),1,NULL)" : ""
    })),
    indexes: ["PRIMARY", "uq_supplier_activation_pending", "idx_supplier_activation_approver", "idx_supplier_activation_supplier"]
      .map((index_name) => ({ index_name })),
    pendingSlotIndex: [
      { non_unique: 0, column_name: "supplier_id" },
      { non_unique: 0, column_name: "pending_slot" }
    ],
    foreignKeys: ["fk_supplier_activation_supplier", "fk_supplier_activation_requested_by",
      "fk_supplier_activation_approver", "fk_supplier_activation_decided_by"]
      .map((constraint_name) => ({ constraint_name })),
    ...overrides
  };
}

function connectionFor(shape) {
  return {
    async query(sql) {
      if (sql.includes("information_schema.columns")) return [shape.columns];
      if (sql.includes("index_name = 'uq_supplier_activation_pending'")) return [shape.pendingSlotIndex];
      if (sql.includes("information_schema.statistics")) return [shape.indexes];
      if (sql.includes("referential_constraints")) return [shape.foreignKeys];
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

test("a schema matching the migration is accepted, and an absent table is not an error", async () => {
  assert.equal(await inspectSupplierActivationRequestSchema(connectionFor(schema())), true);
  assert.equal(await inspectSupplierActivationRequestSchema(connectionFor(schema({ columns: [] }))), false);
});

test("pending_slot must be generated, not merely named pending_slot", async () => {
  const plainColumn = schema().columns.map((row) => (row.column_name === "pending_slot" ? { ...row, extra: "" } : row));
  await assert.rejects(
    () => inspectSupplierActivationRequestSchema(connectionFor(schema({ columns: plainColumn }))),
    /pending_slot is not a generated column/u
  );
});

test("pending_slot must be exactly IF(status = 'pending', 1, NULL), not merely an expression mentioning both", async () => {
  // Every one of these was accepted by an earlier substring check. The last group
  // matters most: IF(status = 'pending', id, NULL) gives each pending row a
  // distinct slot, so UNIQUE (supplier_id, pending_slot) constrains nothing while
  // the inspection reports the table as correct and up() returns early.
  const rejected = [
    "if((`status` = _utf8mb4\\'approved\\'),1,NULL)",       // different status
    "if((`status` like _utf8mb4\\'pending%\\'),1,NULL)",     // different operator
    "if((`status` <> _utf8mb4\\'pending\\'),1,NULL)",        // exact inverse invariant
    "if((not((`status` = _utf8mb4\\'pending\\'))),1,NULL)",  // negated
    "if((`status` = _utf8mb4\\'pending\\'),NULL,1)",         // branches swapped
    "if((`status` = _utf8mb4\\'pending\\'),`id`,NULL)",      // slot is not a constant
    "if((`status` = _utf8mb4\\'pending\\'),1,1)",            // never frees the slot
    "if((`request_status` = _utf8mb4\\'pending\\'),1,NULL)", // different column
    "concat(`status`,_utf8mb4\\'pending\\')",                // not a predicate at all
    ""                                                     // absent
  ];
  for (const generation_expression of rejected) {
    const columns = schema().columns.map((row) => (row.column_name === "pending_slot"
      ? { ...row, generation_expression }
      : row));
    await assert.rejects(
      () => inspectSupplierActivationRequestSchema(connectionFor(schema({ columns }))),
      /pending_slot is not exactly IF\(status = 'pending', 1, NULL\)/u,
      `accepted ${generation_expression || "an empty expression"}`
    );
  }
});

test("the accepted expression tolerates only MySQL's own rewriting of the committed DDL", async () => {
  // The charset introducer follows the column's charset, and MySQL's spacing and
  // NULL casing are its own; nothing else about the expression may vary.
  for (const generation_expression of [
    "if((`status` = _utf8mb4\\'pending\\'),1,NULL)",
    "if((`status` = _ascii\\'pending\\'),1,NULL)",
    "if((`status` = \\'pending\\'),1,NULL)",
    "if((`status`=_utf8mb4\\'pending\\'),1,null)"
  ]) {
    const columns = schema().columns.map((row) => (row.column_name === "pending_slot"
      ? { ...row, generation_expression }
      : row));
    assert.equal(await inspectSupplierActivationRequestSchema(connectionFor(schema({ columns }))), true,
      `rejected ${generation_expression}`);
  }
});

test("uq_supplier_activation_pending must actually be unique", async () => {
  const notUnique = schema().pendingSlotIndex.map((row) => ({ ...row, non_unique: 1 }));
  await assert.rejects(
    () => inspectSupplierActivationRequestSchema(connectionFor(schema({ pendingSlotIndex: notUnique }))),
    /must be UNIQUE \(supplier_id, pending_slot\)/u
  );
});

test("uq_supplier_activation_pending must cover exactly (supplier_id, pending_slot) in that order", async () => {
  for (const columns of [
    [{ non_unique: 0, column_name: "supplier_id" }],
    [{ non_unique: 0, column_name: "pending_slot" }, { non_unique: 0, column_name: "supplier_id" }],
    [{ non_unique: 0, column_name: "supplier_id" }, { non_unique: 0, column_name: "pending_slot" },
      { non_unique: 0, column_name: "requested_at" }],
    []
  ]) {
    await assert.rejects(
      () => inspectSupplierActivationRequestSchema(connectionFor(schema({ pendingSlotIndex: columns }))),
      /must be UNIQUE \(supplier_id, pending_slot\)/u,
      `accepted a unique index over ${JSON.stringify(columns.map((row) => row.column_name))}`
    );
  }
});

test("MySQL's uppercase information_schema column names are read the same way", async () => {
  const upper = schema();
  const shouted = {
    columns: upper.columns.map(({ column_name, extra, generation_expression }) =>
      ({ COLUMN_NAME: column_name, EXTRA: extra, GENERATION_EXPRESSION: generation_expression })),
    indexes: upper.indexes.map(({ index_name }) => ({ INDEX_NAME: index_name })),
    pendingSlotIndex: upper.pendingSlotIndex.map(({ non_unique, column_name }) =>
      ({ NON_UNIQUE: non_unique, COLUMN_NAME: column_name })),
    foreignKeys: upper.foreignKeys.map(({ constraint_name }) => ({ CONSTRAINT_NAME: constraint_name }))
  };
  assert.equal(await inspectSupplierActivationRequestSchema(connectionFor(shouted)), true);
});
