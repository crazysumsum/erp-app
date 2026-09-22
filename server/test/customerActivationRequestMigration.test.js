import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerActivationRequestSchema } from "../database/migrations/0048_create_customer_activation_requests.js";

const COLUMNS = [
  "id", "customer_id", "requested_by", "assigned_approver_id", "customer_version",
  "critical_snapshot_hash", "summary", "approval_setting_value", "approval_setting_version",
  "status", "pending_slot", "request_note", "decision_reason", "requested_at", "decided_at",
  "decided_by", "version"
];

function schema(overrides = {}) {
  return {
    columns: COLUMNS.map((column_name) => ({
      column_name,
      extra: column_name === "pending_slot" ? "STORED GENERATED" : ""
    })),
    indexes: ["PRIMARY", "uq_customer_activation_pending", "idx_customer_activation_approver", "idx_customer_activation_customer"]
      .map((index_name) => ({ index_name })),
    pendingSlotIndex: [
      { non_unique: 0, column_name: "customer_id" },
      { non_unique: 0, column_name: "pending_slot" }
    ],
    foreignKeys: ["fk_customer_activation_customer", "fk_customer_activation_requested_by",
      "fk_customer_activation_approver", "fk_customer_activation_decided_by"]
      .map((constraint_name) => ({ constraint_name })),
    ...overrides
  };
}

function connectionFor(shape) {
  return {
    async query(sql) {
      if (sql.includes("information_schema.columns")) return [shape.columns];
      if (sql.includes("index_name = 'uq_customer_activation_pending'")) return [shape.pendingSlotIndex];
      if (sql.includes("information_schema.statistics")) return [shape.indexes];
      if (sql.includes("referential_constraints")) return [shape.foreignKeys];
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

test("Customer activation request schema requires the generated one-pending slot and exact unique index", async () => {
  assert.equal(await inspectCustomerActivationRequestSchema(connectionFor(schema())), true);
  assert.equal(await inspectCustomerActivationRequestSchema(connectionFor(schema({ columns: [] }))), false);
  await assert.rejects(
    () => inspectCustomerActivationRequestSchema(connectionFor(schema({
      columns: schema().columns.map((row) => row.column_name === "pending_slot" ? { ...row, extra: "" } : row)
    }))),
    /pending_slot is not a generated column/u
  );
  await assert.rejects(
    () => inspectCustomerActivationRequestSchema(connectionFor(schema({
      pendingSlotIndex: [{ non_unique: 1, column_name: "customer_id" }, { non_unique: 1, column_name: "pending_slot" }]
    }))),
    /must be UNIQUE \(customer_id, pending_slot\)/u
  );
});
