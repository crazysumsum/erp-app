import assert from "node:assert/strict";
import test from "node:test";
import {
  getTransactionOutcome,
  hasTransactionEventAdmission,
  MySqlDatabaseOperationError,
  MySqlDatabaseService
} from "../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../src/services/context/RequestContextService.js";
import { createTestTime, servicesWithTime } from "../test-support/createTestTime.js";

const config = {
  queryTimeoutMs: 2500,
  acquireTimeoutMs: 5000,
  transactionTimeoutMs: 5000,
  abandonedConnectionAction: "destroy"
};

/** 每一句 query/execute 現在都自己借還一條連線，所以 pool 替身要能借出來。 */
function lendable(pool) {
  const lent = { release: 0, destroy: 0 };
  return {
    lent,
    pool: {
      ...pool,
      getConnection: async () => ({
        query: pool.query,
        execute: pool.execute,
        release: () => {
          lent.release += 1;
        },
        destroy: () => {
          lent.destroy += 1;
        }
      })
    }
  };
}

const silentLogger = {
  debug: async () => {},
  error: async () => {}
};
const context = new RequestContextService({
  services: servicesWithTime(createTestTime())
});

// Programmed connection outcomes only; native mutex exclusion is the private L1 case.
function admissionConnection({ schema = "task036_unit", acquired = 1, released = 1,
  acquireError, rollbackError, commitError } = {}) {
  const calls = [];
  const borrowed = { count: 0 };
  const connection = {
    async query(input, parameters = []) {
      const sql = input.sql ?? input;
      calls.push([sql, ...parameters]);
      if (sql.includes("GET_LOCK")) {
        if (acquireError) throw acquireError;
        return [[{ acquired }]];
      }
      if (sql.includes("RELEASE_LOCK")) return [[{ released }]];
      return [[{ ok: 1 }]];
    },
    async beginTransaction() { calls.push(["begin"]); },
    async commit() { calls.push(["commit"]); if (commitError) throw commitError; },
    async rollback() { calls.push(["rollback"]); if (rollbackError) throw rollbackError; },
    release() { calls.push(["release"]); },
    destroy() { calls.push(["destroy"]); }
  };
  const requestContext = new RequestContextService({ services: servicesWithTime(createTestTime()) });
  const database = new MySqlDatabaseService({
    pool: { query: (...args) => connection.query(...args), getConnection: async () => { borrowed.count += 1; return connection; } },
    config: { ...config, database: schema }, logger: silentLogger, context: requestContext
  });
  return { database, calls, borrowed, context: requestContext,
    run: (work, options) => requestContext.storage.run({ databaseTransaction: null },
      () => database.withTransaction(work, options)) };
}

