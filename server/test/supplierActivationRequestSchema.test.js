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
      extra: name === "pending_slot" ? "STORED GENERATED" : ""
    })),
    // The behavioural probe. `candidate` is the Supplier it would probe against;
    // no candidate means it has nothing to probe and returns without a verdict.
    candidate: [],
    blocks: { pending: true, approved: false },
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
  const inserted = [];
  return {
    inserted,
    async beginTransaction() { inserted.push("BEGIN"); },
    async rollback() { inserted.push("ROLLBACK"); },
    async execute(sql, params) {
      const status = params[2];
      inserted.push(status);
      if (inserted.filter((entry) => entry === status).length > 1 && shape.blocks[status]) {
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }
      return [{ affectedRows: 1 }];
    },
    async query(sql) {
      if (sql.includes("FROM suppliers")) return [shape.candidate];
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
    candidate: [{ ID: 7 }],
    blocks: upper.blocks,
    columns: upper.columns.map(({ column_name, extra }) => ({ COLUMN_NAME: column_name, EXTRA: extra })),
    indexes: upper.indexes.map(({ index_name }) => ({ INDEX_NAME: index_name })),
    pendingSlotIndex: upper.pendingSlotIndex.map(({ non_unique, column_name }) =>
      ({ NON_UNIQUE: non_unique, COLUMN_NAME: column_name })),
    foreignKeys: upper.foreignKeys.map(({ constraint_name }) => ({ CONSTRAINT_NAME: constraint_name }))
  };
  assert.equal(await inspectSupplierActivationRequestSchema(connectionFor(shouted)), true);
});

test("the table must actually refuse a second pending request for the same Supplier", async () => {
  // This is the invariant pending_slot exists to provide. Earlier revisions tried to
  // infer it from the text of GENERATION_EXPRESSION; that accepted a literal holding
  // a backslash, which enforces nothing, and rejected CASE WHEN, <=> and BINARY
  // forms, which all enforce correctly. Asking the database is not defeatable by
  // rendering, charset, sql_mode, engine or escaping.
  const enforcing = schema({ candidate: [{ id: 7 }] });
  assert.equal(await inspectSupplierActivationRequestSchema(connectionFor(enforcing)), true);

  const notEnforcing = schema({ candidate: [{ id: 7 }], blocks: { pending: false, approved: false } });
  await assert.rejects(
    () => inspectSupplierActivationRequestSchema(connectionFor(notEnforcing)),
    (error) => error instanceof Error && /second pending blocked: false/u.test(error.message)
  );
});

test("a slot that is never NULL is rejected too, because it would block decided history", async () => {
  // IF(status = 'pending', 1, 1) blocks a second pending request, so the first half
  // of the probe passes it. It also blocks the second decided request, which is the
  // history this table exists to keep.
  const blocksHistory = schema({ candidate: [{ id: 7 }], blocks: { pending: true, approved: true } });
  await assert.rejects(
    () => inspectSupplierActivationRequestSchema(connectionFor(blocksHistory)),
    (error) => error instanceof Error && /second decided blocked: true/u.test(error.message)
  );
});

test("the probe always rolls back, and skips a database with no Supplier to probe", async () => {
  const enforcing = connectionFor(schema({ candidate: [{ id: 7 }] }));
  await inspectSupplierActivationRequestSchema(enforcing);
  assert.deepEqual(enforcing.inserted, ["BEGIN", "pending", "pending", "approved", "approved", "ROLLBACK"]);

  const failing = connectionFor(schema({ candidate: [{ id: 7 }], blocks: { pending: false, approved: false } }));
  await assert.rejects(() => inspectSupplierActivationRequestSchema(failing));
  assert.equal(failing.inserted.at(-1), "ROLLBACK", "a failed probe must still roll back");

  const empty = connectionFor(schema());
  assert.equal(await inspectSupplierActivationRequestSchema(empty), true);
  assert.deepEqual(empty.inserted, [], "nothing to probe against means nothing is written");
});
