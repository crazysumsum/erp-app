import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runRunner, scratchDatabase } from "./supplierScratchDatabase.js";

test("H-10 serializes two migration processes on a new database", {
  skip: process.env.DB_INTEGRATION_TESTS !== "1"
}, async t => {
  const { name, connection } = await scratchDatabase(t);
  const [[{ acquired }]] = await connection.query("SELECT GET_LOCK('erp-app:migrate', 600) AS acquired");
  assert.equal(acquired, 1);
  const runs = Promise.allSettled([runRunner(name), runRunner(name)]);
  let results;
  try {
    // Hold both processes at the entrance so scheduling cannot turn this into two serial launches.
    const deadline = Date.now() + 15_000;
    for (;;) {
      const [[{ waiting }]] = await connection.query(
        "SELECT COUNT(*) AS waiting FROM information_schema.processlist WHERE DB = ? AND ID <> CONNECTION_ID() AND STATE = 'User lock'",
        [name]
      );
      if (Number(waiting) === 2) break;
      assert.ok(Date.now() < deadline, "both migration processes must wait for the lock");
      await delay(50);
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('erp-app:migrate')");
    results = await runs;
  }

  const appliedByProcess = results.map(result => {
    assert.equal(result.status, "fulfilled", result.reason?.message);
    return result.value.stdout.split("\n").filter(line => line.startsWith("applied ")).length;
  }).sort((a, b) => a - b);
  const [[{ count }]] = await connection.query("SELECT COUNT(*) AS count FROM fr_schema_migrations");
  assert.ok(Number(count) > 0);
  assert.deepEqual(appliedByProcess, [0, Number(count)]);
});
