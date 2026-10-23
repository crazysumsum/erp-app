import assert from "node:assert/strict";
import test from "node:test";
import { PERMISSION_CATALOGUE } from "../../src/modules/authorization/permissionCatalogue.js";

// The six names are written out rather than derived from the catalogue by prefix: this is
// the set SEC-002 through SEC-007 specify, and deriving it would let a dropped entry pass.
const EXPECTED = [
  "purchasing.view",
  "purchasing.mgmt",
  "purchasing.approval",
  "purchasing.settings",
  "receiving.operation",
  "receiving.expiry.override"
];

test("TASK-003 purchasing permission seed is idempotent, complete and grants no roles", async () => {
  const { up } = await import("../../database/migrations/0100_seed_purchasing_permissions.js");
  const rows = new Map();
  let selects = 0;
  const connection = {
    query: async (sql, [name]) => {
      assert.equal(sql, "SELECT id FROM permissions WHERE name = ?");
      selects += 1;
      return [rows.has(name) ? [{ id: rows.size }] : []];
    },
    execute: async (sql, [name, description, createdAt]) => {
      assert.equal(sql, "INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?)");
      assert.ok(Number.isSafeInteger(createdAt));
      assert.equal(rows.has(name), false, `${name} was inserted twice`);
      rows.set(name, description);
    }
  };

  await up(connection);
  assert.deepEqual([...rows.keys()], EXPECTED);

  // A second run on a database that already has them must insert nothing: execute() above
  // fails the test if it is called again, and the SELECT count proves up() really re-ran.
  const afterFirst = selects;
  await up(connection);
  assert.equal(selects, afterFirst * 2);
  assert.deepEqual([...rows.keys()], EXPECTED);

  for (const [name, description] of rows) {
    assert.equal(
      PERMISSION_CATALOGUE.find((permission) => permission.name === name)?.description,
      description,
      `${name} description drifts from the catalogue; startup would warn on every boot`
    );
  }
});

test("TASK-003 the seed grants no role, so no permission is handed out by default", async () => {
  const source = await import.meta.resolve("../../database/migrations/0100_seed_purchasing_permissions.js");
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL(source), "utf8");
  assert.doesNotMatch(text, /INSERT\s+INTO\s+role_permissions/iu);
  assert.doesNotMatch(text, /System Administrator['"]/iu);
});
