/**
 * 開票與應收首期：由真實的 SHIPPED 出貨開票（SCOPE §1、§3），來源只經 Fulfillment 的 readInvoiceSourcesInTransaction。
 *
 * 每案用 Fulfillment 既有的 shipmentDraftFixture 在自己的隔離資料庫建立 1 張訂單（1 行，訂 5 件）及最多 2 張出貨
 * （3 件及 2 件），再於隔離庫套用 AR 與其相依 migrations。全檔 2 案，每案 1 次；第二案有一次 2 個並發請求，驗同一張出貨
 * 只會上一張發票，另一次 2 個並發的收款建立驗交易內不另佔連線。服務直接呼叫（隔離資料庫沒有 HTTP application）；HTTP、權限及查詢另見 arInvoices.integration.test.js。
 * 沒有容量或效能斷言。資料庫隨 fixture 丟棄。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";

import { ArCommandRunner } from "../../src/modules/ar/arCommand.js";
import { ArInquiryService } from "../../src/modules/ar/ArInquiryService.js";
import { ArInvoiceService } from "../../src/modules/ar/ArInvoiceService.js";
import { ArReceiptService } from "../../src/modules/ar/ArReceiptService.js";
import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";
import { readInvoiceSourcesInTransaction } from "../../src/modules/fulfillment/readInvoiceSourcesInTransaction.js";
import { ShipmentConfirmationService } from "../../src/modules/fulfillment/ShipmentConfirmationService.js";
import { migrateArShipmentFixture, secondShipment } from "../ar/arShipmentFixture.js";
import { shipmentDraftFixture } from "../fulfillment/p1CancellationFixture.js";

const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const REASON = "發票作廢測試原因", TODAY = "2023-11-14";
const code = (expected) => (error) => { assert.equal(error.code, expected, error.stack); return true; };

/** 一張訂單（1 行，訂 5 件，行金額由呼叫方設定）及其第一張出貨草稿（3 件）；AR 表及權限已建立，操作者持有三個 ar.* 權限。 */
async function arFixture(t, { lineAmount, unitPrice }) {
  const f = await shipmentDraftFixture(t);
  await migrateArShipmentFixture(f.db);
  await f.s.insert("customer_address_purposes", { address_id: f.s.addressId, customer_id: f.s.customerId, purpose_code: "billing", is_default: 1,
    created_at: f.s.now, updated_at: f.s.now });
  // AR 的操作者另建一名用戶及角色：改動 fixture 的角色會令 Fulfillment 自己的權限重驗失敗。
  const label = `ar_${randomUUID().slice(0, 12)}`, permissions = ["ar.invoice.mgmt", "ar.receipt.mgmt", "ar.view"];
  const userId = await f.s.insert("users", { username: label, password_hash: "synthetic-only", display_name: "AR synthetic", created_at: f.s.now, updated_at: f.s.now });
  const roleId = await f.s.insert("roles", { name: label, created_at: f.s.now });
  await f.db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  for (const name of permissions) await f.db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [roleId, name]);
  await f.db.query("UPDATE sales_order_lines SET unit_selling_price = ?, line_amount = ? WHERE id = ?", [unitPrice, lineAmount, f.s.lineId]);
  const claims = { sub: String(userId), roles: [label], permissions };
  const time = { nowMs: () => f.s.now + 1, at: (ms) => new Date(ms), fileDate: () => TODAY };
  const shared = { commands: new ArCommandRunner({ database: f.database, time }), time, customers: (executor) => new CustomerLookupService({ database: executor }),
    businessMaster: new BusinessMasterProvider({ database: f.database, repository: new BusinessMasterRepository() }) };
  const invoices = new ArInvoiceService({ ...shared, readInvoiceSources: readInvoiceSourcesInTransaction }), receipts = new ArReceiptService(shared);
  const inquiry = new ArInquiryService({ database: f.database, time });
  /** 把一張出貨草稿確認為 SHIPPED。 */
  const ship = (id, shipmentDate = TODAY) => f.execute(async () => {
    const confirmation = new ShipmentConfirmationService({ ...f.options, time: { ...f.options.time, fileDate: () => shipmentDate } });
    const completed = await confirmation.completeConfirmation(await confirmation.startConfirmation(id, { eventId: randomUUID(), version: 1 }));
    assert.equal(completed.outcome, "SHIPPED");
  });
  // 輸入驗證在建立交易前同步拋出；async 令它與交易內的錯誤一樣成為 rejection（handler 的 execute 亦是 async）。
  const run = async (method, fields, extra = {}) => f.execute(() => invoices[method]({ claims, ...extra, input: { eventId: randomUUID(), ...fields } }));
  const create = (shipmentIds, fields = {}) => run("create", { shipmentIds: shipmentIds.map(Number), dueDate: "2023-12-14", ...fields });
  const act = (method, invoiceId, fields) => run(method, fields, { invoiceId });
  const first = (await f.create(f.body())).outcome.id;
  return { f, claims, label, invoices, receipts, inquiry, ship, run, create, act, first, count: async (sql, values) => Number((await f.db.query(`SELECT COUNT(*) AS total FROM ${sql}`, values))[0][0].total) };
}

