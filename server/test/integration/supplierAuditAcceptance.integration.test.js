import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
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

integrationTest("TC-103 (AUD-001): every state-changing or sensitive Supplier action writes exactly its audit rows, with actor, target, Code, before/after, reason, requestId and IP", async () => {
  const t = tag();
  const exercised = new Set();
  const started = Date.now();
  /**
   * 每一步：發請求、要 2xx，再按 response 嘅 requestId 搵 audit 行。`targets` 係「呢個請求應該寫嘅每個 action」對
   * [target_type, target_id, target_label]（label 對 Supplier 層 action 即係 Supplier Code）；行數同 action 要完全一致。
   * `details` 係個別 action 嘅 before／after 檢查。
   */
  const step = async (name, user, run, targets, { reason = null, supplierId = undefined, details = {} } = {}) => {
    const response = await run();
    assert.ok(response.status >= 200 && response.status < 300, `${name}: ${response.status} ${response.text ?? JSON.stringify(response.json)}`);
    // JSON 回應喺 meta；CSV 下載（匯出）喺 header。
    const requestId = response.json?.meta?.requestId ?? response.headers?.get?.("x-request-id");
    assert.ok(requestId, `${name}: response carries a requestId`);
    const rows = await auditsFor(requestId);
    assert.deepEqual(rows.map((row) => row.action).sort(), Object.keys(targets).sort(), `${name}: audit actions`);
    for (const row of rows) {
      exercised.add(row.action);
      assert.equal(Number(row.actor_user_id), user.userId, `${name}: actor id`);
      assert.equal(row.actor_username, user.username, `${name}: actor username snapshot`);
      assert.match(row.ip, LOOPBACK, `${name}: ip`);
      assert.ok(Number(row.occurred_at) >= started && Number(row.occurred_at) <= Date.now(), `${name}: occurred_at`);
      // target_id `undefined` = 呢個請求先建立嘅行，ID 喺 response 先知，之後另外對。
      const [type, targetId, label] = targets[row.action];
      const actualId = row.target_id === null ? null : Number(row.target_id);
      assert.deepEqual([row.target_type, targetId === undefined ? undefined : actualId, row.target_label], [type, targetId, label],
        `${name} ${row.action}: target`);
      if (supplierId !== undefined) assert.equal(row.supplier_id === null ? null : Number(row.supplier_id), supplierId, `${name}: supplier_id`);
      if (reason !== null && row.action !== "approval.invalidate") assert.equal(row.reason, reason, `${name}: reason`);
      if (details[row.action]) details[row.action](row.detail === null ? null : (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail));
    }
    return response;
  };
  const mgmt = h.users.mgmt;
  const send = (user, key, options) => h.send(user, h.route(key), options);

  // Supplier root 同 child。
  const made = await step("create", mgmt, () => create({ supplierCode: `AUD-${t}`, supplierName: `Audit ${t}` }), { "supplier.create": ["supplier", undefined, `AUD-${t}`] });
  const id = made.json.data.id;
  const [createRow] = await auditsFor(made.json.meta.requestId);
  assert.equal(Number(createRow.target_id), id);
  let version = made.json.data.version;
  const updated = await step("update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/update", { ids: { id }, body: { version, supplierName: `Audit ${t} v2`,
    displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, website: "", generalPhone: "", generalEmail: "", notes: "" } }),
  { "supplier.update": ["supplier", id, `AUD-${t}`] }, { supplierId: id, details: { "supplier.update": (detail) =>
    assert.deepEqual(detail, { before: { supplierName: `Audit ${t}` }, after: { supplierName: `Audit ${t} v2` } }, "only the changed field (HD-112 A)") } });
  version = updated.json.data.version;
  const recoded = await step("code change", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/code/change", { ids: { id },
    body: { supplierCode: `AUD2-${t}`, reason: REASON, version } }), { "supplier.code.change": ["supplier", id, `AUD2-${t}`] },
  { reason: REASON, supplierId: id, details: { "supplier.code.change": (detail) =>
    assert.deepEqual([detail.before.supplierCode, detail.after.supplierCode], [`AUD-${t}`, `AUD2-${t}`], "code change before/after") } });
  version = recoded.json.data.version;
  const code = `AUD2-${t}`;
  const childRoute = { address: "addresses", contact: "contacts", identifier: "identifiers" };
  const child = async (kind, body, label) => {
    const response = await h.send(mgmt, h.route(`POST /api/v1/suppliers/:supplierId/${childRoute[kind]}/create`), { ids: { supplierId: id }, body });
    const rows = await auditsFor(response.json.meta.requestId);
    const childId = response.json.data.id;
    assert.deepEqual(rows.map((row) => [row.action, row.target_type, Number(row.target_id), row.target_label, Number(row.supplier_id)]),
      [[`supplier.${kind}.create`, kind, childId, label, id]], `${kind} create`);
    exercised.add(`supplier.${kind}.create`);
    return { id: childId, version: response.json.data.version };
  };
  // 用途有內容：淨係排次序唔同唔算改；primary 改咗要按 code 排好記前後（HD-112 A，REV-099 F-3）。
  const address = await child("address", { label: "HQ", purposes: [{ purposeCode: "ordering", isPrimary: true }, { purposeCode: "office", isPrimary: false }] }, "HQ");
  const addressRenamed = await step("address update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/addresses/:addressId/update",
    { ids: { supplierId: id, addressId: address.id }, body: { version: address.version, label: "HQ2",
      purposes: [{ purposeCode: "office", isPrimary: false }, { purposeCode: "ordering", isPrimary: true }] } }),
  { "supplier.address.update": ["address", address.id, "HQ2"] }, { supplierId: id, details: { "supplier.address.update": (detail) =>
    assert.deepEqual(detail, { before: { label: "HQ" }, after: { label: "HQ2" } }, "only the changed field; a reorder is no change") } });
  const addressUpdated = await step("address update purposes", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/addresses/:addressId/update",
    { ids: { supplierId: id, addressId: address.id }, body: { version: addressRenamed.json.data.version, label: "HQ2",
      purposes: [{ purposeCode: "ordering", isPrimary: false }, { purposeCode: "office", isPrimary: true }] } }),
  { "supplier.address.update": ["address", address.id, "HQ2"] }, { supplierId: id, details: { "supplier.address.update": (detail) =>
    assert.deepEqual(detail, {
      before: { purposes: [{ purposeCode: "office", isPrimary: false }, { purposeCode: "ordering", isPrimary: true }] },
      after: { purposes: [{ purposeCode: "office", isPrimary: true }, { purposeCode: "ordering", isPrimary: false }] }
    }, "primary change, sorted by code") } });
  await step("address deactivate", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/addresses/:addressId/deactivate",
    { ids: { supplierId: id, addressId: address.id }, body: { version: addressUpdated.json.data.version } }),
  { "supplier.address.deactivate": ["address", address.id, "HQ2"] }, { supplierId: id });
  const contact = await child("contact", { name: "Amy", purposes: [{ purposeCode: "sales", isPrimary: false }, { purposeCode: "orders", isPrimary: true }] }, "Amy");
  const contactUpdated = await step("contact update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/contacts/:contactId/update",
    { ids: { supplierId: id, contactId: contact.id }, body: { version: contact.version, name: "Amy Two",
      purposes: [{ purposeCode: "orders", isPrimary: true }, { purposeCode: "sales", isPrimary: false }] } }),
  { "supplier.contact.update": ["contact", contact.id, "Amy Two"] }, { supplierId: id, details: { "supplier.contact.update": (detail) =>
    assert.deepEqual(detail, { before: { name: "Amy" }, after: { name: "Amy Two" } }, "only the changed field (HD-112 A)") } });
  await step("contact deactivate", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/contacts/:contactId/deactivate",
    { ids: { supplierId: id, contactId: contact.id }, body: { version: contactUpdated.json.data.version } }),
  { "supplier.contact.deactivate": ["contact", contact.id, "Amy Two"] }, { supplierId: id });
  const identifier = await child("identifier", { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `AU${t}` }, "business_registration:HK");
  const identifierUpdated = await step("identifier update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/update",
    { ids: { supplierId: id, identifierId: identifier.id }, body: { version: identifier.version, identifierType: "business_registration",
      issuerCountryCode: "HK", identifierValue: `AV${t}`, reason: REASON } }),
  { "supplier.identifier.update": ["identifier", identifier.id, "business_registration:HK"] }, { reason: REASON, supplierId: id, details: {
    "supplier.identifier.update": (detail) => assert.deepEqual(detail, { before: { identifierValue: `AU${t}` }, after: { identifierValue: `AV${t}` } },
      "only the changed field (REV-099 F-4)") } });
  await step("identifier delete", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/delete",
    { ids: { supplierId: id, identifierId: identifier.id }, body: { version: identifierUpdated.json.data.version, reason: REASON } }),
  { "supplier.identifier.delete": ["identifier", identifier.id, "business_registration:HK"] }, { reason: REASON, supplierId: id });

  // Bank（device＋password），連 reveal 呢個敏感讀取。兩個帳號一定唔同（REV-098 F-1）。
  const bank = h.users.bank;
  const account = `63${String(Date.now()).slice(-10)}`;
  const otherAccount = `${account.slice(0, -1)}${(Number(account.at(-1)) + 1) % 10}`;
  const masked = (value) => (detail) => {
    assert.ok(!JSON.stringify(detail).includes(value), "no account number in the audit");
    assert.ok(String(detail.after?.maskedAccountNumber ?? "").endsWith(value.slice(-4)), "the masked last four only");
  };
  const bankA = await step("bank create", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/create", { ids: { id },
    body: { accountHolderName: "Holder A", bankName: "Bank A", accountNumber: account, isDefault: true, reason: REASON } }),
  { "supplier.bank.create": ["bank", undefined, "Bank A"] }, { reason: REASON, supplierId: id, details: { "supplier.bank.create": masked(account) } });
  const bankB = await step("bank create 2", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/create", { ids: { id },
    body: { accountHolderName: "Holder B", bankName: "Bank B", accountNumber: otherAccount, reason: REASON } }),
  { "supplier.bank.create": ["bank", undefined, "Bank B"] }, { reason: REASON, supplierId: id });
  const bankAId = bankA.json.data.id;
  const bankBId = bankB.json.data.id;
  const bankAUpdated = await step("bank update", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/update",
    { ids: { id, bankAccountId: bankAId }, body: { accountHolderName: "Holder A2", bankName: "Bank A", version: bankA.json.data.version, reason: REASON } }),
  { "supplier.bank.update": ["bank", bankAId, "Bank A"] }, { reason: REASON, supplierId: id, details: { "supplier.bank.update": (detail) => {
    masked(account)(detail);
    assert.equal(detail.changes.accountNumberChanged, false);
  } } });
  await step("bank default", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/default",
    { ids: { id, bankAccountId: bankBId }, body: { version: bankB.json.data.version, reason: REASON } }),
  { "supplier.bank.default": ["bank", bankBId, "Bank B"] }, { reason: REASON, supplierId: id, details: { "supplier.bank.default": (detail) =>
    assert.deepEqual([detail.before.isDefault, detail.after.isDefault], [false, true], "default before/after") } });
  const [[bankAVersion]] = await h.db.query("SELECT version FROM supplier_bank_accounts WHERE id = ?", [bankAUpdated.json.data.id]);
  await step("bank deactivate", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/deactivate",
    { ids: { id, bankAccountId: bankAId }, body: { version: Number(bankAVersion.version), reason: REASON } }),
  { "supplier.bank.deactivate": ["bank", bankAId, "Bank A"] }, { reason: REASON, supplierId: id });
  await step("bank reveal", bank, () => send(bank, "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal",
    { ids: { id, bankAccountId: bankBId }, body: { reason: REASON } }), { "supplier.bank.reveal": ["bank", bankBId, "Bank B"] },
  { reason: REASON, supplierId: id, details: { "supplier.bank.reveal": (detail) => assert.ok(!JSON.stringify(detail).includes(otherAccount)) } });
  const [[createdBank]] = await h.db.query("SELECT target_id FROM supplier_audit_logs WHERE request_id = ?", [bankA.json.meta.requestId]);
  assert.equal(Number(createdBank.target_id), bankAId, "bank create targets the new account");

  // SKU relation。
  const { skuId, uomId } = await purchasableSku();
  const [[skuRow]] = await h.db.query("SELECT sku_code FROM item_skus WHERE id = ?", [skuId]);
  const relation = await step("relation create", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/sku-relations/create",
    { ids: { id }, body: { skuId, purchaseSkuUomId: uomId } }), { "supplier_sku.create": ["supplier_sku", undefined, skuRow.sku_code] }, { supplierId: id });
  const [relationRow] = await auditsFor(relation.json.meta.requestId);
  assert.equal(Number(relationRow.target_id), relation.json.data.id, "relation create targets the new relation");
  await step("relation update", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/sku-relations/:relationId/update",
    { ids: { id, relationId: relation.json.data.id }, body: { supplierItemCode: `SI-${t}`, supplierItemName: "Item", purchaseSkuUomId: uomId,
      minimumOrderQty: 5, standardLeadTimeDays: 7, relationshipStatus: "preferred", version: relation.json.data.version } }),
  { "supplier_sku.update": ["supplier_sku", relation.json.data.id, skuRow.sku_code] }, { supplierId: id });

  // 狀態機（審批關閉）。
  const life = async (action, user, body) => {
    const response = await step(action, user, () => send(user, `POST /api/v1/suppliers/:id/${action}`, { ids: { id }, body: { version, ...body } }),
      { [`supplier.${action}`]: ["supplier", id, code] }, { reason: body?.reason ?? null, supplierId: id });
    version = response.json.data.version;
  };
  await life("activate", mgmt);
  await life("suspend", mgmt, { reason: REASON });
  await life("reactivate", mgmt, { reason: REASON });
  await life("block", h.users.approver, { reason: REASON });
  await life("unblock", h.users.approver, { reason: REASON });
  await life("archive", mgmt, { reason: REASON });
  await life("restore", mgmt, { reason: REASON });
  const doomed = await create({ supplierCode: `DEL-${t}`, supplierName: `Delete ${t}` });
  await step("delete", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/delete", { ids: { id: doomed.json.data.id }, body: { version: 1, reason: REASON } }),
    { "supplier.delete": ["supplier", doomed.json.data.id, `DEL-${t}`] }, { reason: REASON, supplierId: doomed.json.data.id });

  // 匯出、匯入（precheck 係背景工作，冇 request；由 worker 直接跑）。
  await step("export", mgmt, () => send(mgmt, "POST /api/v1/supplier-exports", { body: { filters: { q: code } } }), { "supplier.export": ["export", null, "suppliers"] });
  const uploaded = await uploadImport(mgmt, `IMP-${t}`);
  const jobId = uploaded.data.id;
  assert.deepEqual((await auditsFor(uploaded.meta.requestId)).map((row) => [row.action, row.target_type, Number(row.target_id), row.target_label]),
    [["import.upload", "import", jobId, `import-${jobId}`]]);
  exercised.add("import.upload");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await h.worker.runPrecheck(new AbortController().signal);
    if (!result.claimed || result.jobId === jobId) break;
  }
  const [precheckRows] = await h.db.query("SELECT action FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.precheck'", [jobId]);
  assert.equal(precheckRows.length, 1, "the background precheck writes one audit row");
  exercised.add("import.precheck");
  const job = (await send(mgmt, "GET /api/v1/supplier-imports/:id", { ids: { id: jobId } })).json.data.job;
  assert.equal(job.status, "ready", "prechecked and ready to confirm");
  await step("import confirm", mgmt, () => send(mgmt, "POST /api/v1/supplier-imports/:id/confirm", { ids: { id: jobId },
    body: { version: job.version, activationMode: "draft", approverUserId: null } }), { "import.confirm": ["import", jobId, `import-${jobId}`] });
  const cancelled = await uploadImport(mgmt, `IMC-${t}`);
  await step("import cancel", mgmt, () => send(mgmt, "POST /api/v1/supplier-imports/:id/cancel", { ids: { id: cancelled.data.id },
    body: { version: cancelled.data.version } }), { "import.cancel": ["import", cancelled.data.id, `import-${cancelled.data.id}`] });

  // 設定同審批流程。
  try {
    const on = await setApproval(true);
    await step("settings update", h.users.settings, async () => on, { "setting.update": ["setting", 1, "supplier_settings"] }, { reason: `${REASON} on` });
    const pending = async (label) => {
      const supplierCode = `${label}-${t}`;
      const response = await create({ supplierCode, supplierName: `${label} ${t}`, activate: true, approverUserId: h.users.approver.userId });
      const queue = await h.send(h.users.approver, { ...h.route("GET /api/v1/supplier-approvals"), path: "/api/v1/supplier-approvals?scope=all&pageSize=100" });
      const request = queue.json.data.items.find((item) => item.supplierId === response.json.data.id);
      const rows = await auditsFor(response.json.meta.requestId);
      assert.deepEqual(rows.map((row) => [row.action, row.target_type, Number(row.target_id), row.target_label]).sort(),
        [["approval.submit", "approval", request.id, supplierCode], ["supplier.create", "supplier", response.json.data.id, supplierCode]], `${label} submit`);
      exercised.add("approval.submit");
      return { supplier: response.json.data, request, supplierCode };
    };
    const approved = await pending("APV");
    await step("approve", h.users.approver, () => send(h.users.approver, "POST /api/v1/supplier-approvals/:id/approve",
      { ids: { id: approved.request.id }, body: { version: approved.request.version } }), { "approval.approve": ["approval", approved.request.id, approved.supplierCode] });
    const rejected = await pending("REJ");
    await step("reject", h.users.approver, () => send(h.users.approver, "POST /api/v1/supplier-approvals/:id/reject",
      { ids: { id: rejected.request.id }, body: { version: rejected.request.version, reason: REASON } }),
    { "approval.reject": ["approval", rejected.request.id, rejected.supplierCode] }, { reason: REASON });
    const reassigned = await pending("RAS");
    await step("reassign", h.users.approver, () => send(h.users.approver, "POST /api/v1/supplier-approvals/:id/reassign",
      { ids: { id: reassigned.request.id }, body: { version: reassigned.request.version, approverUserId: h.users.approver2.userId, reason: REASON } }),
    { "approval.reassign": ["approval", reassigned.request.id, reassigned.supplierCode] }, { reason: REASON, details: { "approval.reassign": (detail) =>
      assert.deepEqual([detail.before.assignedApproverId, detail.after.assignedApproverId], [h.users.approver.userId, h.users.approver2.userId]) } });
    const withdrawn = await pending("WDR");
    await step("withdraw", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/approval/withdraw", { ids: { id: withdrawn.supplier.id },
      body: { requestId: withdrawn.request.id, version: withdrawn.request.version } }), { "approval.withdraw": ["approval", withdrawn.request.id, withdrawn.supplierCode] });
    const invalidated = await pending("INV");
    await step("update while pending", mgmt, () => send(mgmt, "POST /api/v1/suppliers/:id/update", { ids: { id: invalidated.supplier.id },
      body: { version: invalidated.supplier.version, supplierName: `INV ${t} renamed`, displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null,
        website: "", generalPhone: "", generalEmail: "", notes: "" } }),
    { "supplier.update": ["supplier", invalidated.supplier.id, invalidated.supplierCode], "approval.invalidate": ["approval", invalidated.request.id, invalidated.supplierCode] });
  } finally {
    await setApproval(false);
  }

  // 冇 audit 行帶 Bank 明文。
  const [leaks] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ? AND (CAST(detail AS CHAR) LIKE ? OR CAST(detail AS CHAR) LIKE ?)",
    [id, `%${account}%`, `%${otherAccount}%`]);
  assert.equal(Number(leaks[0].n), 0);
  // 每個可以寫嘅 action 都由原始碼收集（REV-098 F-5），淨係兩個背景／收貨先寫嘅明文豁免。
  const written = new Set();
  const folder = new URL("../../src/modules/supplier/", import.meta.url);
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith(".js"))) {
    for (const match of fs.readFileSync(new URL(file, folder), "utf8").matchAll(/action: "([a-z_.]+)"/gu)) written.add(match[1]);
  }
  const notExercised = new Set(["import.expire", "supplier_sku.supply"]);
  assert.ok(written.size >= 40, `${written.size} actions found in the source`);
  assert.deepEqual([...written].filter((action) => !exercised.has(action) && !notExercised.has(action)).sort(), [], "every written action was exercised");
});