test("TASK036-DB admission identity and closed-executor authority", { timeout: 10000 }, async () => {
  const eventId = "abcdef01-1234-4000-8000-abcdef012345";
  const key = fixture => fixture.calls.find(([sql]) => sql.includes("GET_LOCK"))[1];
  const healthy = fixture => {
    assert.equal(fixture.borrowed.count, 1);
    assert.deepEqual(fixture.calls.map(([sql]) => sql), [
      "SELECT GET_LOCK(?,0) AS acquired", "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      "begin", "commit", "SELECT RELEASE_LOCK(?) AS released", "release"
    ]);
    assert.equal(fixture.calls[0][1], fixture.calls[4][1]);
    assert.match(key(fixture), /^[a-f0-9]{64}$/u);
  };
  // 1. Case-normalized mutex, while the caller's original identifier remains intact.
  const lower = admissionConnection(), upper = admissionConnection();
  const request = Object.freeze({ eventId: eventId.toUpperCase(), payloadHash: "a".repeat(64) });
  await lower.run(() => {}, { eventAdmissionId: eventId });
  await upper.run(() => assert.equal(request.eventId, eventId.toUpperCase()), { eventAdmissionId: request.eventId });
  healthy(lower); healthy(upper); assert.equal(key(lower), key(upper));
  assert.equal(request.payloadHash, "a".repeat(64));
  // 2. Schema is part of the key.
  const otherSchema = admissionConnection({ schema: "task036_other" });
  await otherSchema.run(() => {}, { eventAdmissionId: eventId });
  healthy(otherSchema); assert.notEqual(key(lower), key(otherSchema));
  // 3. Actor/target context cannot partition admission of the same event.
  const otherActor = admissionConnection();
  await otherActor.context.storage.run({ databaseTransaction: null, auth: { claims: { sub: "2" } }, targetId: "99" },
    () => otherActor.database.withTransaction(() => {}, { eventAdmissionId: eventId }));
  healthy(otherActor); assert.equal(key(lower), key(otherActor));
  // 4. The existing no-option RR path has no named lock.
  const ordinary = admissionConnection();
  await ordinary.run(() => {});
  assert.deepEqual(ordinary.calls.map(([sql]) => sql), [
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", "begin", "commit", "release"
  ]);
  // 5. Invalid identifiers are rejected before borrowing/SQL.
  const invalid = admissionConnection();
  await assert.rejects(invalid.run(() => assert.fail("invalid callback"), { eventAdmissionId: "not-a-uuid" }), TypeError);
  assert.deepEqual(invalid.calls, []);
  assert.equal(invalid.borrowed.count, 0);
  // 6. An admitted nested transaction cannot borrow a second connection.
  const nested = admissionConnection();
  await nested.run(async () => {
    await assert.rejects(nested.database.withTransaction(() => assert.fail("nested callback"),
      { eventAdmissionId: eventId }), /requires a new transaction/u);
  }, { eventAdmissionId: eventId });
  healthy(nested);
  // 7. Only the actual active database/context/executor/event carries authority.
  const active = admissionConnection(), wrong = admissionConnection();
  let saved;
  await active.run(async tx => {
    saved = tx;
    assert.equal(hasTransactionEventAdmission(active.database, tx, eventId), true);
    assert.equal(hasTransactionEventAdmission(active.database, tx, request.eventId), true);
    assert.equal(hasTransactionEventAdmission(wrong.database, tx, eventId), false);
    assert.equal(hasTransactionEventAdmission(active.database, tx, "abcdef01-1234-4000-8000-abcdef012346"), false);
    assert.equal(hasTransactionEventAdmission(active.database, { eventAdmissionId: eventId, ...tx }, eventId), false);
    await active.context.storage.run({ databaseTransaction: null }, async () => {
      assert.equal(hasTransactionEventAdmission(active.database, tx, eventId), false);
    });
  }, { eventAdmissionId: eventId });
  healthy(active);
  // 8. Closure revokes the marker and rejects SQL even with the old context restored.
  const before = structuredClone(active.calls);
  await active.context.storage.run({ databaseTransaction: saved }, async () => {
    assert.equal(hasTransactionEventAdmission(active.database, saved, eventId), false);
    await assert.rejects(saved.query("SELECT 1"), { code: "DATABASE_OPERATION_ABORTED" });
  });
  assert.deepEqual(active.calls, before);
});

