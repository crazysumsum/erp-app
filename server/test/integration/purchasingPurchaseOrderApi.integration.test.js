/**
 * TASK-015／TC-003：PO Draft create／update 經真 HTTP、真 JWT、真 framework idempotency 同真 MySQL（設計 §5.1、§5.2、§10.4）。
 *
 * 呢度證明嘅係接線：route、auth、permission、Idempotency-Key＝eventId、response schema 同真 provider。業務規則喺
 * purchasingPurchaseOrders.integration.test.js。HTTP 寫入一定 commit：PO 同主檔完咗刪走；operation、audit 同當月
 * purchasing_document_sequences 有 trigger 擋 DELETE，會留低。用 HKD、唔建 Payment Term（TC-001 要求冇 Payment Term）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function request(url, { method = "POST", token, key, body } = {}) {
  return fetch(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

/** 已 commit 嘅最少主檔；t.after 刪走 PO、主檔同 token version。 */
async function setup(t) {
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now(), created = {};
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  t.after(async () => {
    try {
      for (const id of [created.buyer, created.viewer].filter(Boolean)) {
        await db.query("DELETE FROM purchase_order_lines WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE created_by = ?)", [id]);
        await db.query("DELETE FROM purchase_orders WHERE created_by = ?", [id]);
      }
      for (const [table, column, id] of [["item_sku_uoms", "id", created.skuUom], ["item_skus", "id", created.sku], ["items", "id", created.item],
        ["item_uoms", "id", created.uom], ["suppliers", "id", created.supplier], ["user_roles", "user_id", created.buyer],
        ["user_roles", "user_id", created.viewer], ["role_permissions", "role_id", created.mgmtRole], ["role_permissions", "role_id", created.viewRole],
        ["roles", "id", created.mgmtRole], ["roles", "id", created.viewRole], ["fr_token_versions", "subject", created.buyer && String(created.buyer)],
        ["fr_token_versions", "subject", created.viewer && String(created.viewer)], ["users", "id", created.buyer], ["users", "id", created.viewer]]) {
        if (id) await db.query(`DELETE FROM ${table} WHERE ${column} = ?`, [id]);
      }
    } finally { await application.shutdown("purchasing_po_api_integration_complete"); }
  });

  const actor = async (suffix, permission) => {
    const role = await insert("roles", { name: `po_api_${suffix}_${tag}`, created_at: now });
    await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
    const user = await insert("users", { username: `po_api_${suffix}_${tag}`, password_hash: "synthetic", display_name: `Buyer ${suffix}`,
      created_at: now, updated_at: now });
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user, role]);
    const version = await application.services.require("tokenRevocation").currentVersion(String(user));
    const token = await jwt.issue({ roles: [`po_api_${suffix}_${tag}`], permissions: [permission] },
      { subject: String(user), version, authTime: Math.floor(now / 1000) });
    return { role, user, token };
  };
  const mgmt = await actor("mgmt", "purchasing.mgmt");
  Object.assign(created, { mgmtRole: mgmt.role, buyer: mgmt.user });
  const view = await actor("view", "purchasing.view");
  Object.assign(created, { viewRole: view.role, viewer: view.user });
  created.supplier = await insert("suppliers", { supplier_code: `POA-${tag}`, supplier_code_key: `poa-${tag}`, supplier_name: "API Supplier",
    supplier_name_key: "api supplier", default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
  created.item = await insert("items", { name: `API ${tag}`, status: "active", created_at: now, updated_at: now });
  created.uom = await insert("item_uoms", { code: `A${tag}`, name: "Each", created_at: now, updated_at: now });
  created.sku = await insert("item_skus", { item_id: created.item, sku_code: `POA-${tag}`, sku_name: "API SKU", status: "active",
    created_at: now, updated_at: now });
  created.skuUom = await insert("item_sku_uoms", { sku_id: created.sku, uom_id: created.uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
  const { url } = await application.start();
  const today = application.services.require("time").fileDate();
  const body = (overrides = {}) => ({ eventId: randomUUID(), supplierId: created.supplier, currencyCode: "HKD", orderDate: today,
    buyerId: created.buyer, lines: [{ skuId: created.sku, purchaseSkuUomId: created.skuUom, orderedQuantity: "2", unitPrice: "1.25" }], ...overrides });
  return { db, url, body, created, token: mgmt.token, viewToken: view.token };
}

integrationTest("Create 經 HTTP 回 201；同 key 同內容 replay、同 key 唔同內容 409；key 同 eventId 唔一致或者帶 client total 被拒", async (t) => {
  const { db, url, body, created, token } = await setup(t), input = body(), create = `${url}/api/v1/purchase-orders/create`;

  const first = await request(create, { token, key: input.eventId, body: input });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.match(first.body.data.number, /^PO-\d{6}-\d{6}$/u);
  assert.deepEqual({ ...first.body.data, id: 0, number: "" }, { id: 0, number: "", status: "DRAFT", version: 1, warnings: [], replayed: false });
  const [[header]] = await db.query("SELECT po_number, created_by, total_amount, buyer_label FROM purchase_orders WHERE id = ?", [first.body.data.id]);
  assert.deepEqual({ ...header }, { po_number: first.body.data.number, created_by: created.buyer, total_amount: "2.5000", buyer_label: "Buyer mgmt" });

  const replay = await request(create, { token, key: input.eventId, body: input });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body.data, first.body.data);
  const changed = await request(create, { token, key: input.eventId, body: { ...input, notes: "changed" } });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, "IDEMPOTENCY_CONFLICT");

  const other = body();
  const mismatch = await request(create, { token, key: randomUUID(), body: other });
  assert.equal(mismatch.status, 400);
  assert.deepEqual(mismatch.body.error.details, { field: "eventId" });
  assert.equal(mismatch.body.error.code, "PURCHASING_INPUT_INVALID");
  const missing = await request(create, { token, body: other });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  const spoofed = body({ totalAmount: "0.01" });
  const total = await request(create, { token, key: spoofed.eventId, body: spoofed });
  assert.equal(total.status, 400);
  assert.equal(total.body.error.code, "PURCHASING_INPUT_INVALID");

  const [[{ count }]] = await db.query("SELECT COUNT(*) count FROM purchase_orders WHERE created_by = ?", [created.buyer]);
  assert.equal(Number(count), 1);
  const [operations] = await db.query("SELECT command_type FROM purchasing_operation_requests WHERE actor_user_id = ?", [created.buyer]);
  assert.deepEqual(operations.map((row) => row.command_type), ["CREATE_PURCHASE_ORDER"]);
});

integrationTest("Update 經 HTTP 回 200；舊 version 409 只回 currentVersion；冇 purchasing.mgmt 403、冇 token 401", async (t) => {
  const { db, url, body, created, token, viewToken } = await setup(t), input = body();
  const first = await request(`${url}/api/v1/purchase-orders/create`, { token, key: input.eventId, body: input });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const path = `${url}/api/v1/purchase-orders/${first.body.data.id}/update`;
  const [[line]] = await db.query("SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?", [first.body.data.id]);

  const edit = body({ version: 1, notes: "第二版", lines: [{ id: Number(line.id), skuId: created.sku, purchaseSkuUomId: created.skuUom,
    orderedQuantity: "4", unitPrice: "1.25" }] });
  const updated = await request(path, { token, key: edit.eventId, body: edit });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.deepEqual(updated.body.data, { ...first.body.data, version: 2 });
  const [[header]] = await db.query("SELECT version, notes, total_amount FROM purchase_orders WHERE id = ?", [first.body.data.id]);
  assert.deepEqual({ ...header }, { version: 2, notes: "第二版", total_amount: "5.0000" });

  const stale = { ...edit, eventId: randomUUID(), notes: "舊版本" };
  const conflict = await request(path, { token, key: stale.eventId, body: stale });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "VERSION_CONFLICT");
  assert.deepEqual(conflict.body.error.details, { currentVersion: 2 });

  const viewOnly = body({ version: 2 });
  const forbidden = await request(path, { token: viewToken, key: viewOnly.eventId, body: viewOnly });
  assert.equal(forbidden.status, 403);
  const anonymous = await request(path, { key: viewOnly.eventId, body: viewOnly });
  assert.equal(anonymous.status, 401);
  const viewerCreate = body();
  assert.equal((await request(`${url}/api/v1/purchase-orders/create`, { token: viewToken, key: viewerCreate.eventId, body: viewerCreate })).status, 403);

  const [[after]] = await db.query("SELECT version, notes FROM purchase_orders WHERE id = ?", [first.body.data.id]);
  assert.deepEqual({ ...after }, { version: 2, notes: "第二版" });
  const [[{ count }]] = await db.query("SELECT COUNT(*) count FROM purchase_orders WHERE created_by = ?", [created.viewer]);
  assert.equal(Number(count), 0);
});

