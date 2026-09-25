import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerAttachmentStageSchema, up } from "../database/migrations/0051_create_customer_attachment_stages.js";

test("Customer attachment stage migration creates a bounded durable cleanup queue", async () => {
  const calls = [];
  const connection = { async query(sql) {
    calls.push(String(sql));
    if (String(sql).includes("information_schema.columns")) return [[]];
    return [[]];
  } };
  await up(connection);
  const ddl = calls.find((sql) => sql.includes("CREATE TABLE customer_attachment_stages"));
  assert.match(ddl, /PRIMARY KEY \(operation_id\)/u);
  assert.match(ddl, /UNIQUE KEY uq_customer_attachment_stage_name \(stored_name\)/u);
  assert.match(ddl, /KEY idx_customer_attachment_stage_recovery \(updated_at,operation_id\)/u);
  assert.match(ddl, /ON DELETE CASCADE/u);
});

test("Customer attachment stage migration rejects a unique recovery index", async () => {
  const connection = { async query(sql) {
    const text = String(sql);
    if (text.includes("information_schema.columns")) {
      return [["operation_id", "stored_name", "created_at", "updated_at"].map((column_name) => ({ column_name }))];
    }
    if (text.includes("information_schema.statistics")) return [[
      { index_name: "PRIMARY", non_unique: 0, column_name: "operation_id" },
      { index_name: "idx_customer_attachment_stage_recovery", non_unique: 0, column_name: "updated_at" },
      { index_name: "idx_customer_attachment_stage_recovery", non_unique: 0, column_name: "operation_id" },
      { index_name: "uq_customer_attachment_stage_name", non_unique: 0, column_name: "stored_name" }
    ]];
    return [[]];
  } };
  await assert.rejects(() => inspectCustomerAttachmentStageSchema(connection), /stage index/u);
});
