import assert from "node:assert/strict";
import test from "node:test";
import { up } from "../../database/migrations/0091_seed_fulfillment_permissions.js";
import { nativeDatabase } from "../fulfillment/nativeDatabase.js";

const integration = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integration("Fulfillment permission seed is rerunnable, independent and never grants by administrator role name", async (t) => {
  const { db } = await nativeDatabase(t, { migrateAuth: true });
  await db.execute("INSERT INTO roles(name, created_at) VALUES ('system-admin', 1)");
  await db.execute("INSERT INTO permissions(name, description, created_at) VALUES ('fulfillment.operation', 'Existing legacy permission', 1)");
  await up(db); await up(db);
  const [rows] = await db.query("SELECT name, description FROM permissions ORDER BY name");
  assert.deepEqual(rows.map(row => row.name), ["fulfillment.operation", "fulfillment.reverse", "fulfillment.view"]);
  assert.equal(rows[0].description, "Existing legacy permission");
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM role_permissions"))[0][0].count, 0);
  const [[role]] = await db.query("SELECT id FROM roles WHERE name='system-admin'");
  await db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='fulfillment.view'", [role.id]);
  await up(db);
  assert.deepEqual((await db.query("SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id"))[0].map(row => row.name), ["fulfillment.view"]);
});

integration("Fulfillment permission seed converges after a partial insert failure", async (t) => {
  const { db } = await nativeDatabase(t, { migrateAuth: true });
  let writes = 0;
  await assert.rejects(() => up({ query: db.query.bind(db), execute: (...args) => {
    if (++writes === 2) throw new Error("synthetic insert interruption");
    return db.execute(...args);
  } }), /synthetic insert interruption/);
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM permissions"))[0][0].count, 1);
  await up(db); await up(db);
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM permissions"))[0][0].count, 2);
  assert.equal((await db.query("SELECT COUNT(*) AS count FROM role_permissions"))[0][0].count, 0);
});
