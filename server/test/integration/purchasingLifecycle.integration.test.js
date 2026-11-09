/**
 * TASK-025／TC-004：PO lifecycle 經真 HTTP、真 JWT 同真 MySQL（§3.2、§5.2、§8.4）。Sam 2026-11-09 批准 C4：I1～I4 嘅「而家」版本。
 * GR 表未落地，撤回同取消喺 production 一律 fail closed（503，乜都唔寫）；成功路徑等 TASK-045 同 reader 接好先驗。
 * Fixture：Draft 經 HTTP create（setup），狀態同收貨量用 SQL 設定（gross = net + reversed）；user、角色完咗刪走，PO 同主檔留低，隨機 tag 唔會撞。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());
const REASON = "生命週期測試原因";

async function setup(t) {
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now(), people = [];
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  const person = async (suffix, permissions) => {
    const name = `po_life_${suffix}_${tag}`, role = await insert("roles", { name, created_at: now });
    for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
    const id = await insert("users", { username: name, password_hash: "synthetic", display_name: `User ${suffix}`, created_at: now, updated_at: now });
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
    people.push({ id, role });
    const version = await application.services.require("tokenRevocation").currentVersion(String(id));
    return { id, token: await jwt.issue({ roles: [name], permissions }, { subject: String(id), version, authTime: Math.floor(now / 1000) }) };
  };
  const maker = await person("maker", ["purchasing.view", "purchasing.mgmt"]), viewer = await person("viewer", ["purchasing.view"]);
  const approver = await person("approver", ["purchasing.view", "purchasing.approval"]);
  t.after(async () => {
    try {
      await db.query("UPDATE purchasing_settings SET require_po_approval = 0 WHERE id = 1");
      for (const { id, role } of people) {
        await db.query("DELETE FROM user_roles WHERE user_id = ?", [id]);
        await db.query("DELETE FROM role_permissions WHERE role_id = ?", [role]);
        await db.query("DELETE FROM roles WHERE id = ?", [role]);
        await db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]);
        await db.query("DELETE FROM users WHERE id = ?", [id]);
      }
    } finally { await application.shutdown("purchasing_lifecycle_integration_complete"); }
  });
  const supplier = await insert("suppliers", { supplier_code: `PLC-${tag}`, supplier_code_key: `plc-${tag}`, supplier_name: "Lifecycle Supplier", supplier_name_key: "lifecycle supplier",
    default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
  const item = await insert("items", { name: `Life ${tag}`, status: "active", created_at: now, updated_at: now });
  const uom = await insert("item_uoms", { code: `L${tag}`, name: "Each", created_at: now, updated_at: now });
  const sku = await insert("item_skus", { item_id: item, sku_code: `PLC-${tag}`, sku_name: "Lifecycle SKU", status: "active", created_at: now, updated_at: now });
  const skuUom = await insert("item_sku_uoms", { sku_id: sku, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
  const { url } = await application.start();
  const send = async (path, { token, body, method = "POST", key = body?.eventId }) => {
    const response = await fetch(`${url}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const command = (id, action, token, fields, eventId = randomUUID()) => send(`/api/v1/purchase-orders/${id}/${action}`, { token, body: { eventId, ...fields } });
  const read = async (id, token = maker.token) => (await send(`/api/v1/purchase-orders/${id}`, { token, method: "GET" })).body.data;
  /** Setup：經 HTTP 建 Draft（唔計入 lifecycle request 數），每行訂 2（factor 1，Base 2）。 */
  const draft = async (lineCount) => {
    const lines = Array.from({ length: lineCount }, () => ({ skuId: sku, purchaseSkuUomId: skuUom, orderedQuantity: "2", unitPrice: "1.25" }));
    const { status, body } = await send("/api/v1/purchase-orders/create", { token: maker.token, body: { eventId: randomUUID(), supplierId: supplier, currencyCode: "HKD", orderDate: today, buyerId: maker.id, lines } });
    assert.equal(status, 201, JSON.stringify(body));
    return body.data;
  };
  /** Setup：用 SQL 設狀態同每行收貨量；received 係每行 net（reversed 0，所以 gross = net）。 */
  const placeAt = async (id, status, received = []) => {
    const [lines] = await db.query("SELECT id FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number", [id]);
    for (const [index, net] of received.entries()) {
      await db.query("UPDATE purchase_order_lines SET gross_received_base_quantity = ?, net_received_base_quantity = ?, has_outstanding = ? WHERE id = ?", [net, net, net >= 2 ? 0 : 1, lines[index].id]);
    }
    await db.query("UPDATE purchase_orders SET status = ?, version = 2, confirmed_at = ?, has_confirmed_receipt = ? WHERE id = ?", [status, now, received.some((net) => net > 0) ? 1 : 0, id]);
    return lines.map((row) => Number(row.id));
  };
  const historyCount = async (id) => Number((await db.query("SELECT COUNT(*) AS total FROM purchase_order_status_history WHERE purchase_order_id = ?", [id]))[0][0].total);
  const succeeded = async (id, action) => Number((await db.query("SELECT COUNT(*) AS total FROM purchasing_audit_logs WHERE purchase_order_id = ? AND action = ? AND outcome = 'SUCCEEDED'", [id, action]))[0][0].total);
  return { db, send, command, read, draft, placeAt, historyCount, succeeded, maker, viewer, approver };
}
const failure = (result) => [result.status, result.body.error?.code];

