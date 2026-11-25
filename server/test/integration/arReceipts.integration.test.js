/**
 * 開票與應收首期：收款、核銷、解除、作廢收款及帳齡表，經真 HTTP、真 JWT 及真 MySQL（SCOPE §1、§3、§4）。
 *
 * Fixture 見 ../ar/arHttpFixture.js（全檔共用一次）。發票以 SQL 直接寫成 CONFIRMED（開票另有測試檔），全檔約 40 張；
 * 收款全部經 API 建立，約 20 筆。每案 1 次；只有一案用 2 個並發請求驗同一收款不會被超額核銷。沒有容量或效能斷言。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { parse } from "csv-parse/sync";

import { arReceiptService } from "../../src/handlers/ar/arSchemas.js";
import { arHttpFixture as fixture, failure } from "../ar/arHttpFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const REASON = "收款作廢測試原因";


integrationTest("收款草稿：建立後可讀，金額只收幣別小數位，未知客戶、欄位、方式及不符的 Idempotency-Key 都被拒絕而且不留資料", async () => {
  const f = await fixture(), party = await f.customer();
  const created = await f.draft(party, "1250.5", { paymentMethod: "CHEQUE", reference: "CHQ-001", notes: "第一行\n第二行" });
  assert.deepEqual([created.number, created.status, created.version, created.replayed], [null, "DRAFT", 1, false]);
  const detail = await f.read(created.id);
  assert.deepEqual([detail.customerId, detail.customerCode, detail.customerName, detail.currencyCode, detail.currencyDecimalPlaces, detail.receiptDate],
    [party.id, party.code, party.name, "HKD", 2, f.today]);
  assert.deepEqual([detail.amount, detail.allocatedAmount, detail.availableAmount, detail.paymentMethod, detail.reference, detail.notes],
    ["1250.5000", "0.0000", "1250.5000", "CHEQUE", "CHQ-001", "第一行\n第二行"]);
  assert.deepEqual([detail.allowedActions, detail.allocations, detail.createdByLabel], [["confirm", "cancel"], [], f.clerk.username]);

  const base = { customerId: party.id, currencyCode: "HKD", receiptDate: f.today, amount: "10.00", paymentMethod: "CASH" };
  const before = await f.count("ar_receipts WHERE customer_id = ?", [party.id]);
  assert.deepEqual(failure(await f.post("", { ...base, amount: "10.005" })), [400, "AR_INPUT_INVALID", "amount"]);
  assert.deepEqual(failure(await f.post("", { ...base, amount: "0.00" })), [400, "AR_INPUT_INVALID", "amount"]);
  assert.deepEqual(failure(await f.post("", { ...base, amount: 10 })), [400, "AR_INPUT_INVALID", "amount"]);
  assert.deepEqual(failure(await f.post("", { ...base, paymentMethod: "CARD" })), [400, "AR_INPUT_INVALID", "paymentMethod"]);
  assert.deepEqual(failure(await f.post("", { ...base, receiptDate: "2026-02-30" })), [400, "AR_INPUT_INVALID", "receiptDate"]);
  assert.deepEqual(failure(await f.post("", { ...base, receiptDate: f.day(1) })), [409, "AR_DATE_IN_FUTURE", "receiptDate"]); // 收款日期不可在未來。
  assert.deepEqual(failure(await f.post("", { ...base, status: "CONFIRMED" })), [400, "AR_INPUT_INVALID", "body"]);
  assert.deepEqual(failure(await f.post("", { ...base, customerId: 2 ** 40 })).slice(0, 2), [409, "AR_CUSTOMER_NOT_FOUND"]);
  assert.deepEqual(failure(await f.post("", { ...base, currencyCode: "ZZZ" })).slice(0, 2), [409, "CURRENCY_NOT_ACTIVE"]);
  assert.deepEqual(failure(await f.send("/api/v1/ar-receipts", { token: f.clerk.token, body: { eventId: randomUUID(), ...base }, key: randomUUID() })), [400, "AR_INPUT_INVALID", "eventId"]);
  assert.equal(await f.count("ar_receipts WHERE customer_id = ?", [party.id]), before);
});

integrationTest("確認取年度流水號；版本不符及狀態不符分別回 VERSION_CONFLICT 及 AR_STATE_CONFLICT；草稿可取消，取消後不可確認", async () => {
  const f = await fixture(), party = await f.customer();
  const first = await f.receipt(party, "100.00"), second = await f.receipt(party, "200.00");
  const year = f.today.slice(0, 4), pattern = new RegExp(`^RCT-${year}-\\d{6}$`, "u");
  assert.match(first.number, pattern);
  assert.match(second.number, pattern);
  // 流水號全庫共用：其他測試檔同時確認收款時不一定連號，所以只斷言嚴格遞增。
  assert.ok(Number(second.number.slice(-6)) > Number(first.number.slice(-6)));
  assert.deepEqual([first.status, first.version], ["CONFIRMED", 2]);
  const detail = await f.read(first.id);
  assert.deepEqual([detail.number, detail.confirmedByLabel, detail.allowedActions], [first.number, f.clerk.username, ["allocate", "void"]]);
  assert.equal(typeof detail.confirmedAt, "number");

  const stale = await f.post(`/${first.id}/confirm`, { version: 1 });
  assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.details], [409, "VERSION_CONFLICT", { currentVersion: 2 }]);
  assert.deepEqual(failure(await f.post(`/${first.id}/confirm`, { version: 2 })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.post(`/${first.id}/cancel`, { version: 2 })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.post("/999999999999/confirm", { version: 1 })).slice(0, 2), [404, "AR_RECEIPT_NOT_FOUND"]);

  // 收款日期在未來的草稿不可確認，而且不取號（AC-046）；日期回到今日即可確認。
  const postdated = await f.draft(party, "30.00");
  await f.db.query("UPDATE ar_receipts SET receipt_date = ? WHERE id = ?", [f.day(1), postdated.id]);
  assert.deepEqual(failure(await f.post(`/${postdated.id}/confirm`, { version: 1 })), [409, "AR_DATE_IN_FUTURE", "receiptDate"]);
  assert.deepEqual([(await f.read(postdated.id)).number, (await f.read(postdated.id)).status, (await f.read(postdated.id)).version], [null, "DRAFT", 1]);
  await f.db.query("UPDATE ar_receipts SET receipt_date = ? WHERE id = ?", [f.today, postdated.id]);
  assert.ok(Number(f.ok(await f.post(`/${postdated.id}/confirm`, { version: 1 })).number.slice(-6)) > Number(second.number.slice(-6)));

  const created = await f.draft(party, "50.00");
  const cancelled = f.ok(await f.post(`/${created.id}/cancel`, { version: 1 }));
  assert.deepEqual([cancelled.status, cancelled.version, cancelled.number], ["CANCELLED", 2, null]);
  assert.deepEqual(failure(await f.post(`/${created.id}/confirm`, { version: 2 })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual((await f.read(created.id)).allowedActions, []);
});

integrationTest("核銷：一筆收款部分核銷到兩張發票，未核銷的餘額留在收款上；各種不合規的核銷整個被拒絕而且不寫入", async () => {
  const f = await fixture(), party = await f.customer(), stranger = await f.customer();
  const a = await f.invoice(party, "300.0000"), b = await f.invoice(party, "500.0000");
  const rcpt = await f.receipt(party, "600.00");
  const done = f.ok(await f.post(`/${rcpt.id}/allocations`, { version: 2, allocations: [{ invoiceId: b, amount: "250.00" }, { invoiceId: a, amount: "300" }] }));
  assert.deepEqual([done.status, done.version, done.allocatedAmount, done.availableAmount, done.allocationIds.length, done.replayed],
    ["CONFIRMED", 3, "550.0000", "50.0000", 2, false]);
  const ia = await f.invoiceRow(a);
  let ib = await f.invoiceRow(b);
  assert.deepEqual([ia.allocated_amount, ia.outstanding_amount, Number(ia.version)], ["300.0000", "0.0000", 2]);
  assert.deepEqual([ib.allocated_amount, ib.outstanding_amount, Number(ib.version)], ["250.0000", "250.0000", 2]);
  const detail = await f.read(rcpt.id);
  assert.deepEqual(detail.allocations.map((row) => [row.invoiceId, row.amount, row.status, row.invoiceOutstandingAmount, row.allowedActions]),
    [[b, "250.0000", "ACTIVE", "250.0000", ["unapply"]], [a, "300.0000", "ACTIVE", "0.0000", ["unapply"]]]);
  assert.deepEqual(detail.allowedActions, ["allocate"]); // 仍有核銷，所以不可作廢。

  const foreign = await f.invoice(stranger, "100.0000"), otherCurrency = await f.invoice(party, "100.0000", { currency: f.other });
  const draftInvoice = await f.invoice(party, "100.0000", { status: "DRAFT" }), voidInvoice = await f.invoice(party, "100.0000", { status: "VOID" });
  const allocate = (allocations, version = 3) => f.post(`/${rcpt.id}/allocations`, { version, allocations });
  const rows = await f.count("ar_receipt_allocations WHERE receipt_id = ?", [rcpt.id]);
  assert.deepEqual(failure(await allocate([{ invoiceId: b, amount: "250.01" }])), [409, "AR_ALLOCATION_EXCEEDS_OUTSTANDING", "allocations.0"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: b, amount: "50.01" }])).slice(0, 2), [409, "AR_ALLOCATION_EXCEEDS_AVAILABLE"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: b, amount: "10.00" }, { invoiceId: foreign, amount: "10.00" }])), [409, "AR_PARTY_MISMATCH", "allocations.1"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: otherCurrency, amount: "10.00" }])), [409, "AR_PARTY_MISMATCH", "allocations.0"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: draftInvoice, amount: "10.00" }])), [409, "AR_STATE_CONFLICT", "allocations.0"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: voidInvoice, amount: "10.00" }])), [409, "AR_STATE_CONFLICT", "allocations.0"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: 2 ** 40, amount: "10.00" }])), [404, "AR_INVOICE_NOT_FOUND", "allocations.0"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: b, amount: "10.00" }, { invoiceId: b, amount: "5.00" }])), [400, "AR_INPUT_INVALID", "allocations"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: b, amount: "10.001" }])), [400, "AR_INPUT_INVALID", "allocations.0.amount"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: b, amount: "0" }])), [400, "AR_INPUT_INVALID", "allocations.0.amount"]);
  assert.deepEqual(failure(await allocate([])), [400, "AR_INPUT_INVALID", "allocations"]);
  assert.deepEqual(failure(await allocate([{ invoiceId: b, amount: "10.00" }], 2)).slice(0, 2), [409, "VERSION_CONFLICT"]);
  const unconfirmed = await f.draft(party, "10.00");
  assert.deepEqual(failure(await f.post(`/${unconfirmed.id}/allocations`, { version: 1, allocations: [{ invoiceId: b, amount: "10.00" }] })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);

  assert.equal(await f.count("ar_receipt_allocations WHERE receipt_id = ?", [rcpt.id]), rows);
  ib = await f.invoiceRow(b);
  assert.deepEqual([ib.allocated_amount, ib.outstanding_amount, Number(ib.version)], ["250.0000", "250.0000", 2]);
  assert.deepEqual([(await f.read(rcpt.id)).version, (await f.invoiceRow(foreign)).outstanding_amount], [3, "100.0000"]);
});

integrationTest("多筆收款核銷同一張發票直到收齊；兩個同時送出的核銷只有一個成功，收款不會被超額核銷", async () => {
  const f = await fixture(), party = await f.customer();
  const target = await f.invoice(party, "1000.0000");
  const first = await f.receipt(party, "400.00"), second = await f.receipt(party, "700.00", { paymentMethod: "CASH" });
  f.ok(await f.post(`/${first.id}/allocations`, { version: 2, allocations: [{ invoiceId: target, amount: "400.00" }] }));
  const closing = f.ok(await f.post(`/${second.id}/allocations`, { version: 2, allocations: [{ invoiceId: target, amount: "600.00" }] }));
  assert.deepEqual([closing.allocatedAmount, closing.availableAmount], ["600.0000", "100.0000"]);
  const paid = await f.invoiceRow(target);
  assert.deepEqual([paid.allocated_amount, paid.outstanding_amount, paid.status], ["1000.0000", "0.0000", "CONFIRMED"]);
  assert.deepEqual(failure(await f.post(`/${second.id}/allocations`, { version: 3, allocations: [{ invoiceId: target, amount: "0.01" }] })), [409, "AR_ALLOCATION_EXCEEDS_OUTSTANDING", "allocations.0"]);

  const x = await f.invoice(party, "80.0000"), y = await f.invoice(party, "80.0000");
  const results = await Promise.all([x, y].map((invoiceId) => f.post(`/${second.id}/allocations`, { version: 3, allocations: [{ invoiceId, amount: "80.00" }] })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(results.find((result) => result.status === 409).body.error.code, "VERSION_CONFLICT");
  const after = await f.read(second.id);
  assert.deepEqual([after.allocatedAmount, after.availableAmount, after.version], ["680.0000", "20.0000", 4]);
  assert.deepEqual([(await f.invoiceRow(x)).outstanding_amount, (await f.invoiceRow(y)).outstanding_amount].sort(), ["0.0000", "80.0000"]);
});

integrationTest("解除核銷：金額回到收款及發票，記錄保留為 UNAPPLIED；重複解除及不屬於該收款的核銷被拒絕", async () => {
  const f = await fixture(), party = await f.customer();
  const a = await f.invoice(party, "300.0000"), b = await f.invoice(party, "300.0000");
  const rcpt = await f.receipt(party, "500.00"), another = await f.receipt(party, "10.00");
  const { allocationIds: [toA, toB] } = f.ok(await f.post(`/${rcpt.id}/allocations`, { version: 2, allocations: [{ invoiceId: a, amount: "300.00" }, { invoiceId: b, amount: "150.00" }] }));

  const undone = f.ok(await f.post(`/${rcpt.id}/allocations/${toA}/unapply`, { version: 3 }));
  assert.deepEqual([undone.version, undone.allocatedAmount, undone.availableAmount, undone.allocationId, undone.status], [4, "150.0000", "350.0000", toA, "CONFIRMED"]);
  const ia = await f.invoiceRow(a), ib = await f.invoiceRow(b);
  assert.deepEqual([ia.allocated_amount, ia.outstanding_amount, Number(ia.version)], ["0.0000", "300.0000", 3]);
  assert.deepEqual([ib.allocated_amount, ib.outstanding_amount], ["150.0000", "150.0000"]);
  const detail = await f.read(rcpt.id);
  assert.deepEqual(detail.allocations.map((row) => [row.id, row.status, row.unappliedByLabel, row.allowedActions]),
    [[toA, "UNAPPLIED", f.clerk.username, []], [toB, "ACTIVE", "", ["unapply"]]]);
  assert.equal(typeof detail.allocations[0].unappliedAt, "number");

  assert.deepEqual(failure(await f.post(`/${rcpt.id}/allocations/${toA}/unapply`, { version: 4 })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.post(`/${rcpt.id}/allocations/${toB}/unapply`, { version: 3 })).slice(0, 2), [409, "VERSION_CONFLICT"]);
  assert.deepEqual(failure(await f.post(`/${another.id}/allocations/${toB}/unapply`, { version: 2 })).slice(0, 2), [404, "AR_ALLOCATION_NOT_FOUND"]);
  // 解除後的金額可以再核銷到同一張發票。
  const again = f.ok(await f.post(`/${rcpt.id}/allocations`, { version: 4, allocations: [{ invoiceId: a, amount: "100.00" }] }));
  assert.deepEqual([again.allocatedAmount, again.availableAmount, (await f.invoiceRow(a)).outstanding_amount], ["250.0000", "250.0000", "200.0000"]);
});

integrationTest("作廢收款：仍有核銷時不可作廢，解除後可以；須原因；作廢後金額保留、號碼保留、不可再核銷", async () => {
  const f = await fixture(), party = await f.customer();
  const target = await f.invoice(party, "90.0000");
  const rcpt = await f.receipt(party, "90.00");
  const { allocationIds: [allocation] } = f.ok(await f.post(`/${rcpt.id}/allocations`, { version: 2, allocations: [{ invoiceId: target, amount: "90.00" }] }));
  assert.deepEqual(failure(await f.post(`/${rcpt.id}/void`, { version: 3, reason: REASON })).slice(0, 2), [409, "AR_RECEIPT_HAS_ALLOCATIONS"]);
  f.ok(await f.post(`/${rcpt.id}/allocations/${allocation}/unapply`, { version: 3 }));

  assert.deepEqual(failure(await f.post(`/${rcpt.id}/void`, { version: 4 })), [400, "AR_INPUT_INVALID", "reason"]);
  assert.deepEqual(failure(await f.post(`/${rcpt.id}/void`, { version: 4, reason: "短" })), [400, "AR_INPUT_INVALID", "reason"]);
  const draft = await f.draft(party, "5.00");
  assert.deepEqual(failure(await f.post(`/${draft.id}/void`, { version: 1, reason: REASON })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);

  const voided = f.ok(await f.post(`/${rcpt.id}/void`, { version: 4, reason: `  ${REASON}  ` }));
  assert.deepEqual([voided.status, voided.version, voided.number], ["VOID", 5, rcpt.number]);
  const detail = await f.read(rcpt.id);
  assert.deepEqual([detail.status, detail.amount, detail.allocatedAmount, detail.availableAmount, detail.voidReason, detail.voidedByLabel, detail.allowedActions],
    ["VOID", "90.0000", "0.0000", "0.0000", REASON, f.clerk.username, []]);
  assert.equal(typeof detail.voidedAt, "number");
  assert.deepEqual(detail.allocations.map((row) => [row.status, row.allowedActions]), [["UNAPPLIED", []]]);
  assert.deepEqual(failure(await f.post(`/${rcpt.id}/allocations`, { version: 5, allocations: [{ invoiceId: target, amount: "10.00" }] })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.deepEqual(failure(await f.post(`/${rcpt.id}/void`, { version: 5, reason: REASON })).slice(0, 2), [409, "AR_STATE_CONFLICT"]);
  assert.equal((await f.invoiceRow(target)).outstanding_amount, "90.0000");
});

integrationTest("帳齡表：按到期日分五桶，邊界日準確；只計已確認而仍有未收額的發票；按客戶及幣別分列，不同幣別不相加", async () => {
  const f = await fixture(), party = await f.customer(), second = await f.customer();
  // 逾期日數 → 金額：0 日及未到期歸未到期；1、30｜31、60｜61、90｜91 各自落在桶的兩端。
  for (const [overdue, total] of [[-10, "1.00"], [0, "2.00"], [1, "4.00"], [30, "8.00"], [31, "16.00"], [60, "32.00"], [61, "64.00"], [90, "128.00"], [91, "256.00"], [400, "512.00"]]) {
    await f.invoice(party, `${total}00`, { dueOffset: -overdue });
  }
  await f.invoice(party, "1000.0000", { dueOffset: -5, status: "DRAFT" });
  await f.invoice(party, "1000.0000", { dueOffset: -5, status: "VOID" });
  await f.invoice(party, "1000.0000", { dueOffset: -5, status: "CANCELLED" });
  await f.invoice(party, "70.0000", { dueOffset: -45, allocated: "70.0000" }); // 已收齊。
  await f.invoice(party, "100.0000", { dueOffset: -45, allocated: "60.0000" }); // 部分核銷：只計未收的 40。
  await f.invoice(party, "9.5000", { dueOffset: -200, currency: f.other });
  await f.invoice(second, "7.0000", { dueOffset: 15 });

  const aging = f.ok(await f.send(`/api/v1/ar-aging?customerId=${party.id}`, { token: f.viewer.token }));
  assert.equal(aging.asOfDate, f.today);
  const [hkd, other] = [aging.items.find((row) => row.currencyCode === "HKD"), aging.items.find((row) => row.currencyCode === f.other)];
  assert.equal(aging.items.length, 2);
  assert.deepEqual(hkd, { customerId: party.id, customerCode: party.code, customerName: party.name, currencyCode: "HKD", currencyDecimalPlaces: 2, invoiceCount: 11,
    notDue: "3.0000", days1To30: "12.0000", days31To60: "88.0000", days61To90: "192.0000", over90: "768.0000", total: "1063.0000" });
  assert.deepEqual([other.invoiceCount, other.notDue, other.over90, other.total], [1, "0.0000", "9.5000", "9.5000"]);
  assert.deepEqual(aging.totals.map((row) => [row.currencyCode, row.invoiceCount, row.total]).sort(), [["HKD", 11, "1063.0000"], [f.other, 1, "9.5000"]].sort());

  const filtered = f.ok(await f.send(`/api/v1/ar-aging?customerId=${party.id}&currencyCode=${f.other}`, { token: f.viewer.token }));
  assert.deepEqual(filtered.items.map((row) => [row.currencyCode, row.total]), [[f.other, "9.5000"]]);
  // 不帶客戶篩選時兩個客戶各自一列，並且各幣別一個合計。
  const all = f.ok(await f.send("/api/v1/ar-aging?currencyCode=HKD", { token: f.viewer.token }));
  assert.deepEqual(all.items.find((row) => row.customerId === second.id).notDue, "7.0000");
  assert.ok(all.items.some((row) => row.customerId === party.id) && all.items.every((row) => row.currencyCode === "HKD"));
  assert.equal(all.totals.length, 1);

  // 收齊一張逾期發票後，該桶即減少；核銷令帳齡表歸零的是未收額而不是狀態。
  const [[overdue]] = await f.db.query("SELECT id FROM ar_invoices WHERE customer_id = ? AND total_amount = '256.0000'", [party.id]);
  const rcpt = await f.receipt(party, "256.00");
  f.ok(await f.post(`/${rcpt.id}/allocations`, { version: 2, allocations: [{ invoiceId: Number(overdue.id), amount: "256.00" }] }));
  const afterPayment = f.ok(await f.send(`/api/v1/ar-aging?customerId=${party.id}&currencyCode=HKD`, { token: f.viewer.token }));
  assert.deepEqual([afterPayment.items[0].over90, afterPayment.items[0].invoiceCount, afterPayment.items[0].total], ["512.0000", 10, "807.0000"]);
});

integrationTest("收款列表：新到舊、分頁、狀態、客戶、幣別、日期及前綴搜尋；非法查詢參數被拒絕", async () => {
  const f = await fixture(), party = await f.customer();
  const older = await f.receipt(party, "11.00", { reference: `REF-${party.code}`, receiptDate: f.day(-3) });
  const newer = await f.draft(party, "22.00", { receiptDate: f.day(-1) });
  const list = async (query) => f.ok(await f.send(`/api/v1/ar-receipts?customerId=${party.id}${query}`, { token: f.viewer.token }));
  const all = await list("");
  assert.deepEqual([all.total, all.page, all.pageSize, all.items.map((row) => row.id)], [2, 1, 20, [newer.id, older.id]]);
  assert.deepEqual(all.items.map((row) => row.allowedActions), [[], []]); // viewer 沒有收款管理權限。
  assert.deepEqual((await list("&pageSize=1&page=2")).items.map((row) => row.id), [older.id]);
  assert.deepEqual((await list("&status=CONFIRMED")).items.map((row) => [row.id, row.number, row.amount]), [[older.id, older.number, "11.0000"]]);
  assert.deepEqual((await list(`&receiptDateFrom=${f.day(-2)}&receiptDateTo=${f.day(0)}`)).items.map((row) => row.id), [newer.id]);
  assert.deepEqual((await list(`&q=REF-${party.code}`)).items.map((row) => row.id), [older.id]);
  assert.deepEqual((await list(`&q=${older.number}`)).items.map((row) => row.id), [older.id]);
  assert.deepEqual((await list("&q=%25")).total, 0); // 通配符只是普通字。
  assert.equal((await list(`&currencyCode=${f.other}`)).total, 0);
  assert.equal((await f.send("/api/v1/ar-receipts?status=PAID", { token: f.viewer.token })).status, 400);
  assert.equal((await f.send("/api/v1/ar-receipts?pageSize=101", { token: f.viewer.token })).status, 400);
  assert.deepEqual(failure(await f.send(`/api/v1/ar-receipts?receiptDateFrom=2026-02-30`, { token: f.viewer.token })).slice(0, 2), [400, "AR_INPUT_INVALID"]);
  assert.deepEqual(failure(await f.send("/api/v1/ar-receipts/999999999999", { token: f.viewer.token })).slice(0, 2), [404, "AR_RECEIPT_NOT_FOUND"]);
});

integrationTest("權限：查看要 ar.view，收款及核銷命令要 ar.receipt.mgmt，兩者互不繼承；未登入一律 401", async () => {
  const f = await fixture(), party = await f.customer();
  const rcpt = await f.receipt(party, "10.00"), target = await f.invoice(party, "10.0000");
  const body = { customerId: party.id, currencyCode: "HKD", receiptDate: f.today, amount: "1.00", paymentMethod: "CASH" };
  const commands = [["", body], [`/${rcpt.id}/confirm`, { version: 2 }], [`/${rcpt.id}/cancel`, { version: 2 }], [`/${rcpt.id}/void`, { version: 2, reason: REASON }],
    [`/${rcpt.id}/allocations`, { version: 2, allocations: [{ invoiceId: target, amount: "1.00" }] }], [`/${rcpt.id}/allocations/1/unapply`, { version: 2 }]];
  for (const [path, fields] of commands) {
    assert.equal((await f.post(path, fields, f.viewer.token)).status, 403, path);
    assert.equal((await f.post(path, fields, f.outsider.token)).status, 403, path);
    assert.equal((await f.post(path, fields, null)).status, 401, path);
  }
  for (const path of ["/api/v1/ar-receipts", `/api/v1/ar-receipts/${rcpt.id}`, "/api/v1/ar-aging"]) {
    assert.equal((await f.send(path, { token: f.viewer.token })).status, 200, path);
    assert.equal((await f.send(path, { token: f.outsider.token })).status, 403, path);
    assert.equal((await f.send(path)).status, 401, path);
  }
  assert.deepEqual([(await f.read(rcpt.id)).version, (await f.invoiceRow(target)).outstanding_amount], [2, "10.0000"]);
});

integrationTest("同一 eventId 重送：回原結果而且只生效一次；同一 eventId 用於不同內容或不同操作者是衝突；每個成功命令寫一行 Audit", async () => {
  const f = await fixture(), party = await f.customer(), service = arReceiptService(f.application.services);
  const target = await f.invoice(party, "100.0000"), rcpt = await f.receipt(party, "100.00");

  // 經 HTTP：框架的 Idempotency-Key 層以同一 key 回同一個回應。
  const eventId = randomUUID(), fields = { version: 2, allocations: [{ invoiceId: target, amount: "30.00" }] };
  const first = f.ok(await f.post(`/${rcpt.id}/allocations`, fields, f.clerk.token, eventId));
  const resent = f.ok(await f.post(`/${rcpt.id}/allocations`, fields, f.clerk.token, eventId));
  assert.deepEqual([resent.allocationIds, resent.version, resent.availableAmount], [first.allocationIds, 3, "70.0000"]);

  // 直接經 service（即 HTTP 冪等記錄已過期或遺失時）：由 ar_operation_requests 的 event_id 回原結果，replayed 為 true。
  const replay = await service.allocate({ claims: f.clerk.claims, receiptId: rcpt.id, input: { eventId, ...fields } });
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(await f.count("ar_receipt_allocations WHERE receipt_id = ?", [rcpt.id]), 1);
  assert.deepEqual([(await f.read(rcpt.id)).version, (await f.invoiceRow(target)).outstanding_amount], [3, "70.0000"]);
  assert.equal(await f.count("ar_operation_requests WHERE event_id = ?", [eventId]), 1);

  const conflict = (promise) => assert.rejects(promise, (error) => error.code === "AR_EVENT_CONFLICT");
  await conflict(service.allocate({ claims: f.clerk.claims, receiptId: rcpt.id, input: { eventId, version: 2, allocations: [{ invoiceId: target, amount: "31.00" }] } }));
  await conflict(service.confirm({ claims: f.clerk.claims, receiptId: rcpt.id, input: { eventId, version: 3 } }));
  const peer = { ...f.clerk.claims }; // 另一個有同樣權限的操作者。
  const [[role]] = await f.db.query("SELECT id FROM roles WHERE name = ?", [f.clerk.claims.roles[0]]);
  await f.db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [f.outsider.id, role.id]);
  try {
    peer.sub = String(f.outsider.id);
    peer.roles = [...f.clerk.claims.roles, ...f.outsider.claims.roles].sort();
    peer.permissions = ["ar.invoice.mgmt", "ar.receipt.mgmt", "ar.view"];
    await conflict(service.allocate({ claims: peer, receiptId: rcpt.id, input: { eventId, ...fields } }));
  } finally {
    await f.db.query("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?", [f.outsider.id, role.id]);
  }
  // 權限在交易內重驗：claims 與資料庫不符即 PERMISSION_STALE，沒有 ar.receipt.mgmt 亦然。
  await assert.rejects(service.void({ claims: { ...f.clerk.claims, permissions: ["ar.receipt.mgmt"] }, receiptId: rcpt.id, input: { eventId: randomUUID(), version: 3, reason: REASON } }),
    (error) => error.code === "PERMISSION_STALE");
  await assert.rejects(service.confirm({ claims: f.viewer.claims, receiptId: rcpt.id, input: { eventId: randomUUID(), version: 3 } }), (error) => error.code === "PERMISSION_STALE");

  const [audit] = await f.db.query("SELECT action, outcome, target_type, target_id, customer_id, target_label, actor_label, detail FROM ar_audit_logs WHERE customer_id = ? ORDER BY id", [party.id]);
  assert.deepEqual(audit.map((row) => [row.action, row.outcome, row.target_type, Number(row.target_id), row.target_label, row.actor_label]), [
    ["receipt.created", "SUCCEEDED", "RECEIPT", rcpt.id, "", f.clerk.username], ["receipt.confirmed", "SUCCEEDED", "RECEIPT", rcpt.id, rcpt.number, f.clerk.username],
    ["receipt.allocated", "SUCCEEDED", "RECEIPT", rcpt.id, rcpt.number, f.clerk.username]]);
  const detail = typeof audit[2].detail === "string" ? JSON.parse(audit[2].detail) : audit[2].detail;
  assert.deepEqual(detail, { version: 3, allocations: [{ allocationId: first.allocationIds[0], invoiceId: target, amount: "30.0000" }] });
});


integrationTest("應收帳齡 CSV 沿用查閱權限、篩選及幣別小計，試算表欄位不執行公式", async () => {
  const f = await fixture(), party = await f.customer();
  await f.invoice({ ...party, name: '=SUM(1,2) "示例"' }, "225.0000", { dueOffset: -5 });
  await f.invoice(party, "100.0000", { currency: f.other });
  const exportCsv = (query, token) => fetch(f.url + "/api/v1/ar-aging/export" + query, {
    headers: token ? { Authorization: "Bearer " + token } : {}
  });
  const query = `?customerId=${party.id}&currencyCode=HKD`;
  const response = await exportCsv(query, f.viewer.token);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/csv/u);
  assert.match(response.headers.get("content-disposition"), /ar-aging-\d{4}-\d{2}-\d{2}\.csv/u);
  assert.match(response.headers.get("cache-control"), /no-store/u);
  const csv = await response.text();
  assert.deepEqual(parse(csv, { bom: true }), [
    ["asOfDate", "rowType", "customerCode", "customerName", "currencyCode", "invoiceCount", "notDue", "days1To30", "days31To60", "days61To90", "over90", "total"],
    [f.today, "detail", party.code, `'=SUM(1,2) "示例"`, "HKD", "1", "0.0000", "225.0000", "0.0000", "0.0000", "0.0000", "225.0000"],
    [f.today, "currencyTotal", "", "", "HKD", "1", "0.0000", "225.0000", "0.0000", "0.0000", "0.0000", "225.0000"]
  ]);
  for (const [token, status] of [[f.outsider.token, 403], [undefined, 401]]) {
    const denied = await exportCsv(query, token);
    assert.equal(denied.status, status);
    await denied.arrayBuffer();
  }
  const empty = await exportCsv(`?customerId=${party.id}&currencyCode=ZZZ`, f.viewer.token);
  assert.equal(empty.status, 200);
  assert.equal(parse(await empty.text(), { bom: true }).length, 1);
});
