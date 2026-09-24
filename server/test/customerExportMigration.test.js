import assert from "node:assert/strict";
import test from "node:test";

import { up } from "../database/migrations/0054_create_customer_export_jobs.js";

test("Customer export migration creates owner-scoped durable result jobs without a purge path", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      const text = String(sql); calls.push(text);
      if (text.includes("information_schema.columns")) return calls.some((value) => value.includes("CREATE TABLE"))
        ? [["id", "idempotency_key", "operation_id", "filter_snapshot", "result_stored_name", "result_sha256", "result_storage_status", "status", "total_count", "expires_at", "last_error_code", "error_summary", "created_by", "created_at", "updated_at", "completed_at", "version"].map((column_name) => ({ column_name }))]
        : [[]];
      if (text.includes("information_schema.statistics")) return [[
        { index_name: "PRIMARY", non_unique: 0, column_name: "id" },
        ...["created_by", "idempotency_key"].map((column_name) => ({ index_name: "uq_customer_export_actor_key", non_unique: 0, column_name })),
        { index_name: "uq_customer_export_operation", non_unique: 0, column_name: "operation_id" },
        { index_name: "uq_customer_export_result_name", non_unique: 0, column_name: "result_stored_name" },
        ...["created_by", "created_at", "id"].map((column_name) => ({ index_name: "idx_customer_export_actor", non_unique: 1, column_name })),
        ...["status", "updated_at", "id"].map((column_name) => ({ index_name: "idx_customer_export_status", non_unique: 1, column_name }))
      ]];
      if (text.includes("information_schema.referential_constraints")) return [[
        { constraint_name: "fk_customer_export_operation", column_name: "operation_id", referenced_table_name: "customer_operation_requests", referenced_column_name: "id", delete_rule: "RESTRICT" },
        { constraint_name: "fk_customer_export_created_by", column_name: "created_by", referenced_table_name: "users", referenced_column_name: "id", delete_rule: "SET NULL" }
      ]];
      return [[]];
    }
  };
  await up(connection);
  const ddl = calls.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS customer_export_jobs"));
  assert.match(ddl, /UNIQUE KEY uq_customer_export_actor_key \(created_by,idempotency_key\)/u);
  assert.match(ddl, /filter_snapshot JSON NOT NULL/u);
  assert.match(ddl, /expires_at BIGINT UNSIGNED NULL/u);
  assert.doesNotMatch(ddl, /files_purged_at|DELETE FROM/u);
});
