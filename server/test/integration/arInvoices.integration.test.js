/**
 * 開票與應收首期：發票的確認、取消、作廢、列表、詳情及權限，經真 HTTP、真 JWT 及真 MySQL（SCOPE §1、§4）。
 *
 * Fixture 見 ../ar/arHttpFixture.js（全檔共用一次）。這裡的發票草稿以 SQL 直接寫入（沒有發票行），全檔約 15 張，收款 1 筆；
 * 由真實出貨建立草稿、防重開票及金額計算在 arInvoiceFromShipments.integration.test.js 以隔離資料庫驗。
 * 每案 1 次，無並發。沒有容量或效能斷言。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { arHttpFixture as fixture, failure } from "../ar/arHttpFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const REASON = "發票作廢測試原因";

integrationTest("發票確認取年度流水號；取消只限草稿；作廢須原因而且須先解除全部核銷，作廢後號碼保留並離開帳齡表", async () => {
  const f = await fixture(), party = await f.customer();
  const read = async (id, token = f.biller.token) => f.ok(await f.send(`/api/v1/ar-invoices/${id}`, { token }));
  const first = await f.invoice(party, "120.0000", { status: "DRAFT" }), second = await f.invoice(party, "80.0000", { status: "DRAFT" });
  assert.deepEqual([(await read(first)).allowedActions, (await read(first)).number], [["confirm", "cancel"], null]);

  const confirmed = f.ok(await f.invoicePost(`/${first}/confirm`, { version: 1 })), next = f.ok(await f.invoicePost(`/${second}/confirm`, { version: 1 }));
  assert.match(confirmed.number, new RegExp(`^INV-${f.today.slice(0, 4)}-\\d{6}$`, "u"));
  assert.equal(Number(next.number.slice(-6)), Number(confirmed.number.slice(-6)) + 1);
  assert.deepEqual([confirmed.status, confirmed.version, confirmed.replayed], ["CONFIRMED", 2, false]);
  let detail = await read(first);
  assert.deepEqual([detail.number, detail.status, detail.confirmedByLabel, detail.totalAmount, detail.outstandingAmount, detail.allowedActions, detail.lines, detail.allocations],
    [confirmed.number, "CONFIRMED", f.biller.username, "120.0000", "120.0000", ["void"], [], []]);
  assert.equal(typeof detail.confirmedAt, "number");

  const stale = await f.invoicePost(`/${first}/confirm`, { version: 1 });
  assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.details], [409, "VERSION_CONFLICT", { currentVersion: 2 }]);
  assert.deepEqual(failure(await f.invoicePost(`/${first}/confirm`, { version: 2 })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.invoicePost(`/${first}/cancel`, { version: 2 })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.invoicePost("/999999999999/confirm", { version: 1 })).slice(0, 2), [404, "AR_INVOICE_NOT_FOUND"]);
  assert.deepEqual(failure(await f.send("/api/v1/ar-invoices/999999999999", { token: f.biller.token })).slice(0, 2), [404, "AR_INVOICE_NOT_FOUND"]);

  // 有核銷的發票不可作廢；詳情列出核銷及其收款。
  const rcpt = await f.receipt(party, "50.00");
  const { allocationIds: [allocation] } = f.ok(await f.post(`/${rcpt.id}/allocations`, { version: 2, allocations: [{ invoiceId: first, amount: "50.00" }] }));
  assert.deepEqual(failure(await f.invoicePost(`/${first}/void`, { version: 3, reason: REASON })).slice(0, 2), [409, "AR_INVOICE_HAS_ALLOCATIONS"]);
  detail = await read(first);
  assert.deepEqual([detail.version, detail.allocatedAmount, detail.outstandingAmount, detail.allowedActions], [3, "50.0000", "70.0000", []]);
  assert.deepEqual(detail.allocations.map((row) => [row.id, row.receiptId, row.receiptNumber, row.receiptDate, row.amount, row.status]),
    [[allocation, rcpt.id, rcpt.number, f.today, "50.0000", "ACTIVE"]]);

  f.ok(await f.post(`/${rcpt.id}/allocations/${allocation}/unapply`, { version: 3 }));
  assert.deepEqual(failure(await f.invoicePost(`/${first}/void`, { version: 4 })), [400, "AR_INPUT_INVALID", "reason"]);
  assert.deepEqual(failure(await f.invoicePost(`/${second}/void`, { version: 1, reason: REASON })).slice(0, 2), [409, "VERSION_CONFLICT"]);
  const voided = f.ok(await f.invoicePost(`/${first}/void`, { version: 4, reason: REASON }));
  assert.deepEqual([voided.status, voided.version, voided.number], ["VOID", 5, confirmed.number]);
  detail = await read(first);
  assert.deepEqual([detail.status, detail.voidReason, detail.voidedByLabel, detail.allowedActions, detail.allocations.map((row) => row.status)], ["VOID", REASON, f.biller.username, [], ["UNAPPLIED"]]);
  assert.equal(typeof detail.voidedAt, "number");
  assert.deepEqual(failure(await f.invoicePost(`/${first}/void`, { version: 5, reason: REASON })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.post(`/${rcpt.id}/allocations`, { version: 4, allocations: [{ invoiceId: first, amount: "1.00" }] })), [409, "AR_STATE_CONFLICT", "allocations.0"]);
  // 帳齡表只剩另一張已確認的發票。
  const aging = f.ok(await f.send(`/api/v1/ar-aging?customerId=${party.id}`, { token: f.viewer.token }));
  assert.deepEqual(aging.items.map((row) => [row.invoiceCount, row.total]), [[1, "80.0000"]]);

  // 草稿可取消；取消後不可確認，草稿亦不可作廢。
  const third = await f.invoice(party, "10.0000", { status: "DRAFT" }), fourth = await f.invoice(party, "10.0000", { status: "DRAFT" });
  assert.deepEqual(failure(await f.invoicePost(`/${third}/void`, { version: 1, reason: REASON })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  const cancelled = f.ok(await f.invoicePost(`/${third}/cancel`, { version: 1 }));
  assert.deepEqual([cancelled.status, cancelled.version, cancelled.number], ["CANCELLED", 2, null]);
  assert.deepEqual(failure(await f.invoicePost(`/${third}/confirm`, { version: 2 })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual([(await read(third)).allowedActions, (await read(fourth, f.viewer.token)).allowedActions], [[], []]);

  const [audit] = await f.db.query("SELECT action, target_type, target_label, reason FROM ar_audit_logs WHERE customer_id = ? AND target_type = 'INVOICE' ORDER BY id", [party.id]);
  assert.deepEqual(audit.map((row) => [row.action, row.target_label, row.reason]), [["invoice.confirmed", confirmed.number, ""], ["invoice.confirmed", next.number, ""],
    ["invoice.voided", confirmed.number, REASON], ["invoice.cancelled", "", ""]]);
});

integrationTest("發票列表：新到舊、分頁、狀態、客戶、幣別、日期、只列未收及前綴搜尋；已開票出貨查詢及建立草稿的輸入驗證", async () => {
  const f = await fixture(), party = await f.customer();
  const open = await f.invoice(party, "300.0000", { dueOffset: -40 }), paid = await f.invoice(party, "70.0000", { allocated: "70.0000" });
  const draft = await f.invoice(party, "15.0000", { status: "DRAFT", dueOffset: 5 }), foreign = await f.invoice(party, "9.0000", { currency: f.other });
  const list = async (query) => f.ok(await f.send(`/api/v1/ar-invoices?customerId=${party.id}${query}`, { token: f.viewer.token }));

  const all = await list("");
  assert.deepEqual([all.total, all.page, all.pageSize, all.items.map((row) => row.id)], [4, 1, 20, [foreign, draft, paid, open]]);
  const row = all.items.at(-1);
  assert.deepEqual([row.status, row.customerCode, row.customerName, row.currencyCode, row.currencyDecimalPlaces, row.dueDate, row.totalAmount, row.allocatedAmount, row.outstandingAmount, row.allowedActions],
    ["CONFIRMED", party.code, party.name, "HKD", 2, f.day(-40), "300.0000", "0.0000", "300.0000", []]);
  assert.match(row.number, /^T/u);
  assert.deepEqual((await list("&pageSize=2&page=2")).items.map((item) => item.id), [paid, open]);
  assert.deepEqual((await list("&status=DRAFT")).items.map((item) => [item.id, item.number]), [[draft, null]]);
  assert.deepEqual((await list(`&currencyCode=${f.other}`)).items.map((item) => item.id), [foreign]);
  // 核銷時選取用：只列已確認而且仍有未收額的發票。
  assert.deepEqual((await list("&outstandingOnly=true&currencyCode=HKD")).items.map((item) => item.id), [open]);
  assert.deepEqual((await list("&outstandingOnly=false&currencyCode=HKD")).total, 3);
  assert.deepEqual((await list(`&invoiceDateFrom=${f.day(-41)}&invoiceDateTo=${f.day(-41)}`)).items.map((item) => item.id), [open]);
  assert.deepEqual((await list(`&q=${row.number}`)).items.map((item) => item.id), [open]);
  assert.deepEqual((await list(`&q=${party.code}`)).total, 4);
  assert.equal((await list("&q=%25")).total, 0);
  assert.equal((await f.send("/api/v1/ar-invoices?status=PAID", { token: f.viewer.token })).status, 400);
  assert.deepEqual(failure(await f.send("/api/v1/ar-invoices?invoiceDateTo=2026-02-30", { token: f.viewer.token })).slice(0, 2), [400, "AR_INPUT_INVALID"]);
  // 有發票管理權限的人在列表見到可做的動作。
  assert.deepEqual((await f.ok(await f.send(`/api/v1/ar-invoices?customerId=${party.id}&currencyCode=HKD`, { token: f.biller.token }))).items.map((item) => item.allowedActions),
    [["confirm", "cancel"], [], ["void"]]);

  // 已開票出貨查詢：沒有發票的出貨不在結果內；格式不對的參數被拒絕。
  assert.deepEqual(f.ok(await f.send("/api/v1/ar-invoiced-shipments?shipmentIds=999999999991,999999999992", { token: f.viewer.token })), { items: [] });
  for (const query of ["", "?shipmentIds=", "?shipmentIds=1,,2", "?shipmentIds=abc", "?shipmentIds=0"]) {
    assert.equal((await f.send(`/api/v1/ar-invoiced-shipments${query}`, { token: f.viewer.token })).status, 400, query);
  }

  // 建立草稿：輸入不合規在讀取出貨前被拒絕；不存在的出貨由 Fulfillment 的 reader 整個拒絕，不留下發票或操作記錄。
  const before = await f.count("ar_invoices");
  const create = (fields, eventId = randomUUID()) => f.invoicePost("", fields, f.biller.token, eventId);
  assert.deepEqual(failure(await create({ shipmentIds: [] })), [400, "AR_INPUT_INVALID", "shipmentIds"]);
  assert.deepEqual(failure(await create({ shipmentIds: [1, 1] })), [400, "AR_INPUT_INVALID", "shipmentIds"]);
  assert.deepEqual(failure(await create({ shipmentIds: ["1"] })), [400, "AR_INPUT_INVALID", "shipmentIds.0"]);
  assert.deepEqual(failure(await create({ shipmentIds: Array.from({ length: 21 }, (_, index) => index + 1) })), [400, "AR_INPUT_INVALID", "shipmentIds"]);
  assert.deepEqual(failure(await create({ shipmentIds: [1], dueDate: "2026-02-30" })), [400, "AR_INPUT_INVALID", "dueDate"]);
  assert.deepEqual(failure(await create({ shipmentIds: [1], dueDateReason: "短" })), [400, "AR_INPUT_INVALID", "dueDateReason"]);
  assert.deepEqual(failure(await create({ shipmentIds: [1], totalAmount: "1.00" })), [400, "AR_INPUT_INVALID", "body"]);
  assert.deepEqual(failure(await f.send("/api/v1/ar-invoices", { token: f.biller.token, body: { eventId: randomUUID(), shipmentIds: [1] }, key: randomUUID() })), [400, "AR_INPUT_INVALID", "eventId"]);
  const missing = randomUUID(), unknown = await create({ shipmentIds: [999999999991], dueDate: f.day(30) }, missing);
  assert.equal(unknown.status, 409, JSON.stringify(unknown.body));
  assert.equal(await f.count("ar_invoices"), before);
  assert.equal(await f.count("ar_operation_requests WHERE event_id = ?", [missing]), 0);
});

integrationTest("權限：發票命令要 ar.invoice.mgmt，查看要 ar.view，兩者互不繼承，收款權限不能操作發票；未登入一律 401", async () => {
  const f = await fixture(), party = await f.customer();
  const draft = await f.invoice(party, "10.0000", { status: "DRAFT" }), confirmed = await f.invoice(party, "10.0000");
  const commands = [["", { shipmentIds: [1], dueDate: f.day(30) }], [`/${draft}/confirm`, { version: 1 }], [`/${draft}/cancel`, { version: 1 }], [`/${confirmed}/void`, { version: 1, reason: REASON }]];
  for (const [path, fields] of commands) {
    assert.equal((await f.invoicePost(path, fields, f.viewer.token)).status, 403, path);
    assert.equal((await f.invoicePost(path, fields, f.clerk.token)).status, 403, path);
    assert.equal((await f.invoicePost(path, fields, null)).status, 401, path);
  }
  for (const path of ["/api/v1/ar-invoices", `/api/v1/ar-invoices/${draft}`, "/api/v1/ar-invoiced-shipments?shipmentIds=1"]) {
    assert.equal((await f.send(path, { token: f.viewer.token })).status, 200, path);
    assert.equal((await f.send(path, { token: f.clerk.token })).status, 200, path);
    assert.equal((await f.send(path, { token: f.outsider.token })).status, 403, path);
    assert.equal((await f.send(path)).status, 401, path);
  }
  assert.deepEqual([(await f.invoiceRow(draft)).status, (await f.invoiceRow(confirmed)).status], ["DRAFT", "CONFIRMED"]);
  // 只有 ar.invoice.mgmt（沒有 ar.view）的人可以做命令，但不能讀。
  const done = f.ok(await f.invoicePost(`/${draft}/confirm`, { version: 1 }, f.outsider.token));
  assert.deepEqual([done.status, done.version], ["CONFIRMED", 2]);
});