test("TASK036-DB admission contention and truthful cleanup outcomes", { timeout: 10000 }, async () => {
  const eventId = "abcdef01-1234-4000-8000-abcdef012345";
  const options = { eventAdmissionId: eventId };
  const names = fixture => fixture.calls.map(([sql]) => sql);
  const primary = new Error("task036 original business failure");
  // 1. Known contention is a controlled 503 before BEGIN or callback.
  const busy = admissionConnection({ acquired: 0 });
  await assert.rejects(busy.run(() => assert.fail("busy callback"), options), error => {
    assert.equal(error.code, "DATABASE_EVENT_ADMISSION_UNAVAILABLE");
    assert.equal(error.statusCode, 503); return true;
  });
  assert.deepEqual(names(busy), ["SELECT GET_LOCK(?,0) AS acquired", "release"]);
  // 2. NULL is unknown session ownership and must quarantine the connection.
  const unknown = admissionConnection({ acquired: null });
  await assert.rejects(unknown.run(() => assert.fail("unknown callback"), options), { code: "DATABASE_EVENT_ADMISSION_UNAVAILABLE" });
  assert.deepEqual(names(unknown), ["SELECT GET_LOCK(?,0) AS acquired", "destroy"]);
  // 3. A failed GET_LOCK cannot return a potentially owning session to the pool.
  const acquisition = new Error("task036 admission SQL failed");
  const failed = admissionConnection({ acquireError: acquisition });
  await assert.rejects(failed.run(() => assert.fail("acquisition callback"), options), error => {
    assert.equal(error.cause, acquisition); return true;
  });
  assert.deepEqual(names(failed), ["SELECT GET_LOCK(?,0) AS acquired", "destroy"]);
  // 4. Rollback failure preserves the primary cause and reports indeterminate.
  const rollback = admissionConnection({ rollbackError: new Error("task036 rollback failed") });
  let rollbackTx;
  await assert.rejects(rollback.run(tx => { rollbackTx = tx; throw primary; }, options), error => {
    assert.equal(error.code, "DATABASE_TRANSACTION_INDETERMINATE");
    assert.equal(error.cause, primary); return true;
  });
  assert.deepEqual(getTransactionOutcome(rollbackTx), { state: "INDETERMINATE" });
  assert.deepEqual(names(rollback).slice(2), ["begin", "rollback", "destroy"]);
  // 5. Unknown unlock after definite COMMIT does not relabel the outcome.
  const committed = admissionConnection({ released: null });
  let committedTx;
  assert.equal(await committed.run(tx => { committedTx = tx; return "saved"; }, options), "saved");
  assert.deepEqual(getTransactionOutcome(committedTx), { state: "COMMITTED" });
  assert.deepEqual(names(committed).slice(2), ["begin", "commit", "SELECT RELEASE_LOCK(?) AS released", "destroy"]);
  // 6. Unknown unlock after definite rollback retains the original error/outcome.
  const rolledBack = admissionConnection({ released: 0 });
  let rolledBackTx;
  await assert.rejects(rolledBack.run(tx => { rolledBackTx = tx; throw primary; }, options), error => {
    assert.equal(error.cause, primary); return true;
  });
  assert.deepEqual(getTransactionOutcome(rolledBackTx), { state: "ROLLED_BACK" });
  assert.deepEqual(names(rolledBack).slice(2), ["begin", "rollback", "SELECT RELEASE_LOCK(?) AS released", "destroy"]);
  // 7. COMMIT ACK loss is not followed by rollback or unlock on an unknown session.
  const ack = Object.assign(new Error("task036 commit ACK lost"), { code: "PROTOCOL_CONNECTION_LOST" });
  const ambiguous = admissionConnection({ commitError: ack });
  let ambiguousTx;
  await assert.rejects(ambiguous.run(tx => { ambiguousTx = tx; }, options), { code: "DATABASE_TRANSACTION_INDETERMINATE" });
  assert.deepEqual(getTransactionOutcome(ambiguousTx), { state: "INDETERMINATE" });
  assert.deepEqual(names(ambiguous).slice(2), ["begin", "commit", "destroy"]);
  // 8. Explicit cancellation after admission destroys once; no timer/sampling loop.
  const aborted = admissionConnection(), controller = new AbortController();
  let abortedTx;
  await assert.rejects(aborted.run(tx => {
    abortedTx = tx;
    assert.equal(hasTransactionEventAdmission(aborted.database, tx, eventId), true);
    controller.abort(new Error("task036 caller cancellation"));
  }, { ...options, signal: controller.signal }), { code: "DATABASE_OPERATION_ABORTED" });
  assert.equal(hasTransactionEventAdmission(aborted.database, abortedTx, eventId), false);
  assert.deepEqual(getTransactionOutcome(abortedTx), { state: "INDETERMINATE" });
  assert.deepEqual(names(aborted).slice(2), ["begin", "destroy"]);
});

test("MySQL database service verifies connectivity during initialization", async () => {
  const calls = [];
  const { pool } = lendable({
    query: async (...args) => {
      calls.push(args);
      return [[{ ok: 1 }]];
    },
    end: async () => {}
  });
  const database = new MySqlDatabaseService({
    pool,
    config,
    logger: silentLogger,
    context
  });

  await database.initialize();

  assert.deepEqual(calls, [
    [{ sql: "SELECT 1 AS ok", timeout: 2500 }, []]
  ]);
});

test("MySQL database service rejects an invalid initialization health result", async () => {
  const database = new MySqlDatabaseService({
    pool: lendable({
      query: async () => [[{ ok: 0 }]],
      end: async () => {}
    }).pool,
    config,
    logger: silentLogger,
    context
  });

  await assert.rejects(
    () => database.initialize(),
    (error) => {
      assert.equal(error.code, "DATABASE_HEALTH_CHECK_FAILED");
      return true;
    }
  );
});

