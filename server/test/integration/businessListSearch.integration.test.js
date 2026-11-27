import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { migrationFixture } from "../sales/phase1/fixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Business list filters respect customer, supplier, document and audit search terms", async t => {
  const f = await migrationFixture(t, []);
  const source = defaultConfigurationSource();
  const app = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
  t.after(() => app.shutdown("business_list_search_complete"));

  const suffix = randomUUID().slice(0, 8);
  const role = "list-reader-" + suffix;
  const permissions = ["ap.view", "ar.view", "business_master.view", "fulfillment.view",
    "purchasing.view", "receiving.operation", "sales.view", "supplier.view"];
  const roleId = await f.insert("roles", { name: role, created_at: f.now });
  const userId = await f.insert("users", { username: role, display_name: "查詢人員", password_hash: "test-only",
    created_at: f.now, updated_at: f.now });
  f.beforeParents.push(async () => {
    await f.db.execute("DELETE FROM fr_token_versions WHERE subject=?", [String(userId)]);
    await f.db.execute("DELETE FROM user_roles WHERE user_id=?", [userId]);
    await f.db.execute("DELETE FROM role_permissions WHERE role_id=?", [roleId]);
  });
  await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)", [userId, roleId]);
  for (const name of permissions) {
    const [result] = await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [roleId, name]);
    assert.equal(result.affectedRows, 1, name);
  }

  const currencyName = "港幣測試" + suffix;
  await f.db.execute("UPDATE currencies SET name=?,status='ACTIVE' WHERE code=?", [currencyName, f.currency]);
  const jobId = await f.insert("sales_import_jobs", { batch_number: "SI-261127-" + String(f.customerId).padStart(6, "0"),
    template_version: "1.0", original_file_name: "門市訂單.csv", source_file_path: "fixture/orders.csv",
    file_sha256: createHash("sha256").update(suffix).digest(), file_size_bytes: 1, status: "UPLOADED", created_by: userId, created_at: f.now, updated_at: f.now });
  const version = await app.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await app.services.require("jwt").issue({ roles: [role], permissions },
    { subject: String(userId), version, authTime: Math.floor(f.now / 1000) });
  const { url } = await app.start();
  async function list(resource, filters) {
    const get = () => fetch(`${url}/api/v1/${resource}?${new URLSearchParams(filters)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    let response = await get();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      assert.ok(Number.isSafeInteger(retryAfter) && retryAfter > 0, resource);
      await response.arrayBuffer();
      await delay(retryAfter * 1000);
      response = await get();
    }
    assert.equal(response.status, 200, resource);
    const { data } = await response.json();
    assert.ok(Array.isArray(data.items), resource);
    return data.items;
  }

  for (const term of [currencyName, f.currency]) {
    assert.deepEqual((await list("business-master/currencies", { q: term })).map(item => item.code), [f.currency]);
  }
  const customer = "尚未交易客戶" + suffix;
  const supplier = "尚未交易供應商" + suffix;
  const orderNumber = "STORE-ORDER-" + suffix;
  const channel = "STORE-" + suffix;
  const auditAction = "catalog.fixture." + suffix;
  const imports = `sales-imports/${jobId}/orders`;
  const emptyLists = [
    ["ap-invoices", { q: supplier }], ["ap-payments", { q: supplier }],
    ["ar-credit-notes", { q: customer }], ["ar-invoices", { q: customer }], ["ar-receipts", { q: customer }],
    ["receiving-lookups/purchase-orders", { q: supplier }], ["fulfillment-queue", { q: customer }],
    ["fulfillments", { q: orderNumber }], ["shipments", { q: orderNumber }],
    ["sales-orders", { q: customer }], ["outstanding-sales-orders", { q: customer }],
    ["sales-quotations", { q: customer }], ["sales-quotations", { number: "QT-" + suffix }],
    ["sales-orders", { number: orderNumber }], ["outstanding-sales-orders", { number: orderNumber }],
    ["sales-orders", { channelCode: channel }], ["outstanding-sales-orders", { channelCode: channel }],
    ["business-master/audit", { action: auditAction }], ["sales-audit-logs", { action: auditAction }],
    ["supplier-audit/logs", { action: auditAction }], ["supplier-audit/logs", { targetType: channel }],
    [imports, { channelCode: channel }], [imports, { errorCode: "UNKNOWN_SKU" }]
  ];
  for (const [resource, filters] of emptyLists) assert.deepEqual(await list(resource, filters), [], resource);

  const unicodeFilters = [
    ["fulfillments", "q"],
    ["shipments", "q"],
    ["outstanding-sales-orders", "number"],
    ["sales-orders", "channelCode"],
    ["outstanding-sales-orders", "channelCode"],
    ["business-master/audit", "action"],
    ["sales-audit-logs", "action"],
    ["supplier-audit/logs", "action"],
    ["supplier-audit/logs", "targetType"],
    [imports, "channelCode"],
    [imports, "errorCode"]
  ];
  for (const [resource, field] of unicodeFilters) {
    assert.deepEqual(await list(resource, { [field]: "中é😀" }), [], `${resource} ${field}`);
  }
});