integrationTest("TC-106 (AUD-004): detail up to 8192 bytes is stored whole, a larger list is summarised to count/sample/truncated, and anything still too large fails the whole transaction with an alert", async () => {
  // 用 app 真正嘅 system logger，告警要落到 system log 先算（REV-098 F-4）。
  const audit = new SupplierAuditLogService({ database: h.db, logger: h.application.services.require("logging").logger, time: { nowMs: () => Date.now() } });
  const alertLines = () => {
    const directory = path.join(h.logRoot, "system");
    return fs.readdirSync(directory).flatMap((file) => fs.readFileSync(path.join(directory, file), "utf8").split("\n"))
      .filter((line) => line.includes("\"supplier.audit.detail_too_large\""));
  };
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

  const before = alertLines().length;
  await assert.rejects(h.db.withTransaction(async (connection) => {
    await connection.execute("UPDATE suppliers SET notes = 'written before the audit' WHERE id = ?", [supplierId]);
    await audit.record(connection, { actorUserId: null, actorUsername: "aud51", action: "supplier.update", targetType: "supplier", targetId: supplierId,
      supplierId, targetLabel: "too large", reason: "", detail: { metadata: "z".repeat(8178) }, requestId: "size-8193", ip: "127.0.0.1" });
  }), (error) => (error.code ?? error.cause?.code) === "SUPPLIER_AUDIT_DETAIL_TOO_LARGE" || error.cause?.code === "SUPPLIER_AUDIT_DETAIL_TOO_LARGE");
  assert.equal(await stored("8193"), null, "no audit row");
  const [[supplier]] = await h.db.query("SELECT notes FROM suppliers WHERE id = ?", [supplierId]);
  assert.equal(supplier.notes, "", "the business write rolled back with it");
  let alerts = [];
  for (let attempt = 0; attempt < 50 && alerts.length === 0; attempt += 1) {
    alerts = alertLines().slice(before);
    if (alerts.length === 0) await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  assert.deepEqual(alerts.map((line) => JSON.parse(line)).map((entry) => [entry.level, entry.context.bytes, entry.context.targetId]),
    [["error", 8193, supplierId]], "one error event in the system log");

  // HD-112 A：notes 只記長度同 SHA-256，兩次 2000 字中文嘅合法更新唔會再因為 audit 超限而失敗。
  const made = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/create"),
    { body: { supplierCode: `AUDNT-${t}`, supplierName: `供應商${"名".repeat(150)}`, defaultCurrencyCode: "HKD" } });
  assert.equal(made.status, 201, made.text);
  h.supplierIds.push(made.json.data.id);
  let version = made.json.data.version;
  const notes = ["甲".repeat(2000), "😀".repeat(2000)];
  let previous = "";
  for (const [index, text] of notes.entries()) {
    const saved = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:id/update"), { ids: { id: made.json.data.id }, body: { version,
      supplierName: `供應商${"新".repeat(150)}${index}`, displayName: "顯".repeat(190), defaultCurrencyCode: "HKD", defaultPaymentTermId: null,
      website: "", generalPhone: "", generalEmail: "", notes: text } });
    assert.equal(saved.status, 200, `update ${index}: ${saved.text}`);
    version = saved.json.data.version;
    const [[row]] = await h.db.query("SELECT CAST(detail AS CHAR) AS detail FROM supplier_audit_logs WHERE request_id = ?", [saved.json.meta.requestId]);
    assert.ok(Buffer.byteLength(row.detail) <= 8192, `${Buffer.byteLength(row.detail)} bytes`);
    const detail = JSON.parse(row.detail);
    assert.ok(!row.detail.includes(text.slice(0, 20)) && (!previous || !row.detail.includes(previous.slice(0, 20))), "neither notes text is stored");
    const digest = (value) => ({ changed: true, length: Array.from(value).length, sha256: createHash("sha256").update(value, "utf8").digest("hex") });
    assert.deepEqual([detail.before.notes, detail.after.notes], [digest(previous), digest(text)]);
    previous = text;
  }

  // REV-099 F-1：每個欄位都用 4-byte 字元填到最長（地址再加控制字元），合法更新照樣成功，audit 唔超限。
  const max = (character, length) => character.repeat(length);
  const supplierBody = (c, v) => ({ version: v, supplierName: max(c, 190), displayName: max(c, 190), defaultCurrencyCode: "HKD", defaultPaymentTermId: null,
    website: "", generalPhone: max(c, 50), generalEmail: "", notes: max(c, 2000) });
  for (const c of ["😀", "😁"]) {
    const saved = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:id/update"), { ids: { id: made.json.data.id }, body: supplierBody(c, version) });
    assert.equal(saved.status, 200, `supplier ${c}: ${saved.text}`);
    version = saved.json.data.version;
    const [[row]] = await h.db.query("SELECT CAST(detail AS CHAR) AS detail FROM supplier_audit_logs WHERE request_id = ?", [saved.json.meta.requestId]);
    assert.ok(Buffer.byteLength(row.detail) <= 8192, `supplier ${c}: ${Buffer.byteLength(row.detail)} bytes`);
  }
  const addressBody = (c) => ({ label: max(c, 100), addressLine1: max(c, 190), addressLine2: max(c, 190), addressLine3: max(c, 190), city: max(c, 100),
    stateRegion: max(c, 100), postalCode: max(c, 100), phone: max(c, 50), notes: max(c, 500), purposes: [] });
  const address = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:supplierId/addresses/create"), { ids: { supplierId: made.json.data.id },
    body: addressBody("😀") });
  assert.equal(address.status, 201, address.text);
  let addressVersion = address.json.data.version;
  for (const c of ["😁", "\u0001", "\u0002"]) {
    const saved = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:supplierId/addresses/:addressId/update"),
      { ids: { supplierId: made.json.data.id, addressId: address.json.data.id }, body: { version: addressVersion, ...addressBody(c) } });
    assert.equal(saved.status, 200, `address ${JSON.stringify(c)}: ${saved.text}`);
    addressVersion = saved.json.data.version;
  }
});

