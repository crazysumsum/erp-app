import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerAttachmentSchema, up } from "../database/migrations/0050_create_customer_attachments.js";

test("Customer attachment migration creates the durable recovery and ownership constraints", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes("information_schema.columns")) return [[]];
      return [[]];
    }
  };
  await up(connection);
  const ddl = calls.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS customer_attachments"));
  assert.match(ddl, /UNIQUE KEY uq_customer_attachment_operation \(operation_id\)/u);
  assert.match(ddl, /KEY idx_customer_attachment_recovery \(status,updated_at,id\)/u);
  assert.match(ddl, /FOREIGN KEY \(operation_id\) REFERENCES customer_operation_requests \(id\) ON DELETE RESTRICT/u);
  assert.doesNotMatch(ddl, /absolute_path|file_path|plaintext/u);
});

test("Customer attachment schema inspector accepts absence and rejects partial schemas", async () => {
  assert.equal(await inspectCustomerAttachmentSchema({ async query() { return [[]]; } }), false);
  await assert.rejects(
    () => inspectCustomerAttachmentSchema({ async query(sql) { return [String(sql).includes("information_schema.columns") ? [{ column_name: "id" }] : []]; } }),
    /Incompatible existing Customer attachment schema/u
  );
});
