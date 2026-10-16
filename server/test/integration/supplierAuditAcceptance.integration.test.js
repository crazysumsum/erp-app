import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stringify } from "csv-stringify/sync";

import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierAuditLogService } from "../../src/modules/supplier/SupplierAuditLogService.js";
import { MISSING, createSupplierHarness } from "./supplierHttpHarness.js";

/**
 * TASK-051 step 2b：Supplier audit（AUD-001、AUD-004～008）同詳情（LIST-007），真 app、真 HTTP、真 MySQL。
 * Action 名用實作嘅（HD-111 A：接受同設計 §8.9 嘅命名偏離，對照表喺 TC map 嘅 TC-103 Notes）。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = Object.assign(createSupplierHarness("aud51"), { users: {} });
const REASON = "T51 audit acceptance";
const LOOPBACK = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/u;

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  await h.start();
  h.users.mgmt = await h.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
  h.users.view = await h.makeUser("view", ["supplier.view"]);
  h.users.approver = await h.makeUser("apr", ["supplier.view", "supplier.approval"]);
  h.users.approver2 = await h.makeUser("apr2", ["supplier.view", "supplier.approval"]);
  h.users.bank = await h.makeUser("bank", ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]);
  h.users.settings = await h.makeUser("set", ["supplier.settings"]);
  await setApproval(false);
});

after(() => h.stop());

const tag = () => randomUUID().slice(0, 8).toUpperCase();

async function setApproval(on) {
  const current = (await h.send(h.users.settings, h.route("GET /api/v1/supplier-settings"))).json.data;
  if (current.requireActivationApproval === on) return null;
  return h.send(h.users.settings, h.route("POST /api/v1/supplier-settings/update"),
    { body: { requireActivationApproval: on, version: current.version, reason: `${REASON} ${on ? "on" : "off"}` } });
}

async function create(body, user = h.users.mgmt) {
  const response = await h.send(user, h.route("POST /api/v1/suppliers/create"), { body: { defaultCurrencyCode: "HKD", ...body } });
  if (response.status === 201) h.supplierIds.push(response.json.data.id);
  return response;
}

async function auditsFor(requestId) {
  const [rows] = await h.db.query("SELECT * FROM supplier_audit_logs WHERE request_id = ? ORDER BY id", [requestId]);
  return rows;
}

async function purchasableSku() {
  const code = `AUDSKU-${tag()}`;
  const now = Date.now();
  const [item] = await h.db.execute("INSERT INTO items (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)", [code, now, now]);
  h.cleanup.push(["DELETE FROM items WHERE id = ?", [item.insertId]]);
  const [sku] = await h.db.execute(
    "INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
    [item.insertId, code, code, now, now]);
  h.cleanup.push(["DELETE FROM item_skus WHERE id = ?", [sku.insertId]]);
  const [uom] = await h.db.execute("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, 'Each', ?, ?)", [code, now, now]);
  h.cleanup.push(["DELETE FROM item_uoms WHERE id = ?", [uom.insertId]]);
  const [mapping] = await h.db.execute(
    "INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)",
    [sku.insertId, uom.insertId, now, now]);
  h.cleanup.push(["DELETE FROM item_sku_uoms WHERE id = ?", [mapping.insertId]]);
  return { skuId: Number(sku.insertId), uomId: Number(mapping.insertId) };
}

async function uploadImport(user, code) {
  const content = stringify([SUPPLIER_IMPORT_COLUMN_NAMES,
    SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({ supplierCode: code, supplierName: `Imported ${code}`, defaultCurrencyCode: "HKD" })[name] ?? "")],
  SUPPLIER_CSV_STRINGIFY_OPTIONS);
  const form = new FormData();
  form.append("mode", "create_only");
  form.append("file", new Blob([content], { type: "text/csv" }), `${code}.csv`);
  const response = await fetch(`${h.url}/api/v1/supplier-imports/upload`, { method: "POST", body: form,
    headers: { authorization: `Bearer ${user.token}`, "idempotency-key": randomUUID() } });
  const json = await response.json();
  assert.equal(response.status, 201, JSON.stringify(json));
  h.jobIds.push(json.data.id);
  return json;
}

integrationTest("TC-103 (AUD-001): every state-changing or sensitive Supplier action writes exactly its audit rows, with actor, target, reason, requestId and IP", async () => {
  const t = tag();
  const steps = [];
  const started = Date.now();
  // 每一步：發請求、要 2xx，再按 response 嘅 requestId 搵 audit 行；預期 action 係嗰個請求應該寫嘅全部 action。
  const step = async (name, user, run, expected, { reason = null, supplierId = undefined } = {}) => {
    const response = await run();
    assert.ok(response.status >= 200 && response.status < 300, `${name}: ${response.status} ${response.text ?? JSON.stringify(response.json)}`);
    const requestId = response.json?.meta?.requestId ?? response.headers?.get?.("x-request-id");
    assert.ok(requestId, `${name}: response carries a requestId`);
    const rows = await auditsFor(requestId);
    steps.push({ name, actions: rows.map((row) => row.action) });
    assert.deepEqual(rows.map((row) => row.action).sort(), [...expected].sort(), `${name}: audit actions`);
    for (const row of rows) {
      assert.equal(Number(row.actor_user_id), user.userId, `${name}: actor id`);
      assert.equal(row.actor_username, user.username, `${name}: actor username snapshot`);
      assert.match(row.ip, LOOPBACK, `${name}: ip`);
      assert.ok(Number(row.occurred_at) >= started && Number(row.occurred_at) <= Date.now(), `${name}: occurred_at`);
      assert.ok(row.target_type && row.target_label !== null, `${name}: target`);
      if (supplierId !== undefined) assert.equal(row.supplier_id === null ? null : Number(row.supplier_id), supplierId, `${name}: supplier_id`);
      if (reason !== null && !row.action.startsWith("approval.invalidate")) assert.equal(row.reason, reason, `${name}: reason`);
    }
    return response;
  };
  const mgmt = h.users.mgmt;
  const send = (user, key, options) => h.send(user, h.route(key), options);

  // Supplier root 同 child。
  const made = await step("create", mgmt, () => create({ supplierCode: `AUD-${t}`, supplierName: `Audit ${t}` }), ["supplier.create"]);
  const id = made.json.data.id;
  let version = made.json.data.version;
  const updated = await step("update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/update", { ids: { id }, body: { version, supplierName: `Audit ${t} v2`,
    displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, website: "", generalPhone: "", generalEmail: "", notes: "" } }), ["supplier.update"], { supplierId: id });
  const [[updateRow]] = await h.db.query("SELECT CAST(detail AS CHAR) AS detail FROM supplier_audit_logs WHERE request_id = ?", [updated.json.meta.requestId]);
  const updateDetail = JSON.parse(updateRow.detail);
  assert.deepEqual([updateDetail.before.supplierName, updateDetail.after.supplierName], [`Audit ${t}`, `Audit ${t} v2`], "before and after are recorded");
  version = updated.json.data.version;
  const recoded = await step("code change", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/code/change", { ids: { id },
    body: { supplierCode: `AUD2-${t}`, reason: REASON, version } }), ["supplier.code.change"], { reason: REASON, supplierId: id });
  version = recoded.json.data.version;
  const child = async (kind, body, label) => {
    const createdChild = await step(`${kind} create`, mgmt, () => send(mgmt, `POST /api/v1/suppliers/:supplierId/${{ address: "addresses", contact: "contacts", identifier: "identifiers" }[kind]}/create`, { ids: { supplierId: id }, body }),
      [`supplier.${kind}.create`], { supplierId: id });
    return { id: createdChild.json.data.id, version: createdChild.json.data.version, label };
  };
  const address = await child("address", { label: "HQ", purposes: [] });
  const addressUpdated = await step("address update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/addresses/:addressId/update",
    { ids: { supplierId: id, addressId: address.id }, body: { version: address.version, label: "HQ2", purposes: [] } }), ["supplier.address.update"], { supplierId: id });
  await step("address deactivate", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/addresses/:addressId/deactivate",
    { ids: { supplierId: id, addressId: address.id }, body: { version: addressUpdated.json.data.version } }), ["supplier.address.deactivate"], { supplierId: id });
  const contact = await child("contact", { name: "Amy", purposes: [] });
  const contactUpdated = await step("contact update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/contacts/:contactId/update",
    { ids: { supplierId: id, contactId: contact.id }, body: { version: contact.version, name: "Amy Two", purposes: [] } }), ["supplier.contact.update"], { supplierId: id });
  await step("contact deactivate", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/contacts/:contactId/deactivate",
    { ids: { supplierId: id, contactId: contact.id }, body: { version: contactUpdated.json.data.version } }), ["supplier.contact.deactivate"], { supplierId: id });
  const identifier = await child("identifier", { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `AU${t}` });
  const identifierUpdated = await step("identifier update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/update",
    { ids: { supplierId: id, identifierId: identifier.id }, body: { version: identifier.version, identifierType: "business_registration",
      issuerCountryCode: "HK", identifierValue: `AV${t}`, reason: REASON } }), ["supplier.identifier.update"], { reason: REASON, supplierId: id });
  await step("identifier delete", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/delete",
    { ids: { supplierId: id, identifierId: identifier.id }, body: { version: identifierUpdated.json.data.version, reason: REASON } }),
  ["supplier.identifier.delete"], { reason: REASON, supplierId: id });

  // Bank（device＋password），連 reveal 呢個敏感讀取。
  const bank = h.users.bank;
  const account = `63${String(Date.now()).slice(-10)}`;
  const bankA = await step("bank create", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/create", { ids: { id },
    body: { accountHolderName: "Holder A", bankName: "Bank A", accountNumber: account, isDefault: true, reason: REASON } }), ["supplier.bank.create"], { reason: REASON, supplierId: id });
  const bankB = await step("bank create 2", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/create", { ids: { id },
    body: { accountHolderName: "Holder B", bankName: "Bank B", accountNumber: `${account.slice(0, -1)}7`, reason: REASON } }), ["supplier.bank.create"], { reason: REASON, supplierId: id });
  const bankAUpdated = await step("bank update", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/update",
    { ids: { id, bankAccountId: bankA.json.data.id }, body: { accountHolderName: "Holder A2", bankName: "Bank A", version: bankA.json.data.version, reason: REASON } }),
  ["supplier.bank.update"], { reason: REASON, supplierId: id });
  await step("bank default", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/default",
    { ids: { id, bankAccountId: bankB.json.data.id }, body: { version: bankB.json.data.version, reason: REASON } }), ["supplier.bank.default"], { reason: REASON, supplierId: id });
  const [[bankAVersion]] = await h.db.query("SELECT version FROM supplier_bank_accounts WHERE id = ?", [bankAUpdated.json.data.id]);
  await step("bank deactivate", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/deactivate",
    { ids: { id, bankAccountId: bankA.json.data.id }, body: { version: Number(bankAVersion.version), reason: REASON } }), ["supplier.bank.deactivate"], { reason: REASON, supplierId: id });
  await step("bank reveal", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal",
    { ids: { id, bankAccountId: bankB.json.data.id }, body: { reason: REASON } }), ["supplier.bank.reveal"], { reason: REASON, supplierId: id });

  // SKU relation。
  const { skuId, uomId } = await purchasableSku();
  const relation = await step("relation create", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/sku-relations/create",
    { ids: { id }, body: { skuId, purchaseSkuUomId: uomId } }), ["supplier_sku.create"], { supplierId: id });
  await step("relation update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/sku-relations/:relationId/update",
    { ids: { id, relationId: relation.json.data.id }, body: { supplierItemCode: `SI-${t}`, supplierItemName: "Item", purchaseSkuUomId: uomId,
      minimumOrderQty: 5, standardLeadTimeDays: 7, relationshipStatus: "preferred", version: relation.json.data.version } }), ["supplier_sku.update"], { supplierId: id });

  // 狀態機（審批關閉）。
  const life = async (action, user, expected, body) => {
    const response = await step(action, user, () => send(user, `POST /api/v1/suppliers/:id/${action}`, { ids: { id }, body: { version, ...body } }),
      expected, { reason: body?.reason ?? null, supplierId: id });
    version = response.json.data.version;
  };
  await life("activate", mgmt, ["supplier.activate"]);
  await life("suspend", mgmt, ["supplier.suspend"], { reason: REASON });
  await life("reactivate", mgmt, ["supplier.reactivate"], { reason: REASON });
  await life("block", h.users.approver, ["supplier.block"], { reason: REASON });
  await life("unblock", h.users.approver, ["supplier.unblock"], { reason: REASON });
  await life("archive", mgmt, ["supplier.archive"], { reason: REASON });
  await life("restore", mgmt, ["supplier.restore"], { reason: REASON });
  const doomed = await create({ supplierCode: `DEL-${t}`, supplierName: `Delete ${t}` });
  await step("delete", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/delete", { ids: { id: doomed.json.data.id }, body: { version: 1, reason: REASON } }),
    ["supplier.delete"], { reason: REASON, supplierId: doomed.json.data.id });

  // 匯出、匯入（precheck 係背景工作，冇 request；由 worker 直接跑）。
  await step("export", mgmt, () => send(mgmt, "POST /api/v1/supplier-exports", { body: { filters: { q: `AUD2-${t}` } } }), ["supplier.export"]);
  const uploaded = await uploadImport(mgmt, `IMP-${t}`);
  steps.push({ name: "import upload", actions: (await auditsFor(uploaded.meta.requestId)).map((row) => row.action) });
  assert.deepEqual((await auditsFor(uploaded.meta.requestId)).map((row) => row.action), ["import.upload"]);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await h.worker.runPrecheck(new AbortController().signal);
    if (!result.claimed || result.jobId === uploaded.data.id) break;
  }
  const [precheckRows] = await h.db.query("SELECT action FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.precheck'",
    [uploaded.data.id]);
  assert.equal(precheckRows.length, 1, "the background precheck writes one audit row");
  const job = (await send(mgmt, "GET /api/v1/supplier-imports/:id", { ids: { id: uploaded.data.id } })).json.data.job;
  assert.equal(job.status, "ready", "prechecked and ready to confirm");
  await step("import confirm", mgmt, () => send(mgmt, "POST /api/v1/supplier-imports/:id/confirm", { ids: { id: uploaded.data.id },
    body: { version: job.version, activationMode: "draft", approverUserId: null } }), ["import.confirm"]);
  const cancelled = await uploadImport(mgmt, `IMC-${t}`);
  await step("import cancel", mgmt, () => send(mgmt, "POST /api/v1/supplier-imports/:id/cancel", { ids: { id: cancelled.data.id },
    body: { version: cancelled.data.version } }), ["import.cancel"]);

  // 設定同審批流程。
  try {
    const on = await setApproval(true);
    await step("settings update", h.users.settings, async () => on, ["setting.update"], { reason: `${REASON} on` });
    const pending = async (label) => {
      const response = await step(`${label} submit`, mgmt, () => create({ supplierCode: `${label}-${t}`, supplierName: `${label} ${t}`, activate: true,
        approverUserId: h.users.approver.userId }), ["supplier.create", "approval.submit"]);
      const queue = await h.send(h.users.approver, { ...h.route("GET /api/v1/supplier-approvals"), path: "/api/v1/supplier-approvals?scope=all&pageSize=100" });
      return { supplier: response.json.data, request: queue.json.data.items.find((item) => item.supplierId === response.json.data.id) };
    };
    const approved = await pending("APV");
    await step("approve", h.users.approver, () => send(h.users.approver, "POST /api/v1/supplier-approvals/:id/approve",
      { ids: { id: approved.request.id }, body: { version: approved.request.version } }), ["approval.approve"]);
    const rejected = await pending("REJ");
    await step("reject", h.users.approver, () => send(h.users.approver, "POST /api/v1/supplier-approvals/:id/reject",
      { ids: { id: rejected.request.id }, body: { version: rejected.request.version, reason: REASON } }), ["approval.reject"], { reason: REASON });
    const reassigned = await pending("RAS");
    await step("reassign", h.users.approver, () => send(h.users.approver, "POST /api/v1/supplier-approvals/:id/reassign",
      { ids: { id: reassigned.request.id }, body: { version: reassigned.request.version, approverUserId: h.users.approver2.userId, reason: REASON } }),
    ["approval.reassign"], { reason: REASON });
    const withdrawn = await pending("WDR");
    await step("withdraw", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/approval/withdraw", { ids: { id: withdrawn.supplier.id },
      body: { requestId: withdrawn.request.id, version: withdrawn.request.version } }), ["approval.withdraw"]);
    const invalidated = await pending("INV");
    await step("update while pending", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/update", { ids: { id: invalidated.supplier.id },
      body: { version: invalidated.supplier.version, supplierName: `INV ${t} renamed`, displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null,
        website: "", generalPhone: "", generalEmail: "", notes: "" } }), ["supplier.update", "approval.invalidate"]);
  } finally {
    await setApproval(false);
  }

  // 冇 audit 行帶 Bank 明文。
  const [leaks] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ? AND CAST(detail AS CHAR) LIKE ?", [id, `%${account}%`]);
  assert.equal(Number(leaks[0].n), 0);
  const covered = new Set(steps.flatMap((s) => s.actions));
  covered.add("import.precheck");
  const implemented = ["supplier.create", "supplier.update", "supplier.code.change", "supplier.activate", "supplier.suspend", "supplier.reactivate",
    "supplier.block", "supplier.unblock", "supplier.archive", "supplier.restore", "supplier.delete", "supplier.address.create", "supplier.address.update",
    "supplier.address.deactivate", "supplier.contact.create", "supplier.contact.update", "supplier.contact.deactivate", "supplier.identifier.create",
    "supplier.identifier.update", "supplier.identifier.delete", "supplier.bank.create", "supplier.bank.update", "supplier.bank.default",
    "supplier.bank.deactivate", "supplier.bank.reveal", "approval.submit", "approval.approve", "approval.reject", "approval.withdraw",
    "approval.reassign", "approval.invalidate", "setting.update", "supplier_sku.create", "supplier_sku.update", "import.upload", "import.precheck",
    "import.confirm", "import.cancel", "supplier.export"];
  assert.deepEqual(implemented.filter((action) => !covered.has(action)), [], "every action was exercised");
});

integrationTest("TC-106 (AUD-004): detail up to 8192 bytes is stored whole, a larger list is summarised to count/sample/truncated, and anything still too large fails the whole transaction with an alert", async () => {
  const alerts = [];
  const logger = { info() {}, warn() {}, error: (event, message, context) => alerts.push({ event, context }) };
  const audit = new SupplierAuditLogService({ database: h.db, logger, time: { nowMs: () => Date.now() } });
  const t = tag();
  const supplierId = await h.seedSupplier(`AUDSZ-${t}`, `Audit Size ${t}`);
  const write = (detail, label) => h.db.withTransaction((connection) => audit.record(connection, {
    actorUserId: null, actorUsername: "aud51", action: "supplier.update", targetType: "supplier", targetId: supplierId, supplierId,
    targetLabel: label, reason: "", detail, requestId: `size-${label}`, ip: "127.0.0.1" }));
  const stored = async (label) => {
    const [[row]] = await h.db.query("SELECT CAST(detail AS CHAR) AS detail FROM supplier_audit_logs WHERE request_id = ?", [`size-${label}`]);
    return row?.detail ?? null;
  };
  // {"metadata":"…"} 嘅序列化長度係 n + 15。
  for (const bytes of [8191, 8192]) {
    const detail = { metadata: "x".repeat(bytes - 15) };
    assert.equal(Buffer.byteLength(JSON.stringify(detail)), bytes);
    await write(detail, `${bytes}`);
    assert.deepEqual(JSON.parse(await stored(`${bytes}`)), detail, `${bytes} bytes kept whole`);
  }
  const list = Array.from({ length: 400 }, (_, index) => `change-${index}-${"y".repeat(20)}`);
  assert.ok(Buffer.byteLength(JSON.stringify({ changes: list })) > 8192);
  await write({ changes: list }, "list");
  assert.deepEqual(JSON.parse(await stored("list")), { changes: { count: 400, sample: list.slice(0, 3), truncated: true } });

  const before = alerts.length;
  await assert.rejects(h.db.withTransaction(async (connection) => {
    await connection.execute("UPDATE suppliers SET notes = 'written before the audit' WHERE id = ?", [supplierId]);
    await audit.record(connection, { actorUserId: null, actorUsername: "aud51", action: "supplier.update", targetType: "supplier", targetId: supplierId,
      supplierId, targetLabel: "too large", reason: "", detail: { metadata: "z".repeat(8178) }, requestId: "size-8193", ip: "127.0.0.1" });
  }), (error) => (error.code ?? error.cause?.code) === "SUPPLIER_AUDIT_DETAIL_TOO_LARGE" || error.cause?.code === "SUPPLIER_AUDIT_DETAIL_TOO_LARGE");
  assert.equal(await stored("8193"), null, "no audit row");
  const [[supplier]] = await h.db.query("SELECT notes FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.notes, "", "the business write rolled back with it");
  assert.deepEqual(alerts.slice(before).map((alert) => [alert.event, alert.context.bytes]), [["supplier.audit.detail_too_large", 8193]]);
});

integrationTest("TC-107 (AUD-005): audit search returns only matching rows, newest first with a stable id tie-break, with exact totals and edges, and Bank detail stays masked", async () => {
  const t = tag();
  const supplierId = await h.seedSupplier(`AUDQ-${t}`, `Audit Query ${t}`);
  const base = Date.now() - 100_000;
  // 15 行：三個 actor × 五個時間（兩對同一 occurred_at，測 id 排序）。
  const seeded = [];
  for (let index = 0; index < 15; index += 1) {
    const occurredAt = base + Math.floor(index / 2) * 1000;
    const [row] = await h.db.execute(
      `INSERT INTO supplier_audit_logs (occurred_at, actor_user_id, actor_username, action, target_type, target_id, supplier_id, target_label, reason,
         detail, request_id, ip) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '', NULL, ?, '127.0.0.1')`,
      [occurredAt, `aud51-actor${index % 3}-${t}`, index % 2 ? "supplier.update" : "supplier.address.update", index % 2 ? "supplier" : "address",
        index, supplierId, `AUDQ-${t}-${index % 4}`, `q-${t}-${index}`]);
    seeded.push({ id: Number(row.insertId), occurredAt, actor: `aud51-actor${index % 3}-${t}`, action: index % 2 ? "supplier.update" : "supplier.address.update",
      targetType: index % 2 ? "supplier" : "address", label: `AUDQ-${t}-${index % 4}` });
  }
  const order = (rows) => [...rows].sort((a, b) => b.occurredAt - a.occurredAt || b.id - a.id).map((row) => row.id);
  const query = async (search) => (await h.send(h.users.view, { ...h.route("GET /api/v1/supplier-audit/logs"), path: `/api/v1/supplier-audit/logs?${search}` })).json.data;
  const cases = [
    [`supplierId=${supplierId}`, () => true],
    [`supplierId=${supplierId}&actor=${encodeURIComponent(`actor1-${t}`)}`, (row) => row.actor.endsWith(`actor1-${t}`)],
    [`supplierId=${supplierId}&action=supplier.update`, (row) => row.action === "supplier.update"],
    [`supplierId=${supplierId}&targetType=address`, (row) => row.targetType === "address"],
    [`supplierId=${supplierId}&target=${encodeURIComponent(`AUDQ-${t}-2`)}`, (row) => row.label === `AUDQ-${t}-2`],
    [`supplierId=${supplierId}&from=${base + 2000}&to=${base + 5000}`, (row) => row.occurredAt >= base + 2000 && row.occurredAt <= base + 5000],
    [`supplierId=${supplierId}&action=supplier.update&from=${base + 3000}`, (row) => row.action === "supplier.update" && row.occurredAt >= base + 3000]
  ];
  for (const [search, keep] of cases) {
    const expected = order(seeded.filter(keep));
    const pages = [];
    let total = null;
    for (let page = 1; page <= Math.ceil(expected.length / 4) + 1; page += 1) {
      const result = await query(`${search}&pageSize=4&page=${page}`);
      total = result.total;
      pages.push(...result.items.map((item) => item.id));
    }
    assert.equal(total, expected.length, `${search}: total`);
    assert.deepEqual(pages, expected, `${search}: order, no gaps or repeats across pages`);
  }
  assert.deepEqual((await query(`supplierId=${supplierId}&page=99&pageSize=4`)).items, [], "a page past the end is empty");

  // Bank audit 經 API 出嚟都係遮罩。
  const bankUser = h.users.bank;
  const account = `64${String(Date.now()).slice(-10)}`;
  const made = await h.send(bankUser, h.route("POST /api/v1/suppliers/:id/bank-accounts/create"), { ids: { id: supplierId },
    body: { accountHolderName: "Masked", bankName: "Masked Bank", accountNumber: account, reason: REASON } });
  assert.equal(made.status, 200, made.text);
  const bankAudit = await query(`supplierId=${supplierId}&targetType=bank`);
  assert.equal(bankAudit.total, 1);
  assert.ok(!JSON.stringify(bankAudit).includes(account), "no account number");
  assert.ok(JSON.stringify(bankAudit.items[0].detail).includes(account.slice(-4)), "the masked last four are there");
});

integrationTest("TC-108 (AUD-006): there is no way to change or delete audit: only a GET route exists, guessed write routes are refused, the service has no write method, and no source writes it", async () => {
  const auditRoutes = h.routes.filter((r) => r.path.startsWith("/api/v1/supplier-audit"));
  assert.deepEqual(auditRoutes.map((r) => r.key), ["GET /api/v1/supplier-audit/logs"]);
  const [[{ lastId }]] = await h.db.query("SELECT MAX(id) AS lastId FROM supplier_audit_logs");
  const before = await h.snapshot();
  for (const user of [h.users.view, h.users.mgmt, await h.makeUser("all", ["supplier.view", "supplier.mgmt", "supplier.approval", "supplier.bank.view",
    "supplier.bank.mgmt", "supplier.settings"])]) {
    for (const [method, routePath] of [["PUT", `/api/v1/supplier-audit/logs/${lastId}`], ["DELETE", `/api/v1/supplier-audit/logs/${lastId}`],
      ["PATCH", `/api/v1/supplier-audit/logs/${lastId}`], ["POST", "/api/v1/supplier-audit/logs"], ["POST", `/api/v1/supplier-audit/logs/${lastId}/delete`],
      ["POST", `/api/v1/supplier-audit/logs/${lastId}/update`], ["DELETE", "/api/v1/supplier-audit/logs"]]) {
      const response = await fetch(`${h.url}${routePath}`, { method, headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify({ reason: "tamper", detail: null }) });
      assert.ok([401, 403, 404, 405].includes(response.status), `${method} ${routePath}: ${response.status}`);
    }
  }
  assert.deepEqual(await h.snapshot(), before, "nothing changed");
  const methods = Object.getOwnPropertyNames(SupplierAuditLogService.prototype).filter((name) => name !== "constructor").sort();
  assert.deepEqual(methods, ["list", "record"]);
  // 原始碼入面冇任何地方 UPDATE 或 DELETE supplier_audit_logs。
  const offenders = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && /(UPDATE\s+supplier_audit_logs|DELETE\s+FROM\s+supplier_audit_logs)/iu.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
    }
  };
  walk(new URL("../../src/", import.meta.url).pathname);
  assert.deepEqual(offenders, []);
});

integrationTest("TC-109 (AUD-007): audit survives the deletion of its Supplier and of its actor, keeping the target IDs and the actor's username", async () => {
  const t = tag();
  const actor = await h.makeUser("gone", ["supplier.view", "supplier.mgmt"]);
  const made = await h.send(actor, h.route("POST /api/v1/suppliers/create"), { body: { supplierCode: `GONE-${t}`, supplierName: `Gone ${t}`, defaultCurrencyCode: "HKD" } });
  assert.equal(made.status, 201, made.text);
  const id = made.json.data.id;
  h.supplierIds.push(id);
  const deleted = await h.send(actor, h.route("POST /api/v1/suppliers/:id/delete"), { ids: { id }, body: { version: 1, reason: REASON } });
  assert.equal(deleted.status, 200, deleted.text);
  const [[gone]] = await h.db.query("SELECT COUNT(*) AS n FROM suppliers WHERE id = ?", [id]);
  assert.equal(Number(gone.n), 0, "the Supplier row is gone");
  let [rows] = await h.db.query("SELECT action, supplier_id, target_id, target_label, actor_user_id, actor_username FROM supplier_audit_logs WHERE supplier_id = ? ORDER BY id", [id]);
  assert.deepEqual(rows.map((row) => [row.action, Number(row.supplier_id), Number(row.target_id), row.target_label]),
    [["supplier.create", id, id, `GONE-${t}`], ["supplier.delete", id, id, `GONE-${t}`]]);

  await h.db.execute("DELETE FROM user_devices WHERE user_id = ?", [actor.userId]);
  await h.db.execute("DELETE FROM user_roles WHERE user_id = ?", [actor.userId]);
  await h.db.execute("DELETE FROM users WHERE id = ?", [actor.userId]);
  [rows] = await h.db.query("SELECT actor_user_id, actor_username FROM supplier_audit_logs WHERE supplier_id = ? ORDER BY id", [id]);
  assert.deepEqual(rows.map((row) => [row.actor_user_id, row.actor_username]), [[null, actor.username], [null, actor.username]]);
  const [foreignKeys] = await h.db.query(
    `SELECT k.column_name AS columnName, k.referenced_table_name AS referenced, r.delete_rule AS rule
       FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r
         ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
      WHERE k.table_schema = DATABASE() AND k.table_name = 'supplier_audit_logs'`);
  assert.deepEqual(foreignKeys.map((key) => [key.columnName, key.referenced, key.rule]), [["actor_user_id", "users", "SET NULL"]],
    "no foreign key on the target; the actor is SET NULL");
});

integrationTest("TC-110 (AUD-008): times are epoch milliseconds in the DB and the API, and one requestId joins the response, the request log and the audit row", async () => {
  const t = tag();
  const startedAt = Date.now();
  const made = await create({ supplierCode: `TIME-${t}`, supplierName: `Time ${t}` });
  const finishedAt = Date.now();
  const requestId = made.json.meta.requestId;
  const [[row]] = await h.db.query("SELECT occurred_at, request_id FROM supplier_audit_logs WHERE request_id = ?", [requestId]);
  assert.ok(row, "the audit row carries the response's requestId");
  const [[column]] = await h.db.query(
    "SELECT data_type AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'supplier_audit_logs' AND column_name = 'occurred_at'");
  assert.equal(column.type, "bigint");
  assert.ok(Number(row.occurred_at) >= startedAt && Number(row.occurred_at) <= finishedAt, "epoch milliseconds, not seconds or local time");
  const listed = await h.send(h.users.view, { ...h.route("GET /api/v1/supplier-audit/logs"), path: `/api/v1/supplier-audit/logs?supplierId=${made.json.data.id}` });
  const entry = listed.json.data.items.find((item) => item.requestId === requestId);
  assert.ok(Number.isSafeInteger(entry.occurredAt) && entry.occurredAt === Number(row.occurred_at), "the API returns the same epoch ms");
  assert.ok(Number.isSafeInteger(made.json.data.updatedAt) && made.json.data.updatedAt >= startedAt);
  const directory = path.join(h.logRoot, "requests");
  let logged = null;
  for (let attempt = 0; attempt < 50 && !logged; attempt += 1) {
    for (const file of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
      logged ??= fs.readFileSync(path.join(directory, file), "utf8").split("\n").find((line) => line.includes(requestId) && line.includes("/api/v1/suppliers/create"));
    }
    if (!logged) await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  assert.ok(logged, "the request log has a line with the same requestId and the route");
});

integrationTest("TC-014 (LIST-007): detail returns the general data, children, payment term and masked Bank for every status, computes no transactions, and the provider marks every non-Active Supplier not purchasable", async () => {
  const t = tag();
  const provider = h.application.services.require("supplierCoreProvider");
  const account = `65${String(Date.now()).slice(-10)}`;
  for (const status of ["draft", "pending_approval", "active", "suspended", "blocked", "archived"]) {
    const id = await h.seedSupplier(`DET-${status.slice(0, 3).toUpperCase()}-${t}`, `Detail ${status} ${t}`, status);
    const now = Date.now();
    await h.db.execute("UPDATE suppliers SET display_name = 'Shown', website = 'https://example.test', general_phone = '2123', general_email = 'a@example.test', notes = 'n' WHERE id = ?", [id]);
    await h.db.execute("INSERT INTO supplier_addresses (supplier_id, label, status, created_at, updated_at) VALUES (?, 'HQ', 'active', ?, ?)", [id, now, now]);
    await h.db.execute("INSERT INTO supplier_contacts (supplier_id, name, status, created_at, updated_at) VALUES (?, 'Amy', 'active', ?, ?)", [id, now, now]);
    await h.db.execute(`INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
      VALUES (?, 'business_registration', 'HK', ?, ?, ?, ?)`, [id, `DT${status}${t}`, `DT${status}${t}`.toUpperCase(), now, now]);
    await h.bankService().create({ actorId: null, claimedRoles: [], claimedPermissions: [], supplierId: id, accountHolderName: "Holder", bankName: "Bank",
      accountNumber: account, isDefault: true, reason: REASON });

    const detail = await h.send(h.users.view, h.route("GET /api/v1/suppliers/:id"), { ids: { id } });
    assert.equal(detail.status, 200, `${status}: ${detail.text}`);
    const data = detail.json.data;
    assert.deepEqual([data.status, data.displayName, data.website, data.generalPhone, data.generalEmail, data.notes, data.defaultCurrencyCode, data.defaultPaymentTermId],
      [status, "Shown", "https://example.test", "2123", "a@example.test", "n", "HKD", null], status);
    assert.deepEqual([data.addresses.length, data.contacts.length, data.identifiers.length], [1, 1, 1], status);
    assert.deepEqual(Object.keys(data).filter((key) => /order|invoice|total|amount|balance|payment(?!Term)/iu.test(key)), [], `${status}: no transaction data`);
    const banks = await h.send(h.users.view, h.route("GET /api/v1/suppliers/:id/bank-accounts"), { ids: { id } });
    assert.equal(banks.json.data.items.length, 1);
    assert.ok(!banks.text.includes(account) && banks.text.includes(account.slice(-4)), `${status}: Bank masked`);
    const usable = await provider.findById(id, { purpose: "purchase" });
    assert.deepEqual([usable.usable, usable.reasons], status === "active" ? [true, []] : [false, ["STATUS_NOT_ACTIVE"]], status);
  }
  assert.equal((await h.send(h.users.view, h.route("GET /api/v1/suppliers/:id"), { ids: { id: MISSING } })).status, 404);
});
