/**
 * TASK-023／TC-004：審批同設定經真 HTTP、真 JWT、真密碼、真裝置簽署同真 MySQL（§3.3、§5.2、§5.4、§8.3）。
 * HTTP 寫入一定 commit：user、角色同裝置完咗刪走；PO、主檔、history、operation 同 audit 留低，隨機 tag 唔會撞。設定完咗還原做關。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { createTestDevice } from "../../test-support/testDevice.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PASSWORD = "Correct-Horse-9!", SETTINGS_PATH = "/api/v1/purchasing-settings/update";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());

async function setup(t) {
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now(), passwordHash = await hashPassword(PASSWORD), people = [];
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  const device = await createTestDevice();
  const person = async (suffix, permissions, { did } = {}) => {
    const name = `po_apr_${suffix}_${tag}`, role = await insert("roles", { name, created_at: now });
    for (const permission of permissions) await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
    const id = await insert("users", { username: name, password_hash: passwordHash, display_name: `User ${suffix}`, created_at: now, updated_at: now });
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
    people.push({ id, role });
    const version = await application.services.require("tokenRevocation").currentVersion(String(id));
    const token = await jwt.issue({ roles: [name], permissions, ...(did ? { did } : {}) }, { subject: String(id), version, authTime: Math.floor(now / 1000) });
    return { id, token };
  };
  const maker = await person("maker", ["purchasing.view", "purchasing.mgmt", "purchasing.approval"]);
  const approver = await person("approver", ["purchasing.view", "purchasing.approval"]), other = await person("other", ["purchasing.view", "purchasing.approval", "purchasing.mgmt"]);
  const viewer = await person("viewer", ["purchasing.view"]), admin = await person("admin", ["purchasing.settings"], { did: device.deviceId });
  await db.query(`INSERT INTO user_devices (user_id, device_id, public_key, label, status, requested_at, requested_ip, requested_ua, reviewed_at) VALUES (?, ?, ?, '', 'approved', ?, '', '', ?)`,
    [admin.id, device.deviceId, device.publicKeyDer, now, now]);
  t.after(async () => {
    try {
      await db.query("UPDATE purchasing_settings SET require_po_approval = 0 WHERE id = 1");
      await db.query("DELETE FROM user_devices WHERE user_id = ?", [admin.id]);
      for (const { id, role } of people) {
        await db.query("DELETE FROM user_roles WHERE user_id = ?", [id]);
        await db.query("DELETE FROM role_permissions WHERE role_id = ?", [role]);
        await db.query("DELETE FROM roles WHERE id = ?", [role]);
        await db.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]);
        await db.query("DELETE FROM users WHERE id = ?", [id]);
      }
    } finally { await application.shutdown("purchasing_approval_integration_complete"); }
  });
  const supplier = await insert("suppliers", { supplier_code: `PAP-${tag}`, supplier_code_key: `pap-${tag}`, supplier_name: "Approval Supplier", supplier_name_key: "approval supplier", default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
  const item = await insert("items", { name: `Apr ${tag}`, status: "active", created_at: now, updated_at: now });
  const uom = await insert("item_uoms", { code: `P${tag}`, name: "Each", created_at: now, updated_at: now });
  const sku = await insert("item_skus", { item_id: item, sku_code: `PAP-${tag}`, sku_name: "Approval SKU", status: "active", created_at: now, updated_at: now });
  const skuUom = await insert("item_sku_uoms", { sku_id: sku, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
  const { url } = await application.start();
  const send = async (path, { token, body, method = "POST", key = body?.eventId, headers = {} }) => {
    const response = await fetch(`${url}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const command = (id, action, token, fields) => send(`/api/v1/purchase-orders/${id}/${action}`, { token, body: { eventId: randomUUID(), ...fields } });
  const draftFields = { supplierId: supplier, currencyCode: "HKD", orderDate: today, buyerId: maker.id, lines: [{ skuId: sku, purchaseSkuUomId: skuUom, orderedQuantity: "2", unitPrice: "1.25" }] };
  const draft = async () => {
    const eventId = randomUUID();
    const { status, body } = await send("/api/v1/purchase-orders/create", { token: maker.token, body: { eventId, ...draftFields } });
    assert.equal(status, 201, JSON.stringify(body));
    return body.data;
  };
  const setPolicy = (enabled) => db.query("UPDATE purchasing_settings SET require_po_approval = ? WHERE id = 1", [enabled ? 1 : 0]);
  const pending = async () => {
    const po = await draft();
    const submitted = await command(po.id, "submit", maker.token, { version: 1, assignedApproverId: approver.id, requestNote: "請批" });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    return submitted.body.data;
  };
  const history = async (id) => (await db.query("SELECT from_status, to_status, action, reason FROM purchase_order_status_history WHERE purchase_order_id = ? ORDER BY sequence_no", [id]))[0].map((row) => [row.from_status, row.to_status, row.action, row.reason]);
  const statusOf = async (id) => (await db.query("SELECT status, version FROM purchase_orders WHERE id = ?", [id]))[0][0];
  const approvals = async (id) => (await db.query("SELECT status, decision_reason, assigned_approver_id, requested_by, purchase_order_version FROM purchase_order_approvals WHERE purchase_order_id = ? ORDER BY id", [id]))[0];
  return { db, send, command, draft, draftFields, setPolicy, pending, history, statusOf, approvals, maker, approver, other, viewer, admin, device, supplier, url };
}
const failure = (result) => [result.status, result.body.error?.code];

integrationTest("審批關閉：建單同確認都寫 status history；帶審批人被拒", async (t) => {
  const f = await setup(t);
  await f.setPolicy(false);
  const po = await f.draft();
  assert.deepEqual(failure(await f.command(po.id, "submit", f.maker.token, { version: 1, assignedApproverId: f.approver.id })), [400, "PURCHASING_INPUT_INVALID"]);
  const done = await f.command(po.id, "submit", f.maker.token, { version: 1 });
  assert.deepEqual([done.status, done.body.data.status, done.body.data.outcome], [200, "CONFIRMED", "CONFIRMED"]);
  assert.deepEqual(await f.history(po.id), [["", "DRAFT", "CREATE", ""], ["DRAFT", "CONFIRMED", "CONFIRM", ""]]);
  assert.deepEqual(await f.approvals(po.id), []);
});

integrationTest("審批開啟：一定要指定另一名有權限嘅人；提交後 PO 凍結；批准直接 Confirmed", async (t) => {
  const f = await setup(t);
  await f.setPolicy(true);
  const po = await f.draft();
  const submit = (fields = {}) => f.command(po.id, "submit", f.maker.token, { version: 1, ...fields });
  assert.deepEqual(failure(await submit()), [409, "PO_APPROVAL_REQUIRED"]);
  assert.deepEqual(failure(await submit({ assignedApproverId: f.maker.id })), [409, "PO_APPROVER_INVALID"]);
  assert.deepEqual(failure(await submit({ assignedApproverId: f.viewer.id })), [409, "PO_APPROVER_INVALID"]);
  assert.equal((await f.statusOf(po.id)).status, "DRAFT");
  const submitted = await submit({ assignedApproverId: f.approver.id, requestNote: "請批" });
  assert.deepEqual([submitted.status, submitted.body.data.status, submitted.body.data.outcome, submitted.body.data.version], [200, "PENDING_APPROVAL", "PENDING_APPROVAL", 2]);
  const [approval] = await f.approvals(po.id);
  assert.deepEqual([approval.status, Number(approval.assigned_approver_id), Number(approval.requested_by), Number(approval.purchase_order_version)], ["PENDING", f.approver.id, f.maker.id, 2]);
  assert.deepEqual(failure(await f.command(po.id, "copy", f.viewer.token, {})), [403, "Forbidden"]);
  assert.deepEqual(failure(await f.command(po.id, "update", f.maker.token, { version: 2, ...f.draftFields })), [409, "PO_STATE_CONFLICT"]);

  const approve = (token, fields = {}) => f.command(po.id, "approval/approve", token, { version: 2, password: PASSWORD, ...fields });
  assert.equal((await f.send(`/api/v1/purchase-orders/${po.id}/approval/approve`, { token: f.approver.token, body: { eventId: randomUUID(), version: 2 } })).body.error.code, "PASSWORD_REQUIRED");
  assert.deepEqual((await approve(f.approver.token, { password: "wrong" })).status, 403);
  assert.deepEqual(failure(await approve(f.maker.token)), [403, "SELF_APPROVAL_DENIED"]);
  assert.deepEqual(failure(await approve(f.other.token)), [403, "APPROVAL_ASSIGNEE_MISMATCH"]);
  assert.deepEqual(failure(await approve(f.approver.token, { version: 1 })), [409, "VERSION_CONFLICT"]);
  assert.equal((await f.statusOf(po.id)).status, "PENDING_APPROVAL");

  const eventId = randomUUID(), payload = { eventId, version: 2, password: PASSWORD, reason: "價錢合理，批准" };
  const approved = await f.send(`/api/v1/purchase-orders/${po.id}/approval/approve`, { token: f.approver.token, body: payload });
  assert.deepEqual([approved.status, approved.body.data.status, approved.body.data.version, approved.body.data.replayed], [200, "CONFIRMED", 3, false]);
  const replay = await f.send(`/api/v1/purchase-orders/${po.id}/approval/approve`, { token: f.approver.token, body: payload });
  assert.deepEqual([replay.status, replay.body.data.status, replay.body.data.version], [200, "CONFIRMED", 3]);
  assert.deepEqual(failure(await approve(f.approver.token, { version: 3 })), [409, "PO_STATE_CONFLICT"]);
  assert.deepEqual(await f.history(po.id), [["", "DRAFT", "CREATE", ""], ["DRAFT", "PENDING_APPROVAL", "SUBMIT", ""], ["PENDING_APPROVAL", "CONFIRMED", "APPROVE", "價錢合理，批准"]]);
  assert.deepEqual((await f.approvals(po.id)).map((row) => [row.status, row.decision_reason]), [["APPROVED", "價錢合理，批准"]]);
  const [[row]] = await f.db.query("SELECT confirmed_by FROM purchase_orders WHERE id = ?", [po.id]);
  assert.equal(Number(row.confirmed_by), f.approver.id);
  const [audits] = await f.db.query("SELECT action FROM purchasing_audit_logs WHERE purchase_order_id = ? AND outcome = 'SUCCEEDED' ORDER BY id", [po.id]);
  assert.deepEqual(audits.map((audit) => audit.action), ["purchase_order.created", "purchase_order.submitted", "purchase_order.approved"]);
  const [[operation]] = await f.db.query("SELECT command_type, result_summary, completed_at FROM purchasing_operation_requests WHERE event_id = ?", [eventId]);
  assert.deepEqual([operation.command_type, operation.result_summary, operation.completed_at === null], ["APPROVE_PURCHASE_ORDER", { id: po.id, number: po.number, status: "CONFIRMED", version: 3 }, false]);
});

integrationTest("拒絕同撤回都回 Draft，舊申請用唔返；可以再提交新申請", async (t) => {
  const f = await setup(t);
  await f.setPolicy(true);
  const po = await f.pending();
  const reject = (fields) => f.command(po.id, "approval/reject", f.approver.token, { version: 2, password: PASSWORD, ...fields });
  assert.deepEqual(failure(await f.send(`/api/v1/purchase-orders/${po.id}/approval/reject`, { token: f.approver.token, body: { eventId: randomUUID(), version: 2, password: PASSWORD } })), [400, "PURCHASING_INPUT_INVALID"]);
  assert.deepEqual(failure(await reject({ reason: "短" })), [400, "PURCHASING_INPUT_INVALID"]);
  const rejected = await reject({ reason: "價錢要再傾" });
  assert.deepEqual([rejected.status, rejected.body.data.status, rejected.body.data.version], [200, "DRAFT", 3]);
  assert.deepEqual(failure(await f.command(po.id, "approval/approve", f.approver.token, { version: 3, password: PASSWORD })), [409, "PO_STATE_CONFLICT"]);

  const again = await f.command(po.id, "submit", f.maker.token, { version: 3, assignedApproverId: f.approver.id });
  assert.deepEqual([again.status, again.body.data.status, again.body.data.version], [200, "PENDING_APPROVAL", 4]);
  assert.deepEqual(failure(await f.command(po.id, "approval/withdraw", f.other.token, { version: 4 })), [403, "APPROVAL_ASSIGNEE_MISMATCH"]);
  const withdrawn = await f.command(po.id, "approval/withdraw", f.maker.token, { version: 4, reason: "要改交期先再提交" });
  assert.deepEqual([withdrawn.status, withdrawn.body.data.status, withdrawn.body.data.version], [200, "DRAFT", 5]);
  assert.deepEqual((await f.approvals(po.id)).map((row) => row.status), ["REJECTED", "WITHDRAWN"]);
  assert.deepEqual((await f.history(po.id)).map((row) => row[2]), ["CREATE", "SUBMIT", "REJECT", "SUBMIT", "WITHDRAW"]);
  const [audits] = await f.db.query("SELECT action FROM purchasing_audit_logs WHERE purchase_order_id = ? AND outcome = 'SUCCEEDED' ORDER BY id", [po.id]);
  assert.deepEqual(audits.map((audit) => audit.action), ["purchase_order.created", "purchase_order.submitted", "purchase_order.rejected", "purchase_order.submitted", "purchase_order.approval_withdrawn"]);
});

integrationTest("批准時主檔或人員失效：拒絕，申請保留 Pending，撤回之後改得返", async (t) => {
  const f = await setup(t);
  await f.setPolicy(true);
  const po = await f.pending();
  const approve = () => f.command(po.id, "approval/approve", f.approver.token, { version: 2, password: PASSWORD });
  await f.db.query("UPDATE suppliers SET status = 'suspended' WHERE id = ?", [f.supplier]);
  assert.deepEqual(failure(await approve()), [409, "SUPPLIER_NOT_PURCHASABLE"]);
  assert.deepEqual([(await f.statusOf(po.id)).status, (await f.approvals(po.id))[0].status], ["PENDING_APPROVAL", "PENDING"]);
  await f.db.query("UPDATE suppliers SET status = 'active' WHERE id = ?", [f.supplier]);
  await f.db.query("UPDATE users SET status = 'inactive' WHERE id = ?", [f.maker.id]);
  assert.deepEqual(failure(await approve()), [409, "PO_APPROVER_INVALID"]);
  await f.db.query("UPDATE users SET status = 'active' WHERE id = ?", [f.maker.id]);
  assert.equal((await f.command(po.id, "approval/withdraw", f.maker.token, { version: 2 })).body.data.status, "DRAFT");
});

integrationTest("批准同撤回同時發生：只有一個成功，結果一致", async (t) => {
  const f = await setup(t);
  await f.setPolicy(true);
  const po = await f.pending();
  const [approved, withdrawn] = await Promise.all([f.command(po.id, "approval/approve", f.approver.token, { version: 2, password: PASSWORD }), f.command(po.id, "approval/withdraw", f.maker.token, { version: 2 })]);
  const winners = [approved, withdrawn].filter((result) => result.status === 200);
  assert.equal(winners.length, 1, JSON.stringify([approved.body, withdrawn.body]));
  const expected = winners[0] === approved ? ["CONFIRMED", "APPROVED"] : ["DRAFT", "WITHDRAWN"];
  assert.deepEqual([(await f.statusOf(po.id)).status, (await f.approvals(po.id))[0].status], expected);
  assert.equal((await f.history(po.id)).length, 3);
});

integrationTest("設定：讀要 settings 權限；改要裝置簽署同密碼；只影響之後嘅提交", async (t) => {
  const f = await setup(t);
  await f.setPolicy(false);
  assert.equal((await f.send("/api/v1/purchasing-settings", { method: "GET", token: f.maker.token })).status, 403);
  const current = await f.send("/api/v1/purchasing-settings", { method: "GET", token: f.admin.token });
  assert.equal(current.status, 200, JSON.stringify(current.body));
  assert.equal(current.body.data.requirePoApproval, false);
  const pendingBefore = await f.draft();
  await f.setPolicy(true);
  const { version } = await (async () => { const { body } = await f.send("/api/v1/purchasing-settings", { method: "GET", token: f.admin.token }); return body.data; })();
  await f.setPolicy(false);

  const payload = (fields = {}) => ({ eventId: randomUUID(), version, requirePoApproval: true, reason: "開始需要審批", password: PASSWORD, ...fields });
  const signed = async (body) => {
    const text = JSON.stringify(body), headers = await f.device.headers({ method: "POST", path: SETTINGS_PATH, body: text, token: f.admin.token });
    const response = await fetch(`${f.url}${SETTINGS_PATH}`, { method: "POST", headers: { ...headers, Authorization: `Bearer ${f.admin.token}`, "Idempotency-Key": body.eventId, "Content-Type": "application/json" }, body: text });
    return { status: response.status, body: await response.json() };
  };
  const unsigned = payload();
  assert.notEqual((await f.send(SETTINGS_PATH, { token: f.admin.token, body: unsigned })).status, 200);
  assert.equal((await signed(payload({ password: "wrong" }))).status, 403);
  assert.deepEqual(failure(await signed(payload({ version: version + 5 }))), [409, "VERSION_CONFLICT"]);
  const good = payload(), updated = await signed(good);
  assert.deepEqual([updated.status, updated.body.data], [200, { requirePoApproval: true, version: version + 1, replayed: false }]);
  assert.equal((await signed(good)).status, 200);
  assert.deepEqual([(await f.statusOf(pendingBefore.id)).status], ["DRAFT"], "改設定唔掃描亦唔改現有 PO");
  assert.deepEqual(failure(await f.command(pendingBefore.id, "submit", f.maker.token, { version: 1 })), [409, "PO_APPROVAL_REQUIRED"]);
});