nativeTest("分兩次出貨的訂單行：金額按出貨次序由剩餘池計算；同一出貨不可重複開票；取消或作廢後可重開；確認取號", async (t) => {
  const a = await arFixture(t, { lineAmount: "0.1000", unitPrice: "0.0143" }), { f } = a;
  // 未出貨的草稿不可開票。
  await assert.rejects(a.create([a.first]), code("SHIPMENT_STATE_CONFLICT"));
  const second = await secondShipment(f);
  await a.ship(second, "2023-11-13"); // 2 件的一張先確認出貨。
  await a.ship(a.first); // 3 件的一張後確認。
  await assert.rejects(a.create([second, a.first], { invoiceDate: "2023-11-13" }), code("AR_INVOICE_BEFORE_SHIPMENT_DATE"));
  assert.equal(await a.count("ar_invoices"), 0);
  // 把訂單行改為訂 7 件（仍有 2 件未出），令「較早出貨的數量」在數字上分辨得出：
  // 先出的 2 件取 0.1000 × 2/7 = 0.0286；後出的 3 件從剩餘的 0.0714 及 5 件取 3/5 = 0.0428。若不計較早的出貨，會是 0.1000 × 3/7 = 0.0429。
  await f.db.query("UPDATE sales_order_lines SET ordered_quantity = 7, ordered_base_quantity = 7 WHERE id = ?", [f.s.lineId]);

  // 只開後出貨的一張：行金額 0.0428，總額按幣別 2 位小數為 0.04。
  const alone = await a.create([a.first], { notes: "第一張" });
  assert.deepEqual([alone.number, alone.status, alone.version, alone.totalAmount, alone.replayed], [null, "DRAFT", 1, "0.0400", false]);
  const detail = await a.inquiry.getInvoice({ claims: a.claims, id: alone.id });
  assert.deepEqual([detail.customerId, detail.currencyDecimalPlaces, detail.invoiceDate, detail.dueDate, detail.dueDateOverridden, detail.paymentTermCode, detail.notes],
    [f.s.customerId, 2, TODAY, "2023-12-14", false, "", "第一張"]);
  assert.deepEqual([detail.totalAmount, detail.allocatedAmount, detail.outstandingAmount, detail.allowedActions], ["0.0400", "0.0000", "0.0400", ["confirm", "cancel"]]);
  assert.equal(detail.lines.length, 1);
  const [line] = detail.lines;
  assert.deepEqual([line.lineNo, line.shipmentId, line.salesOrderId, line.salesOrderLineId, line.quantity, line.unitPrice, line.lineAmount, line.salesUomCode, line.toBaseFactor],
    [1, Number(a.first), f.s.orderId, f.s.lineId, "3", "0.0143", "0.0428", "EA", 1]);
  assert.deepEqual((await a.inquiry.invoicedShipments({ shipmentIds: `${a.first},${second}` })).items,
    [{ shipmentId: Number(a.first), invoiceId: alone.id, invoiceNumber: null, invoiceStatus: "DRAFT" }]);

  // 同一張出貨已在一張草稿上：單獨或連同另一張出貨再開都被拒絕，而且不留下任何資料。
  await assert.rejects(a.create([a.first]), code("AR_SHIPMENT_ALREADY_INVOICED"));
  await assert.rejects(a.create([second, a.first]), code("AR_SHIPMENT_ALREADY_INVOICED"));
  assert.deepEqual([await a.count("ar_invoices"), await a.count("ar_invoice_lines")], [1, 1]);

  // 取消草稿即釋放出貨行；兩張出貨合開一張，行按出貨 ID 排列，各自的金額不因合開而改變。
  const cancelled = await a.act("cancel", alone.id, { version: 1 });
  assert.deepEqual([cancelled.status, cancelled.version], ["CANCELLED", 2]);
  assert.deepEqual((await a.inquiry.invoicedShipments({ shipmentIds: String(a.first) })).items, []);
  // 模擬修正前已存的舊草稿。拒絕確認後，草稿和兩張出貨的占用保留。
  const legacy = await a.create([second, a.first], { invoiceDate: TODAY });
  await f.db.query("UPDATE ar_invoices SET invoice_date = ? WHERE id = ?", ["2023-11-13", legacy.id]);
  await assert.rejects(a.act("confirm", legacy.id, { version: 1 }), code("AR_INVOICE_BEFORE_SHIPMENT_DATE"));
  const rejected = await a.inquiry.getInvoice({ claims: a.claims, id: legacy.id });
  assert.deepEqual([rejected.status, rejected.version, rejected.number], ["DRAFT", 1, null]);
  assert.deepEqual((await a.inquiry.invoicedShipments({ shipmentIds: `${a.first},${second}` })).items.map((row) => row.invoiceId),
    [legacy.id, legacy.id]);
  const legacyCancelled = await a.act("cancel", legacy.id, { version: 1 });
  assert.equal(legacyCancelled.status, "CANCELLED");
  assert.deepEqual((await a.inquiry.invoicedShipments({ shipmentIds: `${a.first},${second}` })).items, []);

  const both = await a.create([second, a.first], { invoiceDate: TODAY });
  assert.equal(both.totalAmount, "0.0700"); // 0.0428 + 0.0286 = 0.0714，按幣別小數位 half-up。
  const lines = (await a.inquiry.getInvoice({ claims: a.claims, id: both.id })).lines;
  assert.deepEqual(lines.map((row) => [row.lineNo, row.shipmentId, row.quantity, row.lineAmount]), [[1, Number(a.first), "3", "0.0428"], [2, Number(second), "2", "0.0286"]]);

  // 同一 eventId 重送：回原結果，沒有第二張發票。
  const eventId = randomUUID(), input = { eventId, version: 1 };
  const confirmed = await f.execute(() => a.invoices.confirm({ claims: a.claims, invoiceId: both.id, input }));
  assert.deepEqual([confirmed.number, confirmed.status, confirmed.version, confirmed.replayed], ["INV-2023-000001", "CONFIRMED", 2, false]);
  assert.deepEqual(await f.execute(() => a.invoices.confirm({ claims: a.claims, invoiceId: both.id, input })), { ...confirmed, replayed: true });
  await assert.rejects(a.act("cancel", both.id, { version: 2 }), code("AR_STATE_CONFLICT"));
  await assert.rejects(a.act("confirm", both.id, { version: 1 }), code("VERSION_CONFLICT"));
  await assert.rejects(a.create([second]), code("AR_SHIPMENT_ALREADY_INVOICED"));

  // 作廢須原因；作廢後號碼保留，兩張出貨都可重新開票，新發票另取新號。
  await assert.rejects(a.act("void", both.id, { version: 2 }), code("AR_INPUT_INVALID"));
  const voided = await a.act("void", both.id, { version: 2, reason: REASON });
  assert.deepEqual([voided.number, voided.status, voided.version], ["INV-2023-000001", "VOID", 3]);
  const after = await a.inquiry.getInvoice({ claims: a.claims, id: both.id });
  assert.deepEqual([after.status, after.voidReason, after.voidedByLabel, after.allowedActions, after.lines.length], ["VOID", REASON, a.label, [], 2]);
  assert.deepEqual((await a.inquiry.invoicedShipments({ shipmentIds: `${a.first},${second}` })).items, []);
  const again = await a.create([a.first, second]);
  const reissued = await a.act("confirm", again.id, { version: 1 });
  assert.deepEqual([reissued.number, again.totalAmount], ["INV-2023-000002", "0.0700"]);
  assert.deepEqual((await a.inquiry.invoicedShipments({ shipmentIds: `${second},${a.first}` })).items.map((row) => [row.shipmentId, row.invoiceId, row.invoiceStatus]),
    [[Number(a.first), again.id, "CONFIRMED"], [Number(second), again.id, "CONFIRMED"]]);

  // 每個成功命令一行 Audit；被拒絕的命令沒有留下操作列。
  const [audit] = await f.db.query("SELECT action FROM ar_audit_logs ORDER BY id");
  assert.deepEqual(audit.map((row) => row.action), ["invoice.created", "invoice.cancelled", "invoice.created", "invoice.cancelled",
    "invoice.created", "invoice.confirmed", "invoice.voided", "invoice.created", "invoice.confirmed"]);
  assert.equal(await a.count("ar_operation_requests"), 9);
});

