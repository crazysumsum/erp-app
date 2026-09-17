import assert from "node:assert/strict";
import test from "node:test";

import { inspectSupplierActivationRequestSchema } from "../database/migrations/0035_create_supplier_activation_requests.js";

// The real DDL is verified against MySQL in supplierCoreMigrations.integration.test.js,
// which also proves the one-pending invariant behaviourally. What that cannot show is
// what this inspection REJECTS, because proving it would mean deliberately corrupting
// the shared erp_dev schema. A fake connection can hand back a schema MySQL never
// produced here, so each property the inspection still claims — the column list, the
// generated column, the exact unique index — is exercised against a schema that
// violates that property and nothing else.
const COLUMNS = [
  "id", "supplier_id", "requested_by", "assigned_approver_id", "supplier_version", "summary",
  "status", "pending_slot", "request_note", "decision_reason", "requested_at", "decided_at",
  "decided_by", "version"
];

function schema(overrides = {}) {
  return {
    columns: COLUMNS.map((name) => ({
      column_name: name,
      extra: name === "pending_slot" ? "STORED GENERATED" : ""
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
    columns: upper.columns.map(({ column_name, extra }) => ({ COLUMN_NAME: column_name, EXTRA: extra })),
    indexes: upper.indexes.map(({ index_name }) => ({ INDEX_NAME: index_name })),
    pendingSlotIndex: upper.pendingSlotIndex.map(({ non_unique, column_name }) =>
      ({ NON_UNIQUE: non_unique, COLUMN_NAME: column_name })),
    foreignKeys: upper.foreignKeys.map(({ constraint_name }) => ({ CONSTRAINT_NAME: constraint_name }))
  };
  assert.equal(await inspectSupplierActivationRequestSchema(connectionFor(shouted)), true);
});
