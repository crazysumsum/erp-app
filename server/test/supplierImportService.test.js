import assert from "node:assert/strict";
import test from "node:test";

import {
  assertJobTransition,
  assertRowStatement,
  countsFromRows,
  IMPORT_JOB_STATUSES,
  IMPORT_JOB_TRANSITIONS,
  SupplierImportService
} from "../src/modules/supplier/SupplierImportService.js";

/**
 * TASK-042：狀態機同統計重建。交易規則（鎖、rollback、marker、lease）喺
 * test/integration/supplierImportExecution.integration.test.js 打真 MySQL。
 */

test("the job state machine covers the ten designed states and only the designed moves", () => {
  assert.deepEqual([...IMPORT_JOB_STATUSES].sort(), Object.keys(IMPORT_JOB_TRANSITIONS).sort());
  assert.equal(IMPORT_JOB_STATUSES.length, 10);
  for (const terminal of ["completed", "completed_with_errors", "failed", "cancelled"]) {
    assert.deepEqual(IMPORT_JOB_TRANSITIONS[terminal], [], `${terminal} is terminal`);
  }
  assert.doesNotThrow(() => assertJobTransition("queued", "running"));
  assert.doesNotThrow(() => assertJobTransition("running", "running"), "a dead worker's job is taken over");
  for (const [from, to] of [["running", "cancelled"], ["ready", "running"], ["completed", "running"], ["validating", "queued"]]) {
    assert.throws(() => assertJobTransition(from, to), TypeError, `${from} -> ${to}`);
  }
});

test("job counts are rebuilt from row statuses, with invalid rows still pending until they are skipped", () => {
  assert.deepEqual(countsFromRows([
    { status: "applied", total: 3 }, { status: "failed", total: "2" }, { status: "skipped", total: 1 }
  ]), { total: 6, applied: 3, failed: 2, skipped: 1, pending: 0 });
  assert.deepEqual(countsFromRows([{ status: "valid", total: 1 }, { status: "warning", total: 1 }, { status: "invalid", total: 1 }]),
    { total: 3, applied: 0, failed: 0, skipped: 0, pending: 3 });
  assert.deepEqual(countsFromRows([]), { total: 0, applied: 0, failed: 0, skipped: 0, pending: 0 });
});

test("the execution API refuses malformed input before touching the database", async () => {
  const database = { withTransaction() { throw new Error("must not be reached"); } };
  const importer = new SupplierImportService({ database, time: { nowMs: () => 1 } });
  await assert.rejects(() => importer.claimForExecution({ leaseOwner: " ", leaseDurationMs: 1 }), TypeError);
  await assert.rejects(() => importer.claimForExecution({ leaseOwner: "w", leaseDurationMs: 0 }), TypeError);
  await assert.rejects(() => importer.processNextRow({ jobId: 1, leaseOwner: "w", leaseDurationMs: 1 }), TypeError,
    "no applyRow, no execution");
  await assert.rejects(() => importer.processNextRow({ jobId: 0, leaseOwner: "w", leaseDurationMs: 1, applyRow() {} }), TypeError);
  await assert.rejects(() => importer.finalizeExecution({ jobId: 1, leaseOwner: "" }), TypeError);
  assert.throws(() => new SupplierImportService({ database }), TypeError);
});

test("applyRow's connection admits data statements only, however a control statement is spelled (REV-062 M-4)", () => {
  for (const sql of ["/* x */ COMMIT", "-- x\nCOMMIT", "# x\nCOMMIT", "/*!COMMIT*/", "START /*x*/ TRANSACTION", "commit",
    "ROLLBACK", "SAVEPOINT a", "BEGIN", "XA START 'x'", "ANALYZE TABLE suppliers", "OPTIMIZE TABLE suppliers",
    "CHECK TABLE suppliers", "FLUSH TABLES", "CALL p()", "PREPARE s FROM 'COMMIT'", "EXECUTE s", "DO 1",
    "SET @@autocommit = 0", "SET foreign_key_checks = 0", "SET NAMES latin1", "SET SESSION sql_mode = ''",
    "LOCK TABLES suppliers WRITE", "CREATE TABLE t (a INT)", "LOAD DATA INFILE 'x' INTO TABLE suppliers",
    "SELECT 1 INTO OUTFILE '/tmp/x'", "SELECT /*!COMMIT*/ 1", "", undefined, { sql: "COMMIT" }]) {
    assert.throws(() => assertRowStatement(sql), TypeError, JSON.stringify(sql));
  }
  for (const sql of ["SELECT id FROM suppliers WHERE id = ? FOR UPDATE", "SELECT 1 LOCK IN SHARE MODE",
    "INSERT INTO t (release_date) VALUES (?)", "UPDATE t SET commit_hash = ?", "/* note */ SELECT 1",
    "-- note\nDELETE FROM t WHERE id = ?", "WITH x AS (SELECT 1) SELECT * FROM x", "replace into t values (1)"]) {
    assert.doesNotThrow(() => assertRowStatement(sql), sql);
  }
});