integrationTest("REV-099 F-2: a child update reads its previous purposes under the lock, so a change committed while it waited is not reported as its own", async () => {
  const t = tag();
  const made = await create({ supplierCode: `RACE-${t}`, supplierName: `Race ${t}` });
  const supplierId = made.json.data.id;
  const address = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:supplierId/addresses/create"),
    { ids: { supplierId }, body: { label: "A", purposes: [{ purposeCode: "office", isPrimary: true }] } });
  assert.equal(address.status, 201, address.text);
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  let locked;
  const isLocked = new Promise((resolve) => { locked = resolve; });
  // 另一個請求（例如另一個地址搶 office primary）揸住 Supplier 鎖，改咗 A 嘅 primary。
  const other = h.db.withTransaction(async (connection) => {
    await connection.query("SELECT id FROM suppliers WHERE id = ? FOR UPDATE", [supplierId]);
    await connection.execute("UPDATE supplier_address_purposes SET is_primary = 0 WHERE address_id = ?", [address.json.data.id]);
    locked();
    await released;
  });
  let update;
  try {
    await isLocked;
    update = h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:supplierId/addresses/:addressId/update"), { ids: { supplierId, addressId: address.json.data.id },
      body: { version: address.json.data.version, label: "A2", purposes: [{ purposeCode: "office", isPrimary: false }] } });
    await new Promise((resolve) => { setTimeout(resolve, 400); });
  } finally {
    release();
    await other.catch(() => {});
  }
  const saved = await update;
  assert.equal(saved.status, 200, saved.text);
  const [[row]] = await h.db.query("SELECT CAST(detail AS CHAR) AS detail FROM supplier_audit_logs WHERE request_id = ?", [saved.json.meta.requestId]);
  assert.deepEqual(JSON.parse(row.detail), { before: { label: "A" }, after: { label: "A2" } }, "office was already non-primary when this update got the lock");
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
  const termNow = Date.now();
  const [term] = await h.db.execute(`INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
    VALUES (?, ?, 'Net 30', 'NET_DAYS', 30, 'ACTIVE', 1, ?, ?)`, [`DT-${t}`, `DT-${t}`.toUpperCase(), termNow, termNow]);
  const termId = Number(term.insertId);
  h.cleanup.push(["DELETE FROM payment_terms WHERE id = ?", [termId]]);
  for (const status of ["draft", "pending_approval", "active", "suspended", "blocked", "archived"]) {
    const id = await h.seedSupplier(`DET-${status.slice(0, 3).toUpperCase()}-${t}`, `Detail ${status} ${t}`, status);
    const now = Date.now();
    await h.db.execute(`UPDATE suppliers SET display_name = 'Shown', website = 'https://example.test', general_phone = '2123', general_email = 'a@example.test',
      notes = 'n', default_payment_term_id = ? WHERE id = ?`, [termId, id]);
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
      [status, "Shown", "https://example.test", "2123", "a@example.test", "n", "HKD", termId], status);
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