integrationTest("TASK-025 I1 撤回確認：未有權威 GR 事實就 503，乜都唔寫，亦唔宣告呢個動作", async (t) => {
  const f = await setup(t);
  const po = await f.draft(1);
  await f.placeAt(po.id, "CONFIRMED");
  const before = await f.historyCount(po.id);
  assert.deepEqual(failure(await f.command(po.id, "confirmation/withdraw", f.maker.token, { version: 2, reason: REASON })), [503, "PURCHASING_DEPENDENCY_UNAVAILABLE"]);
  const detail = await f.read(po.id);
  assert.deepEqual([detail.status, detail.version, detail.allowedActions], ["CONFIRMED", 2, ["copy"]]);
  assert.equal(await f.historyCount(po.id), before);
  assert.equal(await f.succeeded(po.id, "purchase_order.confirmation_withdrawn"), 0);
});

integrationTest("TASK-025 I2 取消 DRAFT／PENDING／CONFIRMED：一律 503，待審批申請仍然 PENDING", async (t) => {
  const f = await setup(t);
  const draftPo = await f.draft(1), pendingPo = await f.draft(1), confirmedPo = await f.draft(1);
  await f.db.query("UPDATE purchasing_settings SET require_po_approval = 1 WHERE id = 1");
  const submitted = await f.command(pendingPo.id, "submit", f.maker.token, { version: 1, assignedApproverId: f.approver.id });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  await f.placeAt(confirmedPo.id, "CONFIRMED");
  for (const [po, version] of [[draftPo, 1], [pendingPo, 2], [confirmedPo, 2]]) {
    assert.deepEqual(failure(await f.command(po.id, "cancel", f.maker.token, { version, reason: REASON })), [503, "PURCHASING_DEPENDENCY_UNAVAILABLE"]);
  }
  const pending = await f.read(pendingPo.id);
  assert.deepEqual([pending.status, pending.approval?.status, pending.allowedActions.includes("cancel")], ["PENDING_APPROVAL", "PENDING", false]);
  const [[approval]] = await f.db.query("SELECT status FROM purchase_order_approvals WHERE purchase_order_id = ?", [pendingPo.id]);
  assert.equal(approval.status, "PENDING");
  for (const po of [draftPo, pendingPo, confirmedPo]) assert.equal(await f.succeeded(po.id, "purchase_order.cancelled"), 0);
});

integrationTest("TASK-025 I3 Close Remaining：揀行同全部、錯誤、權限、原因；冇 Inventory 效果，只有轉 CLOSED 先寫 history", async (t) => {
  const f = await setup(t);
  const po = await f.draft(3);
  const [line1, line2, line3] = await f.placeAt(po.id, "PARTIALLY_RECEIVED", [2, 1, 0]);
  const [[{ total: movementsBefore }]] = await f.db.query("SELECT COUNT(*) AS total FROM inventory_movements");
  const historyBefore = await f.historyCount(po.id);
  assert.deepEqual((await f.read(po.id)).allowedActions, ["copy", "closeRemaining"]);
  const close = (fields, token = f.maker.token) => f.command(po.id, "close-remaining", token, fields);

  const selected = await close({ version: 2, reason: REASON, lineIds: [line2] });
  assert.deepEqual([selected.status, selected.body.data.status, selected.body.data.version], [200, "PARTIALLY_RECEIVED", 3]);
  assert.deepEqual(failure(await close({ version: 3, reason: REASON, lineIds: [line1] })), [409, "PO_STATE_CONFLICT"]);
  assert.deepEqual(failure(await close({ version: 3, reason: REASON, lineIds: [Number.MAX_SAFE_INTEGER] })), [404, "PURCHASE_ORDER_NOT_FOUND"]);
  assert.equal((await close({ version: 3, reason: REASON }, f.viewer.token)).status, 403);
  assert.deepEqual(failure(await close({ version: 3 })), [400, "PURCHASING_INPUT_INVALID"]);
  const all = await close({ version: 3, reason: REASON });
  assert.deepEqual([all.status, all.body.data.status, all.body.data.version], [200, "CLOSED", 4]);

  const [lines] = await f.db.query("SELECT id, closed_remaining_base_quantity, has_outstanding, close_reason FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number", [po.id]);
  assert.deepEqual(lines.map((row) => [Number(row.id), String(row.closed_remaining_base_quantity), Number(row.has_outstanding)]), [[line1, "0", 0], [line2, "1", 0], [line3, "2", 0]]);
  const [[{ total: movementsAfter }]] = await f.db.query("SELECT COUNT(*) AS total FROM inventory_movements");
  assert.equal(Number(movementsAfter), Number(movementsBefore));
  const [history] = await f.db.query("SELECT from_status, to_status, action FROM purchase_order_status_history WHERE purchase_order_id = ? ORDER BY sequence_no", [po.id]);
  assert.equal(history.length, historyBefore + 1);
  assert.deepEqual(history.at(-1), { from_status: "PARTIALLY_RECEIVED", to_status: "CLOSED", action: "CLOSE" });
  assert.equal(await f.succeeded(po.id, "purchase_order.remaining_closed"), 2);
});

integrationTest("TASK-025 I4 Close Remaining 同一 key 同內容再送：回原本嘅 response，唔再關多次", async (t) => {
  const f = await setup(t);
  const po = await f.draft(2);
  await f.placeAt(po.id, "PARTIALLY_RECEIVED", [1, 0]);
  const eventId = randomUUID(), body = { version: 2, reason: REASON };
  const first = await f.command(po.id, "close-remaining", f.maker.token, body, eventId);
  const second = await f.command(po.id, "close-remaining", f.maker.token, body, eventId);
  assert.deepEqual([first.status, first.body.data.status, first.body.data.version], [200, "CLOSED", 3]);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.data, first.body.data);
  assert.equal(await f.succeeded(po.id, "purchase_order.remaining_closed"), 1);
});
