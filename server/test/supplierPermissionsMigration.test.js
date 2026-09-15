import assert from "node:assert/strict";
import test from "node:test";
import { up } from "../database/migrations/0028_seed_supplier_management_permissions.js";

const EXPECTED_PERMISSIONS = [
  "supplier.approval",
  "supplier.bank.mgmt",
  "supplier.bank.view",
  "supplier.mgmt",
  "supplier.settings",
  "supplier.view"
];

function fakeDatabase() {
  const roles = new Map();
  const permissions = new Map();
  const links = new Set();
  let nextId = 1;

  return {
    roles,
    permissions,
    links,
    async query(sql, params) {
      if (sql.includes("SELECT id FROM roles")) {
        const row = roles.get(params[0]);
        return [row ? [{ id: row.id }] : []];
      }
      if (sql.includes("SELECT id FROM permissions")) {
        const row = permissions.get(params[0]);
        return [row ? [{ id: row.id }] : []];
      }
      if (sql.includes("SELECT 1 FROM role_permissions")) {
        return [links.has(`${params[0]}:${params[1]}`) ? [{ present: 1 }] : []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      if (sql.includes("INSERT INTO roles")) {
        const id = nextId++;
        roles.set(params[0], { id, description: params[1] });
        return [{ insertId: id }];
      }
      if (sql.includes("INSERT INTO permissions")) {
        const id = nextId++;
        permissions.set(params[0], { id, description: params[1] });
        return [{ insertId: id }];
      }
      if (sql.includes("INSERT INTO role_permissions")) {
        links.add(`${params[0]}:${params[1]}`);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    }
  };
}

test("0028 seeds all six Supplier permissions and grants each to system-admin", async () => {
  const database = fakeDatabase();

  await up(database);

  assert.deepEqual([...database.permissions.keys()].sort(), EXPECTED_PERMISSIONS);
  const roleId = database.roles.get("system-admin").id;
  const held = [...database.permissions.values()].filter(({ id }) => database.links.has(`${roleId}:${id}`));
  assert.equal(held.length, EXPECTED_PERMISSIONS.length);
});

test("0028 converges when it is run more than once", async () => {
  const database = fakeDatabase();

  await up(database);
  await up(database);

  assert.equal(database.roles.size, 1);
  assert.equal(database.permissions.size, EXPECTED_PERMISSIONS.length);
  assert.equal(database.links.size, EXPECTED_PERMISSIONS.length);
});
