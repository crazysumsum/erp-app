import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerImportJobSchema, up as upJobs } from "../database/migrations/0052_create_customer_import_jobs.js";
import { inspectCustomerImportRowSchema, up as upRows } from "../database/migrations/0053_create_customer_import_rows.js";

test("Customer import migrations create durable job and row recovery state", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes("information_schema.columns")) return [[]];
      return [[]];
    }
  };
  await upJobs(connection);
  await upRows(connection);
  const jobs = calls.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS customer_import_jobs"));
  const rows = calls.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS customer_import_rows"));
  assert.match(jobs, /UNIQUE KEY uq_customer_import_actor_key \(created_by,idempotency_key\)/u);
  assert.match(jobs, /KEY idx_customer_import_source_recovery \(source_storage_status,updated_at,id\)/u);
  assert.match(jobs, /FOREIGN KEY \(operation_id\) REFERENCES customer_operation_requests \(id\) ON DELETE RESTRICT/u);
  assert.match(rows, /PRIMARY KEY \(job_id,`row_number`\)/u);
  assert.match(rows, /FOREIGN KEY \(job_id\) REFERENCES customer_import_jobs \(id\) ON DELETE CASCADE/u);
  assert.doesNotMatch(`${jobs}${rows}`, /bank_account|attachment|secret|plaintext/u);
});

test("Customer import schema inspectors accept absence and reject partial schemas", async () => {
  assert.equal(await inspectCustomerImportJobSchema({ async query() { return [[]]; } }), false);
  assert.equal(await inspectCustomerImportRowSchema({ async query() { return [[]]; } }), false);
  await assert.rejects(
    () => inspectCustomerImportJobSchema({ async query(sql) { return [String(sql).includes("information_schema.columns") ? [{ column_name: "id" }] : []]; } }),
    /Incompatible existing Customer import schema/u
  );
  await assert.rejects(
    () => inspectCustomerImportRowSchema({ async query(sql) { return [String(sql).includes("information_schema.columns") ? [{ column_name: "job_id" }] : []]; } }),
    /Incompatible existing Customer import schema/u
  );
});

test("Customer import schema inspectors accept the exact adopted schema", async () => {
  const jobColumns = [
    "id", "idempotency_key", "template_version", "operation_id", "source_stored_name", "source_sha256",
    "source_storage_status", "result_stored_name", "result_sha256", "result_storage_status", "files_purged_at",
    "mode", "activation_mode", "approver_user_id", "approval_setting_value", "approval_setting_version", "status",
    "total_count", "valid_count", "warning_count", "invalid_count", "success_count", "failed_count", "skipped_count",
    "lease_owner", "lease_until", "last_error_code", "error_summary", "created_by", "confirmed_by", "created_at",
    "updated_at", "confirmed_at", "completed_at", "version"
  ];
  const jobIndexes = {
    PRIMARY: [0, "id"], uq_customer_import_actor_key: [0, "created_by,idempotency_key"],
    uq_customer_import_operation: [0, "operation_id"], uq_customer_import_source_name: [0, "source_stored_name"],
    uq_customer_import_result_name: [0, "result_stored_name"], idx_customer_import_status: [1, "status,created_at,id"],
    idx_customer_import_lease: [1, "lease_until,status"], idx_customer_import_actor: [1, "created_by,created_at,id"],
    idx_customer_import_source_recovery: [1, "source_storage_status,updated_at,id"],
    idx_customer_import_result_recovery: [1, "result_storage_status,updated_at,id"]
  };
  const jobForeignKeys = [
    ["fk_customer_import_operation", "operation_id", "customer_operation_requests", "id", "RESTRICT"],
    ["fk_customer_import_approver", "approver_user_id", "users", "id", "SET NULL"],
    ["fk_customer_import_created_by", "created_by", "users", "id", "SET NULL"],
    ["fk_customer_import_confirmed_by", "confirmed_by", "users", "id", "SET NULL"]
  ];
  const jobConnection = {
    async query(sql) {
      if (String(sql).includes("information_schema.columns")) return [jobColumns.map((column_name) => ({ column_name }))];
      if (String(sql).includes("information_schema.statistics")) return [Object.entries(jobIndexes).flatMap(([index_name, [non_unique, columns]]) => columns.split(",").map((column_name) => ({ index_name, non_unique, column_name })))];
      return [jobForeignKeys.map(([constraint_name, column_name, referenced_table_name, referenced_column_name, delete_rule]) => ({ constraint_name, column_name, referenced_table_name, referenced_column_name, delete_rule }))];
    }
  };
  assert.equal(await inspectCustomerImportJobSchema(jobConnection), true);

  const rowColumns = ["job_id", "row_number", "operation", "match_customer_id", "expected_customer_version", "normalized_payload", "status", "applied_customer_id", "errors", "warnings", "started_at", "completed_at", "version"];
  const rowConnection = {
    async query(sql) {
      if (String(sql).includes("information_schema.columns")) return [rowColumns.map((column_name) => ({ column_name }))];
      if (String(sql).includes("information_schema.statistics")) return [[
        { index_name: "PRIMARY", non_unique: 0, column_name: "job_id" }, { index_name: "PRIMARY", non_unique: 0, column_name: "row_number" },
        { index_name: "idx_customer_import_row_status", non_unique: 1, column_name: "job_id" },
        { index_name: "idx_customer_import_row_status", non_unique: 1, column_name: "status" },
        { index_name: "idx_customer_import_row_status", non_unique: 1, column_name: "row_number" }
      ]];
      return [[{ constraint_name: "fk_customer_import_row_job", column_name: "job_id", referenced_table_name: "customer_import_jobs", referenced_column_name: "id", delete_rule: "CASCADE" }]];
    }
  };
  assert.equal(await inspectCustomerImportRowSchema(rowConnection), true);
});