test("MySQL database service applies query timeouts and parameterized execution", async () => {
  const calls = [];
  const { pool, lent } = lendable({
    query: async (...args) => {
      calls.push(["query", ...args]);
      return [[{ id: 7 }]];
    },
    execute: async (...args) => {
      calls.push(["execute", ...args]);
      return [{ affectedRows: 1 }];
    },
    end: async () => {}
  });
  const database = new MySqlDatabaseService({ pool, config, logger: silentLogger, context });

  const [rows] = await database.query("SELECT id FROM users WHERE id = ?", [7]);
  await database.execute("UPDATE users SET active = ? WHERE id = ?", [true, 7], {
    timeoutMs: 1000,
    operationName: "activateUser"
  });

  assert.deepEqual(rows, [{ id: 7 }]);
  assert.deepEqual(calls[0], [
    "query",
    { sql: "SELECT id FROM users WHERE id = ?", timeout: 2500 },
    [7]
  ]);
  assert.deepEqual(calls[1], [
    "execute",
    { sql: "UPDATE users SET active = ? WHERE id = ?", timeout: 1000 },
    [true, 7]
  ]);
  // 成功的查詢一律還回池子，不管 abandonedConnectionAction 設什麼。
  assert.deepEqual(lent, { release: 2, destroy: 0 });
});

test("MySQL database service commits successful transactions and releases connections", async () => {
  const calls = [];
  const connection = {
    query: async (...args) => {
      calls.push(["query", ...args]);
      return [[], []];
    },
    execute: async (...args) => {
      calls.push(["execute", ...args]);
      return [{ insertId: 42 }];
    },
    beginTransaction: async () => calls.push(["begin"]),
    commit: async () => calls.push(["commit"]),
    rollback: async () => calls.push(["rollback"]),
    release: () => calls.push(["release"])
  };
  const pool = {
    query: async () => [[], []],
    getConnection: async () => connection,
    end: async () => {}
  };
  const database = new MySqlDatabaseService({ pool, config, logger: silentLogger, context });

  const result = await database.withTransaction(
    async (transaction, { signal }) => {
      assert.equal(signal.aborted, false);
      const [writeResult] = await transaction.execute(
        "INSERT INTO orders (name) VALUES (?)",
        ["Test"]
      );
      return writeResult.insertId;
    },
    { isolationLevel: "READ COMMITTED" }
  );

  assert.equal(result, 42);
  assert.deepEqual(calls.map(([name]) => name), [
    "query",
    "begin",
    "execute",
    "commit",
    "release"
  ]);
  assert.equal(
    calls[0][1],
    "SET TRANSACTION ISOLATION LEVEL READ COMMITTED"
  );
});

test("MySQL database service rolls back failed transactions", async () => {
  const calls = [];
  const connection = {
    query: async () => [[], []],
    execute: async () => {
      throw new Error("write failed");
    },
    beginTransaction: async () => calls.push("begin"),
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
    release: () => calls.push("release")
  };
  const pool = {
    query: async () => [[], []],
    getConnection: async () => connection,
    end: async () => {}
  };
  const database = new MySqlDatabaseService({ pool, config, logger: silentLogger, context });

  await assert.rejects(
    () =>
      database.withTransaction((transaction) =>
        transaction.execute("INSERT INTO orders (name) VALUES (?)", ["Fail"])
      ),
    (error) => {
      assert.ok(error instanceof MySqlDatabaseOperationError);
      assert.equal(error.code, "DATABASE_OPERATION_FAILED");
      return true;
    }
  );
  assert.deepEqual(calls, ["begin", "rollback", "release"]);
});

test("transaction queries automatically inherit the transaction timeout signal", async () => {
  const calls = [];
  const connection = {
    query: async () => [[], []],
    execute: async () => {
      calls.push("execute");
      return new Promise(() => {});
    },
    beginTransaction: async () => calls.push("begin"),
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
    release: () => calls.push("release")
  };
  const pool = {
    query: async () => [[], []],
    getConnection: async () => connection,
    end: async () => {}
  };
  const database = new MySqlDatabaseService({
    pool,
    config: { ...config, transactionTimeoutMs: 10 },
    logger: silentLogger,
    context
  });

  await assert.rejects(
    () =>
      database.withTransaction((transaction) =>
        transaction.execute("SELECT SLEEP(30)")
      ),
    (error) => {
      assert.ok(error instanceof MySqlDatabaseOperationError);
      assert.equal(error.code, "DATABASE_TRANSACTION_TIMEOUT");
      return true;
    }
  );
  assert.deepEqual(calls, ["begin", "execute", "rollback", "release"]);
});

