import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { nativeDatabase } from "./nativeDatabase.js";

function ownedFixtureEnvironment(t) {
  for (const [name, value] of Object.entries({ DB_SOCKET_PATH: "/tmp/erp-fulfillment-p0-mysql-unit/absent.sock", DB_NAME: "fulfillment_p0_fixture_unit" })) {
    const before = process.env[name]; process.env[name] = value;
    t.after(() => { if (before === undefined) delete process.env[name]; else process.env[name] = before; });
  }
}

test("a failed scratch connection still drops the owned schema and closes its admin", async (t) => {
  ownedFixtureEnvironment(t);
  const queries = [], hooks = []; let calls = 0, closed = 0;
  const admin = { query: async sql => { queries.push(sql); }, end: async () => { closed++; } };
  t.mock.method(mysql, "createConnection", async () => {
    if (++calls === 1) return admin;
    throw new Error("synthetic scratch connect failure");
  });
  await assert.rejects(nativeDatabase({ after: hook => hooks.push(hook) }), /synthetic scratch connect failure/);
  assert.equal(hooks.length, 1); await hooks[0]();
  assert.match(queries[1], /^DROP DATABASE IF EXISTS `fulfillment_p0_[a-f0-9]{32}`$/);
  assert.equal(closed, 1);
});

test("scratch close and drop failures are both retained and do not skip admin close", async (t) => {
  ownedFixtureEnvironment(t);
  const hooks = []; let calls = 0, dropped = 0, closed = 0;
  const admin = { query: async sql => {
    if (sql.startsWith("DROP")) { dropped++; throw new Error("synthetic drop failure"); }
  }, end: async () => { closed++; } };
  const scratch = { end: async () => { throw new Error("synthetic scratch close failure"); } };
  t.mock.method(mysql, "createConnection", async () => ++calls === 1 ? admin : scratch);
  await nativeDatabase({ after: hook => hooks.push(hook) }, { beforeClose: async () => { throw new Error("synthetic pool close failure"); } });
  await assert.rejects(hooks[0], error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(item => item.message), ["synthetic pool close failure", "synthetic scratch close failure", "synthetic drop failure"]);
    return true;
  });
  assert.equal(dropped, 1); assert.equal(closed, 1);
});