nativeTest("到期日由付款條款現行日數計算，可改而須原因；沒有條款時必須輸入；兩個同時開同一張出貨的請求只有一個成功；權限在交易內重驗", async (t) => {
  const a = await arFixture(t, { lineAmount: "5.0000", unitPrice: "1.0000" }), { f } = a;
  await a.ship(a.first, "2023-11-10");
  const bare = (fields) => a.run("create", { shipmentIds: [Number(a.first)], ...fields });

  // 訂單沒有付款條款：必須輸入到期日，而且不可早於發票日期。
  await assert.rejects(bare({}), code("AR_DUE_DATE_REQUIRED"));
  await assert.rejects(bare({ invoiceDate: "2023-11-10", dueDate: "2023-11-09" }), code("AR_INPUT_INVALID"));
  await assert.rejects(bare({ dueDate: "2023-02-30" }), code("AR_INPUT_INVALID"));
  await assert.rejects(bare({ invoiceDate: "2023-11-15", dueDate: "2023-12-14" }), code("AR_DATE_IN_FUTURE")); // 今日是 2023-11-14：發票日期不可在未來。
  await assert.rejects(a.run("create", { shipmentIds: [] }), code("AR_INPUT_INVALID"));
  await assert.rejects(a.run("create", { shipmentIds: [1, 1] }), code("AR_INPUT_INVALID"));
  await assert.rejects(a.run("create", { shipmentIds: Array.from({ length: 21 }, (_, index) => index + 1) }), code("AR_INPUT_INVALID"));
  await assert.rejects(a.run("create", { shipmentIds: [Number(a.first)], totalAmount: "1.00" }), code("AR_INPUT_INVALID"));
  assert.equal(await a.count("ar_invoices"), 0);

  // 按箱賣、按件出（TABLES-ADDENDUM-1）：訂單行的銷售單位是 BOX、一箱 6 件；發票行保存並回傳銷售單位及換算率，
  // quantity 仍是基本單位（3 件），單價仍是每箱的價格，行金額不受影響。
  await f.db.query("UPDATE sales_order_lines SET uom_code_snapshot = 'BOX', to_base_factor_snapshot = 6 WHERE id = ?", [f.s.lineId]);
  const boxed = await a.create([a.first]);
  const [boxLine] = (await a.inquiry.getInvoice({ claims: a.claims, id: boxed.id })).lines;
  const [[shipped]] = await f.db.query("SELECT base_uom_code_snapshot AS base FROM shipment_lines WHERE shipment_id = ?", [a.first]);
  assert.deepEqual([boxLine.salesUomCode, boxLine.toBaseFactor, boxLine.baseUomCode, boxLine.quantity, boxLine.unitPrice, boxLine.lineAmount], ["BOX", 6, shipped.base, "3", "1.0000", "3.0000"]);
  assert.notEqual(shipped.base, "BOX");
  await a.act("cancel", boxed.id, { version: 1 });

  // 權限在交易內重驗：沒有 ar.invoice.mgmt 的操作者（這裡是 Fulfillment 的用戶），或 claims 與資料庫不符，都是 PERMISSION_STALE。
  const input = () => ({ eventId: randomUUID(), shipmentIds: [Number(a.first)], dueDate: "2023-12-14" });
  await assert.rejects(f.execute(() => a.invoices.create({ claims: f.claims, input: input() })), code("PERMISSION_STALE"));
  await assert.rejects(f.execute(() => a.invoices.create({ claims: { ...a.claims, permissions: ["ar.invoice.mgmt"] }, input: input() })), code("PERMISSION_STALE"));

  // 訂單掛上 30 日條款：到期日 = 發票日期 + 30 日，條款代碼及名稱取訂單上保存的快照。
  const term = Number((await f.db.query("INSERT INTO payment_terms SET ?", [{ code: "N30", code_key: "n30", name: "Net 30", calculation_type: "NET_DAYS", due_days: 30, status: "ACTIVE",
    version: 1, created_at: f.s.now, updated_at: f.s.now }]))[0].insertId);
  await f.db.query("UPDATE sales_orders SET payment_term_id = ?, payment_term_code_snapshot = 'N30-OLD', payment_term_name_snapshot = 'Net 30 (order)' WHERE id = ?", [term, f.s.orderId]);
  const calculated = await bare({ invoiceDate: "2023-11-10" });
  let detail = await a.inquiry.getInvoice({ claims: a.claims, id: calculated.id });
  assert.deepEqual([detail.invoiceDate, detail.dueDate, detail.dueDateOverridden, detail.dueDateReason, detail.paymentTermCode, detail.paymentTermName, detail.totalAmount],
    ["2023-11-10", "2023-12-10", false, "", "N30-OLD", "Net 30 (order)", "3.0000"]);
  await a.act("cancel", calculated.id, { version: 1 });

  // 輸入與計算結果相同的日子不算修改；不同就要原因，並記錄為人手修改。
  const same = await bare({ invoiceDate: "2023-11-10", dueDate: "2023-12-10" });
  assert.equal((await a.inquiry.getInvoice({ claims: a.claims, id: same.id })).dueDateOverridden, false);
  await a.act("cancel", same.id, { version: 1 });
  await assert.rejects(bare({ invoiceDate: "2023-11-10", dueDate: "2023-12-31" }), code("AR_INPUT_INVALID"));
  const changed = await bare({ invoiceDate: "2023-11-10", dueDate: "2023-12-31", dueDateReason: "客戶要求月底結算" });
  detail = await a.inquiry.getInvoice({ claims: a.claims, id: changed.id });
  assert.deepEqual([detail.dueDate, detail.dueDateOverridden, detail.dueDateReason], ["2023-12-31", true, "客戶要求月底結算"]);
  await a.act("cancel", changed.id, { version: 1 });

  // 同一訂單行較早一次出貨是 0 件（整行短揀）時，reader 仍把它列在 priorShipments；開票照常，金額與沒有那次出貨一樣。
  // 這個 fixture 造不出 0 件的出貨行，所以在真 reader 的結果上補一項，其餘（鎖、交易、寫入）全部照真。
  const zeroPrior = new ArInvoiceService({ ...a.invoices, readInvoiceSources: async (tx, input) => {
    const shipments = await readInvoiceSourcesInTransaction(tx, input);
    shipments[0].lines[0].priorShipments.unshift({ shipmentId: "1", shipmentLineId: "1", confirmationEventId: randomUUID(), confirmationSequence: 1, shippedBaseQuantity: "0" });
    return shipments;
  } });
  const short = await f.execute(() => zeroPrior.create({ claims: a.claims, input: { eventId: randomUUID(), shipmentIds: [Number(a.first)] } }));
  assert.equal(short.totalAmount, "3.0000");
  await a.act("cancel", short.id, { version: 1 });

  // 兩個同時送出的請求開同一張出貨：出貨列的鎖及唯一鍵令只有一個成功。
  const results = await Promise.allSettled([bare({}), bare({})]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "AR_SHIPMENT_ALREADY_INVOICED");
  assert.equal(await a.count("ar_invoices WHERE status = 'DRAFT'"), 1);
  assert.equal(await a.count("ar_invoice_lines WHERE active_shipment_line_id IS NOT NULL"), 1);

  // 這個 fixture 的連線池只有 2 條連線：兩個同時進行的命令各自只用自己交易的一條，所以都完成（交易內不另佔連線）。
  const [[order]] = await f.db.query("SELECT currency_code FROM sales_orders WHERE id = ?", [f.s.orderId]);
  const receipt = () => f.execute(() => a.receipts.create({ claims: a.claims, input: { eventId: randomUUID(), customerId: f.s.customerId, currencyCode: order.currency_code,
    receiptDate: TODAY, amount: "3.00", paymentMethod: "CASH" } }));
  assert.deepEqual((await Promise.all([receipt(), receipt()])).map((row) => row.status), ["DRAFT", "DRAFT"]);
});