test("a commit slower than the deadline is cut off, and no rollback chases it", async () => {
  // 這裡曾經是「commit 之前先解除期限」，理由是不要讓逾時在 commit 進行中觸發
  // 一個並行的 rollback。那個顧慮是對的，解法是錯的：期限一解除，一個永不回應
  // 的 COMMIT 就沒有任何東西中斷得了。
  //
  // 正確的解法是期限照樣蓋著 commit，而 rollback 由 commitAttempted 擋掉——
  // COMMIT 一旦送出去，伺服器可能已經提交了，再送 rollback 沒有意義。
  const calls = [];
  const connection = {
    query: async () => [[], []],
    execute: async () => [{ affectedRows: 1 }],
    beginTransaction: async () => calls.push("begin"),
    commit: async () => {
      calls.push("commit");
      await new Promise((resolve) => { setTimeout(resolve, 200); });
    },
    rollback: async () => calls.push("rollback"),
    destroy: () => calls.push("destroy"),
    release: () => calls.push("release")
  };
  const database = new MySqlDatabaseService({
    pool: {
      query: async () => [[], []],
      getConnection: async () => connection,
      end: async () => {}
    },
    config: { ...config, transactionTimeoutMs: 10 },
    logger: silentLogger,
    context
  });
  let actualTransaction;

  await assert.rejects(
    () =>
      database.withTransaction(async (transaction) => {
        actualTransaction = transaction;
        await transaction.execute("UPDATE orders SET status = ?", ["created"]);
        return "committed";
      }),
    (error) => error.code === "DATABASE_TRANSACTION_INDETERMINATE"
  );

  // destroy 而不是 release：這條連線上可能還有一個沒收掉的交易。
  assert.deepEqual(calls, ["begin", "commit", "destroy"]);
  assert.deepEqual(getTransactionOutcome(actualTransaction), { state: "INDETERMINATE" });
});

test("a commit that fits inside the deadline still commits normally", async () => {
  const calls = [];
  const connection = {
    query: async () => [[], []],
    execute: async () => [{ affectedRows: 1 }],
    beginTransaction: async () => calls.push("begin"),
    commit: async () => {
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      calls.push("commit");
    },
    rollback: async () => calls.push("rollback"),
    destroy: () => calls.push("destroy"),
    release: () => calls.push("release")
  };
  const database = new MySqlDatabaseService({
    pool: {
      query: async () => [[], []],
      getConnection: async () => connection,
      end: async () => {}
    },
    config: { ...config, transactionTimeoutMs: 500 },
    logger: silentLogger,
    context
  });

  const result = await database.withTransaction(async (transaction) => {
    await transaction.execute("UPDATE orders SET status = ?", ["created"]);
    return "committed";
  });

  assert.equal(result, "committed");
  assert.deepEqual(calls, ["begin", "commit", "release"]);
});

test("transaction abort destroys a connection with unfinished database work", async () => {
  const calls = [];
  const connection = {
    query: async () => [[], []],
    execute: async () => {
      calls.push("execute");
      return new Promise(() => {});
    },
    beginTransaction: async () => calls.push("begin"),
    commit: async () => calls.push("commit"),
    rollback: async () => calls.push("rollback"),
    destroy: () => calls.push("destroy"),
    release: () => calls.push("release")
  };
  const database = new MySqlDatabaseService({
    pool: {
      query: async () => [[], []],
      getConnection: async () => connection,
      end: async () => {}
    },
    config: { ...config, transactionTimeoutMs: 10 },
    logger: silentLogger,
    context
  });

  await assert.rejects(
    () =>
      database.withTransaction((transaction) =>
        transaction.execute("SELECT SLEEP(30)")
      ),
    (error) => {
      assert.equal(error.code, "DATABASE_TRANSACTION_TIMEOUT");
      return true;
    }
  );

  assert.deepEqual(calls, ["begin", "execute", "destroy"]);
});
