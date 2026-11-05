/** TASK-022：快照同 hash 嘅純邏輯，同唔使 DB 嘅輸入驗證。DB 約束同 trigger 喺 purchasingApprovals.integration.test.js。 */
import assert from "node:assert/strict";
import test from "node:test";

import { PurchaseApprovalService, approvalSnapshot, approvalSnapshotHash } from "../../src/modules/purchasing/PurchaseApprovalService.js";
import { PurchasingSettingsService } from "../../src/modules/purchasing/PurchasingSettingsService.js";

const po = { po_number: "PO-209911-000001", supplier_id: "3", supplier_code_snapshot: "S3", supplier_name_snapshot: "供應商", ordering_address_snapshot: '{"city":"HK"}', currency_code: "HKD",
  currency_name_snapshot: "港幣", currency_decimal_places_snapshot: 2, payment_term_snapshot: { code: "N30" }, order_date: "2099-11-01", expected_delivery_date: null,
  default_warehouse_code_snapshot: "", buyer_label: "採購員", supplier_reference: "", notes: "", subtotal_amount: "9007199254740993.0000", total_amount: "9007199254740993.0000" };
const line = { line_number: 1, sku_id: "7", sku_code_snapshot: "SKU7", sku_name_snapshot: "貨品", purchase_uom_code_snapshot: "BOX", ordered_quantity: "1.000000", base_uom_code_snapshot: "EA",
  ordered_base_quantity: "9007199254740993", unit_price: "1.0000", line_amount: "1.0000", zero_price_reason: "", expected_delivery_date: null, line_note: "" };
const actor = { id: 5, username: "buyer" };
const untouched = { query() { throw new Error("不應該打 DB"); } };

test("快照解開 JSON 欄位，大數字保持字串，缺付款條款同零價有提示", () => {
  const snapshot = approvalSnapshot(po, [line]);
  assert.deepEqual(snapshot.orderingAddress, { city: "HK" });
  assert.equal(snapshot.totalAmount, "9007199254740993.0000");
  assert.equal(snapshot.lines[0].orderedBaseQuantity, "9007199254740993");
  assert.deepEqual(snapshot.warnings, []);
  assert.deepEqual(approvalSnapshot({ ...po, payment_term_snapshot: null }, [{ ...line, unit_price: "0.0000", zero_price_reason: "樣品" }]).warnings, ["ZERO_PRICE", "NO_PAYMENT_TERM"]);
});

test("hash 唔受 JSON 欄位次序影響，但任何商業內容變都會變", () => {
  const snapshot = approvalSnapshot(po, [line]), hash = approvalSnapshotHash(snapshot);
  assert.match(hash, /^[0-9a-f]{64}$/u);
  const reordered = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(snapshot))).reverse());
  assert.equal(approvalSnapshotHash(reordered), hash);
  for (const changed of [{ ...po, total_amount: "1.0000" }, { ...po, supplier_name_snapshot: "另一間" }, { ...po, expected_delivery_date: "2099-12-01" }]) {
    assert.notEqual(approvalSnapshotHash(approvalSnapshot(changed, [line])), hash);
  }
  assert.notEqual(approvalSnapshotHash(approvalSnapshot(po, [{ ...line, unit_price: "2.0000" }])), hash);
});

test("HD-020：最長嘅合法 100 行快照超過舊 64KiB，但喺 1MiB 之內", () => {
  const long = (length) => "貨".repeat(length);
  const header = { ...po, supplier_code_snapshot: "S".repeat(64), supplier_name_snapshot: long(190), buyer_label: long(190), supplier_reference: long(190), notes: long(2000), currency_name_snapshot: long(100) };
  const lines = Array.from({ length: 100 }, (_, index) => ({ ...line, line_number: index + 1, sku_code_snapshot: long(190), sku_name_snapshot: long(190), purchase_uom_code_snapshot: long(50), base_uom_code_snapshot: long(50),
    zero_price_reason: long(500), line_note: long(1000) }));
  const size = Buffer.byteLength(JSON.stringify(approvalSnapshot(header, lines)), "utf8");
  assert.ok(size > 64 * 1024, `${size}`);
  assert.ok(size < 1024 * 1024, `${size}`);
});

test("提交：審批人唔可以係自己、ID 要合法；拒絕一定要原因；全部喺打 DB 之前", async () => {
  const service = new PurchaseApprovalService();
  const coded = (code, field) => (error) => { assert.equal(error.code, code); if (field) assert.equal(error.publicDetails?.field ?? error.details?.field, field); return true; };
  await assert.rejects(service.requestInTransaction(untouched, { purchaseOrderId: 1, version: 2, settingsVersion: 1, actor, approverId: 5, nowMs: 1 }), coded("PO_APPROVER_INVALID"));
  await assert.rejects(service.requestInTransaction(untouched, { purchaseOrderId: 1, version: 2, settingsVersion: 1, actor, approverId: "6", nowMs: 1 }), coded("PURCHASING_INPUT_INVALID"));
  for (const reason of [undefined, "", "太短", "   短   "]) {
    await assert.rejects(service.rejectInTransaction(untouched, { purchaseOrderId: 1, version: 2, actor, reason, nowMs: 1 }), coded("PURCHASING_INPUT_INVALID"));
  }
});

test("設定：未知欄位、非布林值、短原因喺 DB 之前拒絕，並寫 REJECTED audit", async () => {
  const rejected = [];
  const service = new PurchasingSettingsService({ time: { nowMs: () => 1 }, logger: { error() {} }, operations: { run() { throw new Error("不應該開 transaction"); } },
    database: { withTransaction: (work) => work("tx") }, audit: { recordRejected: async (tx, row) => rejected.push(row) } });
  const good = { eventId: "11111111-1111-4111-8111-111111111111", version: 1, requirePoApproval: true, reason: "開始需要審批" };
  for (const input of [{ ...good, extra: 1 }, { ...good, requirePoApproval: "true" }, { ...good, requirePoApproval: 1 }, { ...good, reason: "短" }, { ...good, version: 0 }, { ...good, eventId: "x" }]) {
    await assert.rejects(service.update({ claims: { sub: "9" }, input }), (error) => error.code === "PURCHASING_INPUT_INVALID");
  }
  assert.equal(rejected.length, 6);
  assert.deepEqual([...new Set(rejected.map(({ action, targetId, code }) => `${action}:${targetId}:${code}`))], ["purchasing.setting.updated:1:PURCHASING_INPUT_INVALID"]);
});