integrationTest("List 同 Detail 經 HTTP：view 讀到過咗 response schema 嘅安全 projection；mgmt 冇 view 403、冇 token 401、唔存在 404", async (t) => {
  const { url, body, created, token, viewToken } = await setup(t), input = body({ supplierReference: `REF-${randomUUID()}` });
  const { body: { data: po } } = await request(`${url}/api/v1/purchase-orders/create`, { token, key: input.eventId, body: input });
  const get = (path, options) => request(`${url}/api/v1/purchase-orders${path}`, { method: "GET", ...options });

  const list = await get(`?supplierId=${created.supplier}&status=DRAFT&hasOutstanding=false&pageSize=5&q=${encodeURIComponent(input.supplierReference)}`, { token: viewToken });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual([list.body.data.total, list.body.data.page, list.body.data.pageSize, list.body.data.items[0].id], [1, 1, 5, po.id]);
  assert.deepEqual([list.body.data.items[0].totalAmount, list.body.data.items[0].allowedActions], ["2.5000", []]);

  const detail = await get(`/${po.id}`, { token: viewToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.deepEqual([detail.body.data.number, detail.body.data.lines[0].orderedBaseQuantity, detail.body.data.lines[0].lineAmount], [po.number, "2", "2.5000"]);
  assert.deepEqual(detail.body.data.currentMasterDifferences, { supplier: null, lines: [] });

  const bad = await get("?sortBy=password_hash", { token: viewToken });
  assert.deepEqual([bad.status, bad.body.error.code, bad.body.error.details], [400, "PURCHASING_INPUT_INVALID", { field: "sortBy" }]);
  const missing = await get(`/${Number.MAX_SAFE_INTEGER}`, { token: viewToken });
  assert.deepEqual([missing.status, missing.body.error.code], [404, "PURCHASE_ORDER_NOT_FOUND"]);
  assert.equal((await get(`/${po.id}`, { token })).status, 403, "六個權限互不繼承：mgmt 唔包 view");
  assert.equal((await get("", { token })).status, 403);
  assert.equal((await get(`/${po.id}`)).status, 401);
  assert.equal((await get("")).status, 401);
});

integrationTest("Copy 經 HTTP 回 201 同新編號；同 key replay；只有 view 403、冇 token 401、唔存在 404", async (t) => {
  const { db, url, body, token, viewToken } = await setup(t), input = body();
  const { body: { data: po } } = await request(`${url}/api/v1/purchase-orders/create`, { token, key: input.eventId, body: input });
  const path = `${url}/api/v1/purchase-orders/${po.id}/copy`, eventId = randomUUID(), payload = { eventId };

  const copy = await request(path, { token, key: eventId, body: payload });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.notEqual(copy.body.data.id, po.id);
  assert.notEqual(copy.body.data.number, po.number);
  assert.deepEqual([copy.body.data.status, copy.body.data.version, copy.body.data.warnings], ["DRAFT", 1, []]);
  const replay = await request(path, { token, key: eventId, body: payload });
  assert.deepEqual([replay.status, replay.body.data], [201, copy.body.data]);

  const extra = randomUUID();
  const refused = await request(path, { token, key: extra, body: { eventId: extra, supplierId: 1 } });
  assert.deepEqual([refused.status, refused.body.error.code], [400, "PURCHASING_INPUT_INVALID"]);
  const other = randomUUID();
  assert.equal((await request(path, { token: viewToken, key: other, body: { eventId: other } })).status, 403);
  assert.equal((await request(path, { key: other, body: { eventId: other } })).status, 401);
  const missing = await request(`${url}/api/v1/purchase-orders/${Number.MAX_SAFE_INTEGER}/copy`, { token, key: other, body: { eventId: other } });
  assert.deepEqual([missing.status, missing.body.error.code], [404, "PURCHASE_ORDER_NOT_FOUND"]);

  const [[{ count }]] = await db.query("SELECT COUNT(*) count FROM purchase_orders WHERE id IN (?)", [[po.id, copy.body.data.id]]);
  assert.equal(Number(count), 2);
});
