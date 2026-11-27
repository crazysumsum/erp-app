import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Warehouse references let each permitted role search active and inactive warehouses without exposing master details", async (t) => {
  const configuration = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: { ...configuration, application: { ...configuration.application, host: "127.0.0.1", port: 0 } }
  });
  const database = application.services.require("mysqldatabase");
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const roleIds = [], userIds = [], warehouses = [];
  t.after(async () => {
    try {
      for (const warehouse of warehouses) await database.execute("DELETE FROM inventory_warehouses WHERE id = ?", [warehouse.id]);
      for (const id of userIds) await database.execute("DELETE FROM users WHERE id = ?", [id]);
      for (const id of roleIds) await database.execute("DELETE FROM roles WHERE id = ?", [id]);
    } finally {
      await application.shutdown("warehouse_reference_integration_complete");
    }
  });

  const now = Date.now();
  const suffix = randomUUID().slice(0, 8);
  async function actor(permission) {
    const name = `warehouse-reference-${permission}-${suffix}`;
    const [role] = await database.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [name, now]);
    roleIds.push(role.insertId);
    const [user] = await database.execute(
      "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, 'synthetic', ?, ?)", [name, now, now]);
    userIds.push(user.insertId);
    await database.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user.insertId, role.insertId]);
    const [grant] = await database.execute(
      "INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role.insertId, permission]);
    assert.equal(grant.affectedRows, 1);
    const subject = String(user.insertId);
    return jwt.issue({ roles: [name], permissions: [permission] }, {
      subject, version: await tokenRevocation.currentVersion(subject), authTime: Math.floor(now / 1000)
    });
  }

  for (const [part, name, status] of [
    ["A", `Warehouse ${suffix} 75ab\\!`, "ACTIVE"],
    ["B", `Warehouse ${suffix} 75%_\\!`, "INACTIVE"]
  ]) {
    const code = `WREF-${suffix}-${part}`;
    const [created] = await database.execute(
      `INSERT INTO inventory_warehouses
        (warehouse_code, normalized_code, warehouse_name, address, description, status, created_at, updated_at)
       VALUES (?, ?, ?, 'Synthetic internal address', 'Synthetic master description', ?, ?, ?)`,
      [code, code.toUpperCase(), name, status, now, now]);
    warehouses.push({ id: Number(created.insertId), code, name, status });
  }

  const { url } = await application.start();
  async function read(token, params, status = 200, path = "/api/v1/inventory-lookups/warehouses") {
    const query = new URLSearchParams(params);
    const response = await fetch(`${url}${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body.data;
  }

  const query = { q: `Warehouse ${suffix}` };
  const expected = { items: warehouses, total: 2, page: 1, pageSize: 20 };
  const inventory = await actor("inventory.view");
  const master = await read(inventory, { ...query, status: "ALL" }, 200, "/api/v1/inventory/warehouses");
  assert.equal(master.total, 2);
  assert.deepEqual(await read(inventory, query), expected);
  assert.deepEqual(await read(await actor("sales.view"), query), expected);
  assert.deepEqual(await read(await actor("fulfillment.view"), query), expected);
  await read(await actor("item.view"), query, 403);

  assert.deepEqual(await read(inventory, { q: `${suffix}-A`, pageSize: 50 }), {
    items: [warehouses[0]], total: 1, page: 1, pageSize: 50
  });
  assert.deepEqual(await read(inventory, { q: `${suffix} 75%_\\!` }), {
    items: [warehouses[1]], total: 1, page: 1, pageSize: 20
  });
  assert.deepEqual(await read(inventory, { ...query, status: "INACTIVE" }), {
    items: [warehouses[1]], total: 1, page: 1, pageSize: 20
  });
  assert.deepEqual(await read(inventory, { ...query, page: 2, pageSize: 1 }), {
    items: [warehouses[1]], total: 2, page: 2, pageSize: 1
  });
  await read(inventory, { ...query, pageSize: 51 }, 400);
  await read(inventory, { ...query, status: "ARCHIVED" }, 400);
});
