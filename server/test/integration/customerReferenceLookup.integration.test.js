import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Customer reference lookup allows each viewer permission and returns only historical identity fields", async (t) => {
  const source = defaultConfigurationSource();
  const app = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
  const db = app.services.require("mysqldatabase");
  const now = Date.now();
  const marker = randomUUID().slice(0, 8);
  const ids = { customers: [], users: [], roles: [] };
  t.after(async () => {
    try {
      for (const id of ids.customers) await db.execute("DELETE FROM customers WHERE id = ?", [id]);
      for (const id of ids.users) {
        await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]);
        await db.execute("DELETE FROM user_roles WHERE user_id = ?", [id]);
        await db.execute("DELETE FROM users WHERE id = ?", [id]);
      }
      for (const id of ids.roles) {
        await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [id]);
        await db.execute("DELETE FROM roles WHERE id = ?", [id]);
      }
    } finally {
      await app.shutdown("customer_reference_lookup_test_complete");
    }
  });

  const literal = "%_!\\";
  async function customer(suffix, name, status) {
    const code = `REF-${suffix}-${marker}`;
    const [result] = await db.execute(
      `INSERT INTO customers
        (customer_code, customer_code_key, legal_name, legal_name_key, trading_name, status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Unused trading name', ?, 1, ?, ?)`,
      [code, code.toLowerCase(), name, name.toLowerCase(), status, now, now]
    );
    const id = Number(result.insertId);
    ids.customers.push(id);
    return { id, code, name, status };
  }
  const archived = await customer("B", `Archived ${literal}${marker}`, "archived");
  const suspended = await customer("A", `Suspended XY!\\${marker}`, "suspended");

  async function token(label, permission) {
    const roleName = `reference-${label}-${marker}`;
    const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, now]);
    ids.roles.push(role.insertId);
    if (permission) {
      const [[row]] = await db.query("SELECT id FROM permissions WHERE name = ?", [permission]);
      await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [role.insertId, row.id]);
    }
    const [user] = await db.execute(
      "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'unused', 'Synthetic viewer', ?, ?)",
      [roleName, now, now]
    );
    ids.users.push(user.insertId);
    await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user.insertId, role.insertId]);
    const subject = String(user.insertId);
    const version = await app.services.require("tokenRevocation").currentVersion(subject);
    return app.services.require("jwt").issue(
      { roles: [roleName], permissions: permission ? [permission] : [] },
      { subject, version, authTime: Math.floor(now / 1000) }
    );
  }

  const { url } = await app.start();
  async function lookup(jwt, params) {
    const endpoint = new URL("/api/v1/customer-lookups/references", url);
    endpoint.search = new URLSearchParams(params).toString();
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${jwt}` } });
    return { status: response.status, body: await response.json() };
  }

  let viewer;
  for (const permission of ["customer.view", "sales.view", "fulfillment.view"]) {
    viewer = await token(permission, permission);
    const result = await lookup(viewer, { q: marker });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.data, { items: [suspended, archived], total: 2, page: 1, pageSize: 20 });
  }
  assert.equal((await lookup(await token("denied"), { q: marker })).status, 403);

  const filtered = await lookup(viewer, { q: literal + marker });
  assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
  assert.deepEqual(filtered.body.data.items, [archived]);

  const byCode = await lookup(viewer, { q: "A-" + marker });
  assert.equal(byCode.status, 200);
  assert.deepEqual(byCode.body.data.items, [suspended]);

  const byStatus = await lookup(viewer, { q: marker, status: "archived" });
  assert.equal(byStatus.status, 200);
  assert.deepEqual(byStatus.body.data.items, [archived]);

  const paged = await lookup(viewer, { q: marker, page: "2", pageSize: "1" });
  assert.equal(paged.status, 200);
  assert.deepEqual(paged.body.data, { items: [archived], total: 2, page: 2, pageSize: 1 });
  assert.equal((await lookup(viewer, { pageSize: "51" })).status, 400);
});
