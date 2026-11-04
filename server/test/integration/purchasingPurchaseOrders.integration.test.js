/**
 * TASK-014／TC-003：PurchaseOrderService Draft create／update 對真 MySQL（設計 §3.1、§5.2、§8.2；HD-015）。
 *
 * Supplier、Item、Business Master provider、sequence、operation 同 audit 全部用真 class。Operation／audit／sequence 有 trigger
 * 擋 DELETE，所以每個案例喺一個外層 transaction 入面做，最後 rollback；service 嘅 `withTransaction()` 用 SAVEPOINT 代替，
 * 失敗時 ROLLBACK TO SAVEPOINT，等「全有或全無」喺同一個外層 transaction 入面睇得到。主檔同月份（2099-11）都係測試專用。
 * 並發案例要真 commit 先證明到 PO 行鎖：佢用 HKD、唔建 Payment Term（TC-001 要求冇 Payment Term），完咗刪走 PO 同主檔；
 * 刪唔走嘅 operation、audit 同隨機 2100 年之後月份嘅 sequence 會留低。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";

import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { PurchaseOrderService } from "../../src/modules/purchasing/PurchaseOrderService.js";
import { PurchasingAuditService } from "../../src/modules/purchasing/PurchasingAuditService.js";
import { PurchasingOperationService } from "../../src/modules/purchasing/PurchasingOperationService.js";
import { PurchasingSequenceService } from "../../src/modules/purchasing/PurchasingSequenceService.js";
import { normalizePurchasingConfig } from "../../src/modules/purchasing/normalizePurchasingConfig.js";
import { BusinessMasterLookupProvider } from "../../src/modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierLookupService } from "../../src/modules/supplier/SupplierLookupService.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { createMySqlDatabasePool } from "../../src/services/mysqldatabase/connection.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { SystemTimeService } from "../../src/services/time/SystemTimeService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const ROLLBACK = Symbol("rollback");
const NOW = Date.UTC(2099, 10, 15, 4); // 2099-11-15 香港時間
const time = new SystemTimeService({ config: { application: { timeZone: "Asia/Hong_Kong" } }, options: { clock: () => new Date(NOW) } });
const silent = { async info() {}, async warn() {}, async debug() {}, async error() {} };

function database(t) {
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), socketPath: process.env.DB_SOCKET_PATH,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 5,
    waitForConnections: true, queueLimit: 10, acquireTimeoutMs: 5000, queryTimeoutMs: 10000, transactionTimeoutMs: 20000,
    abandonedConnectionAction: "destroy" };
  const pool = createMySqlDatabasePool(config);
  t.after(() => pool.end());
  return new MySqlDatabaseService({ pool, config, context: new RequestContextService({ services: { require: () => time } }), logger: silent });
}

/** Service 嘅 transaction 變成外層 transaction 入面嘅 SAVEPOINT。 */
function nested(tx) {
  return {
    async withTransaction(work) {
      await tx.query("SAVEPOINT purchase_order_test");
      try {
        const result = await work(tx);
        await tx.query("RELEASE SAVEPOINT purchase_order_test");
        return result;
      } catch (error) {
        await tx.query("ROLLBACK TO SAVEPOINT purchase_order_test");
        throw error;
      }
    }
  };
}

/** 外層 transaction 一定 rollback；work 入面 assertion 失敗會包成 DATABASE_TRANSACTION_FAILED，要拆返出嚟。 */
async function inRollback(db, work) {
  await assert.rejects(db.withTransaction(async (tx) => { await work(tx); throw ROLLBACK; }), (error) => {
    if (error.cause !== ROLLBACK) throw error.code === "DATABASE_TRANSACTION_FAILED" ? error.cause : error;
    return true;
  });
}

function service(db, tx, { audit = new PurchasingAuditService({ auditDetailMaxBytes: 8192 }), logger = silent } = {}) {
  const businessMaster = new BusinessMasterProvider({ database: db, repository: new BusinessMasterRepository() });
  const suppliers = new SupplierLookupService({ database: db, logger, time,
    businessMaster: new BusinessMasterLookupProvider({ provider: businessMaster, readiness: { inspect: async () => ({}) } }) });
  return new PurchaseOrderService({ database: nested(tx), logger, time, suppliers, businessMaster, audit,
    sequences: new PurchasingSequenceService(), operations: new PurchasingOperationService(), config: normalizePurchasingConfig() });
}

async function unusedCurrency(tx) {
  for (;;) {
    const code = `X${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
    const [rows] = await tx.query("SELECT code FROM currencies WHERE code = ?", [code]);
    if (!rows.length) return code;
  }
}

/** 喺外層 transaction 入面建立主檔；rollback 之後乜都唔留。 */
async function masters(tx) {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = NOW;
  const insert = async (table, row) => Number((await tx.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  const currency = await unusedCurrency(tx);
  await tx.query("INSERT INTO currencies SET ?", [{ code: currency, name: `Probe ${tag}`, decimal_places: 2, status: "ACTIVE",
    version: 1, created_at: now, updated_at: now }]);
  const user = (suffix, extra = {}) => insert("users", { username: `po_${suffix}_${tag}`, password_hash: "synthetic",
    created_at: now, updated_at: now, ...extra });
  const actorId = await user("actor");
  const role = await insert("roles", { name: `po_role_${tag}`, created_at: now });
  await tx.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = 'purchasing.mgmt'", [role]);
  await tx.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [actorId, role]);
  const buyer = await user("buyer", { display_name: "採購員 Probe" });
  const paymentTerm = await insert("payment_terms", { code: `PT${tag}`, code_key: `pt${tag}`, name: "Net 30", calculation_type: "NET_DAYS",
    due_days: 30, status: "ACTIVE", version: 1, created_at: now, updated_at: now });
  const supplier = (suffix, status = "active") => insert("suppliers", { supplier_code: `POS-${tag}-${suffix}`,
    supplier_code_key: `pos-${tag}-${suffix}`, supplier_name: `Supplier ${suffix}`, supplier_name_key: `supplier ${suffix}`,
    default_currency_code: currency, default_payment_term_id: paymentTerm, status, created_at: now, updated_at: now });
  const supplierA = await supplier("a"), supplierB = await supplier("b"), suspended = await supplier("s", "suspended");
  const address = (supplierId, extra = {}) => insert("supplier_addresses", { supplier_id: supplierId, label: "HQ", address_line1: "1 Probe Road",
    city: "Hong Kong", country_code: "HK", phone: "+852 0000", notes: "internal", created_at: now, updated_at: now, ...extra });
  const primaryAddress = await address(supplierA), otherAddress = await address(supplierA, { address_line1: "2 Side Road" });
  await tx.query(`INSERT INTO supplier_address_purposes (address_id, supplier_id, purpose_code, is_primary, created_at, updated_at)
    VALUES (?, ?, 'ordering', 1, ?, ?)`, [primaryAddress, supplierA, now, now]);
  const warehouse = await insert("inventory_warehouses", { warehouse_code: `W${tag}`, normalized_code: `w${tag}`, warehouse_name: "Probe",
    created_at: now, updated_at: now });
  const closedWarehouse = await insert("inventory_warehouses", { warehouse_code: `X${tag}`, normalized_code: `x${tag}`, warehouse_name: "Closed",
    status: "INACTIVE", created_at: now, updated_at: now });
  const item = await insert("items", { name: `Item ${tag}`, status: "active", created_at: now, updated_at: now });
  const uom = (code, status = "active") => insert("item_uoms", { code: `${code}${tag}`, name: code, status, created_at: now, updated_at: now });
  const each = await uom("EA"), box = await uom("BOX"), retired = await uom("OLD", "inactive");
  const sku = (suffix, extra = {}) => insert("item_skus", { item_id: item, sku_code: `SKU-${tag}-${suffix}`, sku_name: `SKU ${suffix}`,
    status: "active", min_receipt_life_days: 30, created_at: now, updated_at: now, ...extra });
  const mapping = (skuId, uomId, factor, extra = {}) => insert("item_sku_uoms", { sku_id: skuId, uom_id: uomId, to_base_factor: factor,
    created_at: now, updated_at: now, ...extra });
  const skuA = await sku("a", { tracking_policy: "batch_expiry" }), skuB = await sku("b"), serial = await sku("serial", { tracking_policy: "serial" });
  const unpurchasable = await sku("np", { purchasable: 0 }), untracked = await sku("nt", { inventory_tracked: 0 });
  const eachA = await mapping(skuA, each, 1, { is_base: 1 }), boxA = await mapping(skuA, box, 24), oldA = await mapping(skuA, retired, 6);
  const eachB = await mapping(skuB, each, 1, { is_base: 1 });
  for (const id of [serial, unpurchasable, untracked]) await mapping(id, each, 1, { is_base: 1 });
  const uomOf = async (skuId) => Number((await tx.query("SELECT id FROM item_sku_uoms WHERE sku_id = ? AND is_base = 1", [skuId]))[0][0].id);
  const claims = { sub: String(actorId), roles: [`po_role_${tag}`], permissions: ["purchasing.mgmt"] };
  return { tag, currency, actorId, claims, buyer, paymentTerm, supplierA, supplierB, suspended, primaryAddress, otherAddress, warehouse,
    closedWarehouse, each, box, skuA, skuB, serial, unpurchasable, untracked, eachA, boxA, oldA, eachB, uomOf };
}

function body(f, overrides = {}) {
  return { eventId: randomUUID(), supplierId: f.supplierA, orderingAddressId: f.primaryAddress, currencyCode: f.currency,
    paymentTermId: f.paymentTerm, orderDate: "2099-11-15", expectedDeliveryDate: "2099-11-30", defaultReceivingWarehouseId: f.warehouse,
    buyerId: f.buyer, supplierReference: "QUOTE-1", notes: "",
    lines: [
      { skuId: f.skuA, purchaseSkuUomId: f.boxA, orderedQuantity: "3", unitPrice: "10.005", lineNote: "boxes" },
      { skuId: f.skuB, purchaseSkuUomId: f.eachB, orderedQuantity: "2", unitPrice: "0", zeroPriceReason: "免費樣品 sample" }
    ],
    ...overrides };
}

const coded = (code, details) => (error) => {
  assert.equal(error.code, code, `${error.code}: ${error.message}`);
  if (details) assert.deepEqual(error.publicDetails, details);
  return true;
};
const order = async (tx, id) => (await tx.query("SELECT * FROM purchase_orders WHERE id = ?", [id]))[0][0];
const lines = async (tx, id) => (await tx.query("SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number", [id]))[0];
const audits = async (tx, actorId) => (await tx.query(
  "SELECT action, outcome, target_id, target_label, detail FROM purchasing_audit_logs WHERE actor_user_id = ? ORDER BY id", [actorId]))[0];
const operationsOf = async (tx, actorId) => (await tx.query(
  "SELECT command_type, source_document_id, result_summary, completed_at FROM purchasing_operation_requests WHERE actor_user_id = ? ORDER BY id", [actorId]))[0];
const inventoryCounts = async (tx) => (await tx.query(`SELECT (SELECT COUNT(*) FROM inventory_movements) movements,
  (SELECT COUNT(*) FROM inventory_stock_balances) balances, (SELECT COUNT(*) FROM inventory_operation_requests) operations`))[0][0];
/** 更新請求：用現有 Line 嘅 ID 同 version。 */
const editable = (f, current, rows, overrides = {}) => body(f, { version: current.version, lines: rows.map((row) => ({ id: Number(row.id),
  skuId: Number(row.sku_id), purchaseSkuUomId: Number(row.purchase_sku_uom_id), orderedQuantity: row.ordered_quantity, unitPrice: row.unit_price,
  zeroPriceReason: row.zero_price_reason, lineNote: row.line_note })), ...overrides });

integrationTest("create 拎月度編號、server 計快照同金額、operation 同 Audit 一齊寫，而 Inventory 唔郁", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), inventory = await inventoryCounts(tx), input = body(f);
    const result = await service(db, tx).create({ claims: f.claims, input, context: { requestId: "req-1", ip: "127.0.0.1" } });
    assert.match(result.number, /^PO-209911-\d{6}$/u);
    assert.deepEqual({ ...result, id: 0, number: "" }, { id: 0, number: "", status: "DRAFT", version: 1, warnings: [], replayed: false });

    const header = await order(tx, result.id);
    assert.equal(header.po_number, result.number);
    assert.equal(header.status, "DRAFT");
    assert.equal(header.supplier_code_snapshot, `POS-${f.tag}-a`);
    assert.equal(header.supplier_name_snapshot, "Supplier a");
    assert.equal(header.currency_name_snapshot, `Probe ${f.tag}`);
    assert.equal(header.currency_decimal_places_snapshot, 2);
    assert.deepEqual(header.ordering_address_snapshot, { addressLine1: "1 Probe Road", addressLine2: "", addressLine3: "", city: "Hong Kong",
      stateRegion: "", postalCode: "", countryCode: "HK", phone: "+852 0000" });
    assert.deepEqual(header.payment_term_snapshot, { code: `PT${f.tag}`, name: "Net 30", calculationType: "NET_DAYS", dueDays: 30 });
    assert.equal(header.default_warehouse_code_snapshot, `W${f.tag}`);
    assert.equal(header.buyer_label, "採購員 Probe");
    assert.equal(header.created_by, f.actorId);
    // 3 × 10.005 = 30.015 → 30.02（HALF_UP）；零價 Line 金額 0；Total = 已 round Line 之和。
    assert.equal(header.total_amount, "30.0200");
    assert.equal(header.subtotal_amount, "30.0200");

    const [boxLine, freeLine] = await lines(tx, result.id);
    assert.equal(boxLine.ordered_quantity, "3.000000");
    assert.equal(Number(boxLine.ordered_base_quantity), 72);
    assert.equal(boxLine.uom_to_base_factor_snapshot, 24);
    assert.equal(Number(boxLine.base_uom_id), f.each);
    assert.equal(boxLine.tracking_policy_snapshot, "batch_expiry");
    assert.equal(boxLine.minimum_receipt_life_days_snapshot, 30);
    assert.equal(boxLine.unit_price, "10.0050");
    assert.equal(boxLine.line_amount, "30.0200");
    assert.equal(boxLine.supplier_sku_ref_id, null);
    assert.equal(boxLine.supplier_item_code_snapshot, "");
    assert.equal(freeLine.line_amount, "0.0000");
    assert.equal(freeLine.zero_price_reason, "免費樣品 sample");
    assert.equal(Number(freeLine.ordered_base_quantity), 2);

    const [operation] = await operationsOf(tx, f.actorId);
    assert.equal(operation.command_type, "CREATE_PURCHASE_ORDER");
    assert.deepEqual(operation.result_summary, { id: result.id, number: result.number, status: "DRAFT", version: 1 });
    assert.deepEqual(await audits(tx, f.actorId), [{ action: "purchase_order.created", outcome: "SUCCEEDED", target_id: result.id,
      target_label: result.number, detail: { version: 1, lineCount: 2, totalAmount: "30.02", currencyCode: f.currency } }]);
    assert.deepEqual(await inventoryCounts(tx), inventory);
  });
});

integrationTest("同一 eventId 同內容 replay 唔會再建；唔同內容係衝突並寫 REJECTED audit", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), po = service(db, tx), input = body(f);
    const first = await po.create({ claims: f.claims, input });
    const again = await po.create({ claims: f.claims, input: structuredClone(input) });
    assert.deepEqual(again, { id: first.id, number: first.number, status: "DRAFT", version: 1, warnings: [], replayed: true });
    await assert.rejects(po.create({ claims: f.claims, input: { ...input, notes: "changed" } }), coded("PURCHASING_EVENT_CONFLICT"));
    const [[{ count }]] = await tx.query("SELECT COUNT(*) count FROM purchase_orders WHERE created_by = ?", [f.actorId]);
    assert.equal(Number(count), 1);
    assert.deepEqual((await audits(tx, f.actorId)).map(({ action, outcome, detail }) => [action, outcome, detail]), [
      ["purchase_order.created", "SUCCEEDED", { version: 1, lineCount: 2, totalAmount: "30.02", currencyCode: f.currency }],
      ["purchasing.operation_conflict", "REJECTED", { code: "PURCHASING_EVENT_CONFLICT" }]]);
  });
});

integrationTest("update 完整取代 Lines：保留 ID、重排、刪除、新增，重算 Total 同 version", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), po = service(db, tx);
    const created = await po.create({ claims: f.claims, input: body(f) });
    const [boxLine] = await lines(tx, created.id);
    await tx.query("UPDATE purchase_order_lines SET created_at = 1 WHERE id = ?", [boxLine.id]);
    const input = body(f, { version: 1, orderingAddressId: null, paymentTermId: null, defaultReceivingWarehouseId: null, expectedDeliveryDate: null,
      notes: "第二版", lines: [
        { skuId: f.skuB, purchaseSkuUomId: f.eachB, orderedQuantity: "2", unitPrice: "1.25" },
        { id: Number(boxLine.id), skuId: f.skuA, purchaseSkuUomId: f.eachA, orderedQuantity: "5", unitPrice: "3" }
      ] });
    const updated = await po.update({ claims: f.claims, purchaseOrderId: created.id, input });
    assert.deepEqual(updated, { id: created.id, number: created.number, status: "DRAFT", version: 2, warnings: [], replayed: false });

    const header = await order(tx, created.id);
    assert.equal(header.version, 2);
    assert.equal(header.total_amount, "17.5000");
    assert.equal(header.notes, "第二版");
    assert.equal(header.ordering_address_id, null);
    assert.equal(header.ordering_address_snapshot, null);
    assert.equal(header.payment_term_snapshot, null);
    assert.equal(header.default_warehouse_code_snapshot, "");
    assert.equal(header.created_at, NOW);
    const rows = await lines(tx, created.id);
    assert.deepEqual(rows.map((row) => [row.line_number, Number(row.sku_id), row.line_amount]), [[1, f.skuB, "2.5000"], [2, f.skuA, "15.0000"]]);
    assert.ok(Number(rows[0].id) > Number(boxLine.id), "新 Line 有新 ID");
    assert.equal(Number(rows[1].id), Number(boxLine.id));
    assert.equal(rows[1].version, 2);
    assert.equal(rows[1].created_at, 1, "保留 Line 嘅建立時間");
    assert.equal(rows[1].uom_to_base_factor_snapshot, 1);
    assert.equal(Number(rows[1].ordered_base_quantity), 5);
    const last = (await audits(tx, f.actorId)).at(-1);
    assert.equal(last.action, "purchase_order.updated");
    assert.deepEqual(last.detail, { version: 2, lineCount: 2, totalAmount: "17.50", currencyCode: f.currency });
    assert.equal((await operationsOf(tx, f.actorId)).at(-1).source_document_id, String(created.id));
  });
});

integrationTest("update 拒絕過時 version、外來 child ID、非 Draft 同唔存在嘅 PO，乜都唔改並寫 REJECTED audit", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), po = service(db, tx);
    const created = await po.create({ claims: f.claims, input: body(f) });
    const other = await po.create({ claims: f.claims, input: body(f) });
    const before = await lines(tx, created.id), foreign = (await lines(tx, other.id))[0];
    const current = await order(tx, created.id);
    await po.update({ claims: f.claims, purchaseOrderId: created.id, input: editable(f, current, before, { notes: "first" }) });

    // AC-010：第二個人用舊 version 保存。
    await assert.rejects(po.update({ claims: f.claims, purchaseOrderId: created.id, input: editable(f, current, before, { notes: "second" }) }),
      coded("VERSION_CONFLICT", { currentVersion: 2 }));
    const fresh = await order(tx, created.id);
    assert.equal(fresh.notes, "first");
    const foreignLine = editable(f, fresh, [...before, foreign]);
    await assert.rejects(po.update({ claims: f.claims, purchaseOrderId: created.id, input: foreignLine }), coded("PURCHASE_ORDER_NOT_FOUND"));
    await assert.rejects(po.update({ claims: f.claims, purchaseOrderId: 2 ** 40, input: editable(f, fresh, []) }), coded("PURCHASING_INPUT_INVALID"));
    await assert.rejects(po.update({ claims: f.claims, purchaseOrderId: 2 ** 40, input: editable(f, fresh, before) }), coded("PURCHASE_ORDER_NOT_FOUND"));
    await tx.query("UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = ?", [created.id]);
    await assert.rejects(po.update({ claims: f.claims, purchaseOrderId: created.id, input: editable(f, fresh, before) }), coded("PO_STATE_CONFLICT"));

    assert.equal((await order(tx, created.id)).version, 2);
    assert.deepEqual((await lines(tx, created.id)).map((row) => Number(row.id)), before.map((row) => Number(row.id)));
    assert.deepEqual((await audits(tx, f.actorId)).filter((row) => row.outcome === "REJECTED")
      .map(({ action, target_id: target, detail }) => [action, target, detail.code]), [
      ["purchase_order.updated", created.id, "VERSION_CONFLICT"],
      ["purchase_order.updated", created.id, "PURCHASE_ORDER_NOT_FOUND"],
      ["purchase_order.updated", 2 ** 40, "PURCHASING_INPUT_INVALID"],
      ["purchase_order.updated", 2 ** 40, "PURCHASE_ORDER_NOT_FOUND"],
      ["purchase_order.updated", created.id, "PO_STATE_CONFLICT"]]);
    // 被拒絕嘅 update 冇留低 claim：只有兩個 create 同一個 update 完成。
    assert.deepEqual((await operationsOf(tx, f.actorId)).map((row) => row.command_type),
      ["CREATE_PURCHASE_ORDER", "CREATE_PURCHASE_ORDER", "UPDATE_PURCHASE_ORDER"]);
  });
});

integrationTest("新揀嘅 Supplier、SKU、UOM、地址、倉、Buyer 同 Currency 一定要當下合格；冇 Supplier-SKU relation 唔阻", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), po = service(db, tx);
    const [[{ relations }]] = await tx.query("SELECT COUNT(*) relations FROM supplier_sku_refs WHERE sku_id IN (?, ?)", [f.skuA, f.skuB]);
    assert.equal(Number(relations), 0);
    const line = (skuId, purchaseSkuUomId, extra = {}) => ({ lines: [{ skuId, purchaseSkuUomId, orderedQuantity: "1", unitPrice: "1", ...extra }] });
    const cases = [
      [{ supplierId: f.suspended, orderingAddressId: null }, "SUPPLIER_NOT_PURCHASABLE", "supplierId"],
      [{ supplierId: 2 ** 40, orderingAddressId: null }, "SUPPLIER_NOT_PURCHASABLE", "supplierId"],
      [line(f.serial, await f.uomOf(f.serial)), "SKU_NOT_PURCHASABLE", "lines.0.skuId"],
      [line(f.unpurchasable, await f.uomOf(f.unpurchasable)), "SKU_NOT_PURCHASABLE", "lines.0.skuId"],
      [line(f.untracked, await f.uomOf(f.untracked)), "SKU_NOT_PURCHASABLE", "lines.0.skuId"],
      [line(2 ** 40, f.eachA), "SKU_NOT_PURCHASABLE", "lines.0.skuId"],
      [line(f.skuA, f.oldA), "SKU_NOT_PURCHASABLE", "lines.0.purchaseSkuUomId"],
      [line(f.skuA, f.eachB), "PURCHASING_INPUT_INVALID", "lines.0.purchaseSkuUomId"],
      [line(f.skuA, f.boxA, { orderedQuantity: "0.01" }), "UOM_CONVERSION_INVALID", "lines.0.orderedQuantity"],
      [{ orderingAddressId: f.otherAddress }, "PURCHASING_INPUT_INVALID", "orderingAddressId"],
      [{ supplierId: f.supplierB }, "PURCHASING_INPUT_INVALID", "orderingAddressId"],
      [{ defaultReceivingWarehouseId: f.closedWarehouse }, "WAREHOUSE_INVALID", "defaultReceivingWarehouseId"],
      [{ buyerId: f.actorId + 1e6 }, "PURCHASING_INPUT_INVALID", "buyerId"]
    ];
    for (const [overrides, code, field] of cases) {
      await assert.rejects(po.create({ claims: f.claims, input: body(f, overrides) }), coded(code, { field }), JSON.stringify(overrides));
    }
    await tx.query("UPDATE users SET status = 'disabled' WHERE id = ?", [f.buyer]);
    await assert.rejects(po.create({ claims: f.claims, input: body(f) }), coded("PURCHASING_INPUT_INVALID", { field: "buyerId" }));
    await tx.query("UPDATE users SET status = 'active' WHERE id = ?", [f.buyer]);
    await tx.query("UPDATE currencies SET status = 'INACTIVE' WHERE code = ?", [f.currency]);
    await assert.rejects(po.create({ claims: f.claims, input: body(f, { orderingAddressId: null }) }), coded("CURRENCY_NOT_ACTIVE"));
    await tx.query("UPDATE currencies SET status = 'ACTIVE' WHERE code = ?", [f.currency]);
    // 快照上限 2048 bytes（§4.5）：三行 190 個 4-byte 字。
    await tx.query("UPDATE supplier_addresses SET address_line1 = ?, address_line2 = ?, address_line3 = ? WHERE id = ?",
      ["𠀀".repeat(190), "𠀀".repeat(190), "𠀀".repeat(190), f.primaryAddress]);
    await assert.rejects(po.create({ claims: f.claims, input: body(f) }), coded("PURCHASING_INPUT_INVALID", { field: "orderingAddressId" }));
    await tx.query("UPDATE supplier_addresses SET address_line1 = '1 Probe Road', address_line2 = '', address_line3 = '' WHERE id = ?", [f.primaryAddress]);

    const [[{ count }]] = await tx.query("SELECT COUNT(*) count FROM purchase_orders WHERE created_by = ?", [f.actorId]);
    assert.equal(Number(count), 0);
    assert.equal((await audits(tx, f.actorId)).length, cases.length + 3);
    // 冇 relation 嘅 Active Supplier 照揀得（FR-PO-002、AC-003）。
    const created = await po.create({ claims: f.claims, input: body(f, { supplierId: f.supplierB, orderingAddressId: null }) });
    assert.equal(Number((await order(tx, created.id)).supplier_id), f.supplierB);
  });
});

integrationTest("Update 時冇郁而之後先失效嘅 Supplier／SKU 照存並回 warning；新揀或者換咗就拒絕（HD-015 1B）", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), po = service(db, tx);
    const created = await po.create({ claims: f.claims, input: body(f) });
    await tx.query("UPDATE suppliers SET status = 'suspended' WHERE id = ?", [f.supplierA]);
    await tx.query("UPDATE item_skus SET purchasable = 0 WHERE id = ?", [f.skuA]);
    let current = await order(tx, created.id), rows = await lines(tx, created.id);

    const saved = await po.update({ claims: f.claims, purchaseOrderId: created.id, input: editable(f, current, rows, { notes: "只改備註" }) });
    assert.deepEqual(saved.warnings, [{ code: "SUPPLIER_NOT_PURCHASABLE" }, { code: "SKU_NOT_PURCHASABLE", lineNumber: 1 }]);
    const header = await order(tx, created.id);
    assert.equal(header.notes, "只改備註");
    assert.deepEqual(header.ordering_address_snapshot, current.ordering_address_snapshot);

    current = header;
    rows = await lines(tx, created.id);
    const rejectedWith = async (input, code, field) => assert.rejects(po.update({ claims: f.claims, purchaseOrderId: created.id, input }),
      coded(code, { field }));
    // 換 Purchase UOM、新加同一個 SKU 嘅 Line、為失效 Supplier 揀新地址、換去另一個失效 Supplier：都係新選擇。
    const [boxLine, freeLine] = editable(f, current, rows).lines;
    await rejectedWith(editable(f, current, rows, { lines: [{ ...boxLine, purchaseSkuUomId: f.eachA }, freeLine] }), "SKU_NOT_PURCHASABLE", "lines.0.skuId");
    await rejectedWith(editable(f, current, rows, { lines: [boxLine, freeLine, { ...boxLine, id: undefined }] }), "SKU_NOT_PURCHASABLE", "lines.2.skuId");
    await rejectedWith(editable(f, current, rows, { orderingAddressId: f.otherAddress }), "SUPPLIER_NOT_PURCHASABLE", "orderingAddressId");
    await rejectedWith(editable(f, current, rows, { supplierId: f.suspended, orderingAddressId: null }), "SUPPLIER_NOT_PURCHASABLE", "supplierId");
    // 換去 Active Supplier 就唔再有 Supplier warning。
    const moved = await po.update({ claims: f.claims, purchaseOrderId: created.id,
      input: editable(f, current, rows, { supplierId: f.supplierB, orderingAddressId: null }) });
    assert.deepEqual(moved.warnings, [{ code: "SKU_NOT_PURCHASABLE", lineNumber: 1 }]);
    // Serial 喺 DB 快照存唔到，就算冇郁都要擋。
    await tx.query("UPDATE item_skus SET tracking_policy = 'serial' WHERE id = ?", [f.skuA]);
    current = await order(tx, created.id);
    await rejectedWith(editable(f, current, await lines(tx, created.id), { supplierId: f.supplierB, orderingAddressId: null }),
      "SKU_NOT_PURCHASABLE", "lines.0.skuId");
  });
});

integrationTest("Audit 失敗令成單 rollback；權限過時被拒；REJECTED audit 寫唔到就記 security log", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx);
    const failing = new PurchasingAuditService({ auditDetailMaxBytes: 8192 });
    failing.record = async () => { throw new TypeError("audit down"); };
    const [[sequenceBefore]] = await tx.query("SELECT COALESCE(MAX(next_value), 0) next FROM purchasing_document_sequences WHERE document_type = 'PO' AND `year_month` = '209911'");
    await assert.rejects(service(db, tx, { audit: failing }).create({ claims: f.claims, input: body(f) }), /audit down/u);
    const [[{ count }]] = await tx.query("SELECT COUNT(*) count FROM purchase_orders WHERE created_by = ?", [f.actorId]);
    assert.equal(Number(count), 0);
    assert.deepEqual(await operationsOf(tx, f.actorId), []);
    const [[sequenceAfter]] = await tx.query("SELECT COALESCE(MAX(next_value), 0) next FROM purchasing_document_sequences WHERE document_type = 'PO' AND `year_month` = '209911'");
    assert.deepEqual(sequenceAfter, sequenceBefore);
    // 5xx 嘅 ApplicationError（依賴未準備好）都唔係「拒絕」。
    const unready = service(db, tx);
    unready.suppliers.businessMaster = null;
    await assert.rejects(unready.create({ claims: f.claims, input: body(f) }), coded("BUSINESS_MASTER_NOT_READY"));
    assert.deepEqual(await audits(tx, f.actorId), [], "非 4xx 失敗唔當 REJECTED");

    const po = service(db, tx);
    await assert.rejects(po.create({ claims: { ...f.claims, permissions: [] }, input: body(f) }), coded("PERMISSION_STALE"));
    await tx.query("DELETE FROM user_roles WHERE user_id = ?", [f.actorId]);
    await assert.rejects(po.create({ claims: { ...f.claims, roles: [], permissions: [] }, input: body(f) }), coded("PERMISSION_STALE"));
    assert.deepEqual((await audits(tx, f.actorId)).map((row) => [row.outcome, row.detail.code]),
      [["REJECTED", "PERMISSION_STALE"], ["REJECTED", "PERMISSION_STALE"]]);

    const logged = [];
    const logger = { ...silent, async error(event, message, details) { logged.push({ event, details }); } };
    await assert.rejects(service(db, tx, { logger }).create({ claims: { ...f.claims, sub: String(f.actorId + 1e6) }, input: body(f) }),
      coded("PERMISSION_STALE"));
    assert.deepEqual(logged, [{ event: "purchasing.audit.rejected_not_persisted", details: { action: "purchase_order.created",
      code: "PERMISSION_STALE", auditErrorCode: "TypeError", requestId: null, correlationId: null } }]);
  });
});

/** 已 commit 嘅最少主檔：actor 兼 Buyer、HKD Supplier、一個 SKU。 */
async function committedMasters(db) {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now();
  const insert = async (table, row) => Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  const actorId = await insert("users", { username: `po_race_${tag}`, password_hash: "synthetic", created_at: now, updated_at: now });
  const role = await insert("roles", { name: `po_race_${tag}`, created_at: now });
  await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = 'purchasing.mgmt'", [role]);
  await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [actorId, role]);
  const supplierId = await insert("suppliers", { supplier_code: `POR-${tag}`, supplier_code_key: `por-${tag}`, supplier_name: "Race",
    supplier_name_key: "race", default_currency_code: "HKD", status: "active", created_at: now, updated_at: now });
  const item = await insert("items", { name: `Race ${tag}`, status: "active", created_at: now, updated_at: now });
  const uom = await insert("item_uoms", { code: `R${tag}`, name: "Each", created_at: now, updated_at: now });
  const skuId = await insert("item_skus", { item_id: item, sku_code: `RACE-${tag}`, sku_name: "Race", status: "active", created_at: now, updated_at: now });
  const skuUomId = await insert("item_sku_uoms", { sku_id: skuId, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
  const cleanup = async () => {
    await db.query("DELETE FROM purchase_order_lines WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE created_by = ?)", [actorId]);
    await db.query("DELETE FROM purchase_orders WHERE created_by = ?", [actorId]);
    for (const [sql, id] of [["DELETE FROM item_sku_uoms WHERE id = ?", skuUomId], ["DELETE FROM item_skus WHERE id = ?", skuId],
      ["DELETE FROM items WHERE id = ?", item], ["DELETE FROM item_uoms WHERE id = ?", uom], ["DELETE FROM suppliers WHERE id = ?", supplierId],
      ["DELETE FROM user_roles WHERE user_id = ?", actorId], ["DELETE FROM role_permissions WHERE role_id = ?", role],
      ["DELETE FROM roles WHERE id = ?", role], ["DELETE FROM users WHERE id = ?", actorId]]) await db.query(sql, [id]);
  };
  return { actorId, supplierId, skuId, skuUomId, cleanup, claims: { sub: String(actorId), roles: [`po_race_${tag}`], permissions: ["purchasing.mgmt"] } };
}

integrationTest("兩個人同時用同一 version 保存：PO 行鎖令第二個人收到 VERSION_CONFLICT，唔會覆蓋（AC-010）", async (t) => {
  const db = database(t), f = await committedMasters(db);
  // 隨機遠期月份：sequence row commit 咗之後刪唔走，唔可以撞其他案例嘅月份。
  const month = Date.UTC(2100 + Math.floor(Math.random() * 7900), 6, 15);
  const clock = new SystemTimeService({ config: { application: { timeZone: "Asia/Hong_Kong" } }, options: { clock: () => new Date(month) } });
  const businessMaster = new BusinessMasterProvider({ database: db, repository: new BusinessMasterRepository() });
  const po = new PurchaseOrderService({ database: db, logger: silent, time: clock, businessMaster, audit: new PurchasingAuditService({ auditDetailMaxBytes: 8192 }),
    suppliers: new SupplierLookupService({ database: db, logger: silent, time: clock }), sequences: new PurchasingSequenceService(),
    operations: new PurchasingOperationService(), config: normalizePurchasingConfig() });
  const draft = (notes, unitPrice) => ({ eventId: randomUUID(), supplierId: f.supplierId, currencyCode: "HKD", orderDate: "2099-11-15",
    buyerId: f.actorId, notes, lines: [{ skuId: f.skuId, purchaseSkuUomId: f.skuUomId, orderedQuantity: "1", unitPrice }] });
  const blocker = await db.pool.getConnection();
  // 睇 lock wait 要 performance_schema 權限，應用帳戶冇；用 CI 嘅 fixture 管理員，只讀。
  const observer = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD });
  try {
    const created = await po.create({ claims: f.claims, input: draft("v1", "1") });
    // 先由第三條連線鎖住 PO，等兩個 update 都排隊，先放手。
    await blocker.query("START TRANSACTION");
    await blocker.query("SELECT id FROM purchase_orders WHERE id = ? FOR UPDATE", [created.id]);
    const save = (notes, price) => po.update({ claims: f.claims, purchaseOrderId: created.id, input: { ...draft(notes, price), version: 1 } })
      .then((value) => ({ value }), (error) => ({ error }));
    const outcomes = [save("A", "2"), save("B", "3")];
    const limit = Date.now() + 10000;
    for (;;) {
      const [[{ waits }]] = await observer.query(`SELECT COUNT(*) waits FROM performance_schema.data_lock_waits w
        JOIN performance_schema.data_locks l ON l.engine_lock_id = w.blocking_engine_lock_id
        WHERE l.object_schema = ? AND l.object_name = 'purchase_orders'`, [process.env.DB_NAME]);
      if (Number(waits) >= 2) break;
      assert.ok(Date.now() < limit, "兩個 update 都要等緊 PO 行鎖");
      await delay(20);
    }
    await blocker.query("COMMIT");
    const results = await Promise.all(outcomes);
    const won = results.filter((result) => result.value), lost = results.filter((result) => result.error);
    assert.equal(won.length, 1, JSON.stringify(results.map((result) => result.error?.code ?? "ok")));
    assert.equal(lost[0].error.code, "VERSION_CONFLICT");
    assert.deepEqual(lost[0].error.publicDetails, { currentVersion: 2 });
    const [[header]] = await db.query("SELECT version, notes, total_amount FROM purchase_orders WHERE id = ?", [created.id]);
    const winner = results.indexOf(won[0]) === 0 ? { notes: "A", total: "2.0000" } : { notes: "B", total: "3.0000" };
    assert.deepEqual({ ...header }, { version: 2, notes: winner.notes, total_amount: winner.total });
  } finally {
    await blocker.query("ROLLBACK").catch(() => {});
    blocker.release();
    await observer.end();
    await f.cleanup();
  }
});

integrationTest("copy 建新編號、新 ID 嘅 Draft，唔抄狀態、進度同舊資格；來源唔郁，operation 同 Audit 指返來源", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const source = await orders.create({ claims: f.claims, input: body(f, { orderDate: "2099-11-01", supplierReference: "QUOTE-9", notes: "抄我" }) });
    const [first, second] = await lines(tx, source.id);
    await tx.query("UPDATE purchase_order_lines SET gross_received_base_quantity = 5, net_received_base_quantity = 5, has_outstanding = 0, is_over_received = 1 WHERE id = ?", [first.id]);
    await tx.query("UPDATE purchase_orders SET status = 'PARTIALLY_RECEIVED', has_confirmed_receipt = 1, has_outstanding = 0, confirmed_at = ?, version = 7 WHERE id = ?", [NOW, source.id]);
    const before = JSON.stringify([await order(tx, source.id), await lines(tx, source.id)]), inventory = await inventoryCounts(tx);

    const input = { eventId: randomUUID() }, result = await orders.copy({ claims: f.claims, purchaseOrderId: source.id, input, context: { requestId: "req-c", ip: "127.0.0.1" } });
    assert.deepEqual({ ...result, id: 0, number: "" }, { id: 0, number: "", status: "DRAFT", version: 1, warnings: [], replayed: false });
    assert.notEqual(result.id, source.id);
    assert.notEqual(result.number, source.number);

    const header = await order(tx, result.id), copied = await lines(tx, result.id);
    assert.deepEqual({ status: header.status, version: header.version, confirmedAt: header.confirmed_at, receipt: header.has_confirmed_receipt, outstanding: header.has_outstanding },
      { status: "DRAFT", version: 1, confirmedAt: null, receipt: 0, outstanding: 1 });
    assert.equal(header.created_by, f.actorId);
    assert.equal(header.supplier_id, f.supplierA);
    assert.equal(header.ordering_address_id, f.primaryAddress);
    assert.equal(header.payment_term_id, f.paymentTerm);
    assert.equal(header.default_receiving_warehouse_id, f.warehouse);
    assert.equal(header.buyer_id, f.buyer);
    assert.deepEqual([header.supplier_reference, header.notes, header.total_amount], ["QUOTE-9", "抄我", "30.0200"]);
    const [[{ orderDate }]] = await tx.query("SELECT DATE_FORMAT(order_date, '%Y-%m-%d') AS orderDate FROM purchase_orders WHERE id = ?", [result.id]);
    assert.equal(orderDate, "2099-11-15", "Order Date 用今日，唔抄來源");
    assert.equal(copied.length, 2);
    assert.ok(copied.every((row) => ![first.id, second.id].includes(row.id)), "新 Line ID");
    assert.deepEqual(copied.map((row) => [row.line_number, row.version, Number(row.gross_received_base_quantity), Number(row.net_received_base_quantity), row.has_outstanding, row.is_over_received]),
      [[1, 1, 0, 0, 1, 0], [2, 1, 0, 0, 1, 0]]);
    assert.deepEqual(copied.map((row) => [row.sku_id, row.purchase_sku_uom_id, row.ordered_quantity, row.unit_price, row.zero_price_reason, row.line_note]),
      [[f.skuA, f.boxA, "3.000000", "10.0050", "", "boxes"], [f.skuB, f.eachB, "2.000000", "0.0000", "免費樣品 sample", ""]]);
    assert.equal(JSON.stringify([await order(tx, source.id), await lines(tx, source.id)]), before, "來源完全唔郁");
    assert.deepEqual(await inventoryCounts(tx), inventory);

    const audit = (await audits(tx, f.actorId)).at(-1);
    assert.deepEqual([audit.action, audit.outcome, audit.target_id], ["purchase_order.copied", "SUCCEEDED", result.id]);
    assert.equal(audit.detail.sourcePurchaseOrderId, source.id);
    const operation = (await operationsOf(tx, f.actorId)).at(-1);
    assert.deepEqual([operation.command_type, operation.source_document_id], ["COPY_PURCHASE_ORDER", String(source.id)]);

    const replay = await orders.copy({ claims: f.claims, purchaseOrderId: source.id, input });
    assert.deepEqual(replay, { id: result.id, number: result.number, status: "DRAFT", version: 1, warnings: [], replayed: true });
    const [[{ total }]] = await tx.query("SELECT COUNT(*) AS total FROM purchase_orders WHERE created_by = ?", [f.actorId]);
    assert.equal(total, 2, "Replay 唔會多建一張");
  });
});

integrationTest("copy 只抄仍然合法嘅值：選填主檔清空、Buyer 換操作者、唔合格 Line 剔走，全部有 warning（HD-017 2A）", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const source = await orders.create({ claims: f.claims, input: body(f, { orderDate: "2099-11-01", expectedDeliveryDate: "2099-11-10", lines: [
      { skuId: f.skuA, purchaseSkuUomId: f.boxA, orderedQuantity: "1", unitPrice: "1", expectedDeliveryDate: "2099-11-02" },
      { skuId: f.skuA, purchaseSkuUomId: f.eachA, orderedQuantity: "2", unitPrice: "1", expectedDeliveryDate: "2099-12-01" },
      { skuId: f.skuB, purchaseSkuUomId: f.eachB, orderedQuantity: "3", unitPrice: "1" }] }) });

    await tx.query("UPDATE supplier_address_purposes SET is_primary = 0 WHERE address_id = ?", [f.primaryAddress]);
    const addressOnly = await orders.copy({ claims: f.claims, purchaseOrderId: source.id, input: { eventId: randomUUID() } });
    assert.deepEqual(addressOnly.warnings.filter((warning) => warning.lineNumber === undefined).map((warning) => warning.field),
      ["orderingAddressId", "expectedDeliveryDate"], "已經唔係主要訂購地址就清空，其他值照抄");
    assert.equal((await order(tx, addressOnly.id)).payment_term_id, f.paymentTerm);
    await tx.query("UPDATE supplier_address_purposes SET is_primary = 1 WHERE address_id = ?", [f.primaryAddress]);

    await tx.query("UPDATE payment_terms SET status = 'INACTIVE' WHERE id = ?", [f.paymentTerm]);
    await tx.query("UPDATE inventory_warehouses SET status = 'INACTIVE' WHERE id = ?", [f.warehouse]);
    await tx.query("UPDATE users SET status = 'disabled' WHERE id = ?", [f.buyer]);
    await tx.query("UPDATE item_skus SET purchasable = 0 WHERE id = ?", [f.skuB]);
    await tx.query("UPDATE item_sku_uoms SET to_base_factor = 7 WHERE id = ?", [f.boxA]);

    const result = await orders.copy({ claims: f.claims, purchaseOrderId: source.id, input: { eventId: randomUUID() } });
    assert.deepEqual(result.warnings, [
      { code: "COPY_FIELD_CHANGED", field: "orderingAddressId" }, { code: "COPY_FIELD_CHANGED", field: "paymentTermId" },
      { code: "COPY_FIELD_CHANGED", field: "defaultReceivingWarehouseId" }, { code: "COPY_FIELD_CHANGED", field: "buyerId" },
      { code: "COPY_FIELD_CHANGED", field: "expectedDeliveryDate", lineNumber: 1 }, { code: "COPY_LINE_DROPPED", lineNumber: 3 },
      { code: "COPY_FIELD_CHANGED", field: "expectedDeliveryDate" }
    ]);
    const header = await order(tx, result.id), copied = await lines(tx, result.id);
    assert.deepEqual([header.ordering_address_id, header.ordering_address_snapshot, header.payment_term_id, header.payment_term_snapshot, header.default_receiving_warehouse_id,
      header.expected_delivery_date], [null, null, null, null, null, null]);
    assert.equal(header.buyer_id, f.actorId, "停用嘅 Buyer 換做操作者");
    assert.deepEqual(copied.map((row) => [row.line_number, row.purchase_sku_uom_id, row.uom_to_base_factor_snapshot, row.ordered_base_quantity]),
      [[1, f.boxA, 7, 7], [2, f.eachA, 1, 2]], "行號重排；factor 用目前值，唔用來源快照");
    const [[{ first, second }]] = await tx.query(`SELECT MAX(IF(line_number = 1, expected_delivery_date, NULL)) AS first,
      DATE_FORMAT(MAX(IF(line_number = 2, expected_delivery_date, NULL)), '%Y-%m-%d') AS second FROM purchase_order_lines WHERE purchase_order_id = ?`, [result.id]);
    assert.deepEqual([first, second], [null, "2099-12-01"], "過咗期嘅交期清空，未過期照抄");
    assert.equal(header.total_amount, "3.00".padEnd(6, "0"));
  });
});

integrationTest("copy 遇到不可採購 Supplier、冇 Line 剩低或者唔存在嘅來源就成張拒絕，寫 REJECTED Audit；要 purchasing.mgmt", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const copy = (id, claims = f.claims) => orders.copy({ claims, purchaseOrderId: id, input: { eventId: randomUUID() } });
    const count = async () => Number((await tx.query("SELECT COUNT(*) AS total FROM purchase_orders WHERE created_by = ?", [f.actorId]))[0][0].total);
    const source = await orders.create({ claims: f.claims, input: body(f) });

    await assert.rejects(copy(Number.MAX_SAFE_INTEGER), coded("PURCHASE_ORDER_NOT_FOUND"));
    await assert.rejects(copy(0), coded("PURCHASING_INPUT_INVALID", { field: "purchaseOrderId" }));
    await assert.rejects(orders.copy({ claims: f.claims, purchaseOrderId: source.id, input: { eventId: randomUUID(), status: "CONFIRMED" } }), (error) => error.code === "PURCHASING_INPUT_INVALID");
    await assert.rejects(orders.copy({ claims: f.claims, purchaseOrderId: source.id, input: { eventId: "NOPE" } }), coded("PURCHASING_INPUT_INVALID", { field: "eventId" }));

    await tx.query("UPDATE item_skus SET status = 'inactive' WHERE id IN (?)", [[f.skuA, f.skuB]]);
    await assert.rejects(copy(source.id), coded("SKU_NOT_PURCHASABLE", { field: "lines" }));
    await tx.query("UPDATE item_skus SET status = 'active' WHERE id IN (?)", [[f.skuA, f.skuB]]);

    await tx.query("UPDATE suppliers SET status = 'suspended' WHERE id = ?", [f.supplierA]);
    await assert.rejects(copy(source.id), coded("SUPPLIER_NOT_PURCHASABLE", { field: "supplierId" }));
    await tx.query("UPDATE suppliers SET status = 'active' WHERE id = ?", [f.supplierA]);

    await tx.query("UPDATE currencies SET status = 'INACTIVE' WHERE code = ?", [f.currency]);
    await assert.rejects(copy(source.id), coded("CURRENCY_NOT_ACTIVE"));
    await tx.query("UPDATE currencies SET status = 'ACTIVE' WHERE code = ?", [f.currency]);

    assert.equal(await count(), 1, "冇一次留低新 PO");
    const rejected = (await audits(tx, f.actorId)).filter((row) => row.outcome === "REJECTED");
    assert.deepEqual(rejected.map((row) => [row.action, row.detail.code]), [["purchase_order.copied", "PURCHASE_ORDER_NOT_FOUND"], ["purchase_order.copied", "PURCHASING_INPUT_INVALID"],
      ["purchase_order.copied", "PURCHASING_INPUT_INVALID"], ["purchase_order.copied", "PURCHASING_INPUT_INVALID"], ["purchase_order.copied", "SKU_NOT_PURCHASABLE"],
      ["purchase_order.copied", "SUPPLIER_NOT_PURCHASABLE"], ["purchase_order.copied", "CURRENCY_NOT_ACTIVE"]]);

    await tx.query("DELETE rp FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?", [f.actorId]);
    await assert.rejects(copy(source.id, { ...f.claims, permissions: [] }), coded("PERMISSION_STALE"));
  });
});

integrationTest("copy 逐個條件剔走唔合格嘅 Line：UOM 停用、唔再追蹤庫存、改咗 serial、factor 改咗換唔到整數", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const source = await orders.create({ claims: f.claims, input: body(f, { lines: [
      { skuId: f.skuA, purchaseSkuUomId: f.boxA, orderedQuantity: "0.5", unitPrice: "1" }, { skuId: f.skuB, purchaseSkuUomId: f.eachB, orderedQuantity: "1", unitPrice: "1" }] }) });
    for (const [sql, restore] of [
      [["UPDATE item_uoms SET status = 'inactive' WHERE id = ?", [f.box]], ["UPDATE item_uoms SET status = 'active' WHERE id = ?", [f.box]]],
      [["UPDATE item_skus SET inventory_tracked = 0 WHERE id = ?", [f.skuA]], ["UPDATE item_skus SET inventory_tracked = 1 WHERE id = ?", [f.skuA]]],
      [["UPDATE item_skus SET tracking_policy = 'serial' WHERE id = ?", [f.skuA]], ["UPDATE item_skus SET tracking_policy = 'batch_expiry' WHERE id = ?", [f.skuA]]],
      [["UPDATE item_sku_uoms SET to_base_factor = 7 WHERE id = ?", [f.boxA]], ["UPDATE item_sku_uoms SET to_base_factor = 24 WHERE id = ?", [f.boxA]]]
    ]) {
      await tx.query(...sql);
      const result = await orders.copy({ claims: f.claims, purchaseOrderId: source.id, input: { eventId: randomUUID() } });
      assert.deepEqual(result.warnings, [{ code: "COPY_LINE_DROPPED", lineNumber: 1 }], sql[0]);
      assert.deepEqual((await lines(tx, result.id)).map((row) => row.sku_id), [f.skuB], sql[0]);
      await tx.query(...restore);
    }
    const clean = await orders.copy({ claims: f.claims, purchaseOrderId: source.id, input: { eventId: randomUUID() } });
    assert.deepEqual([clean.warnings, (await lines(tx, clean.id)).length], [[], 2], "主檔復原就兩行都抄");
  });
});

integrationTest("submit 審批關閉：完整 Draft 直接 CONFIRMED，寫目前快照、確認人同 Audit；Inventory 唔郁，replay 唔重做（AC-011）", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const draft = await orders.create({ claims: f.claims, input: body(f) });
    const [lineA, lineB] = await lines(tx, draft.id), inventory = await inventoryCounts(tx);
    await tx.query("UPDATE suppliers SET supplier_name = 'Renamed Supplier' WHERE id = ?", [f.supplierA]);
    await tx.query("UPDATE item_skus SET sku_name = 'Renamed SKU' WHERE id = ?", [f.skuA]);
    await tx.query("UPDATE purchasing_settings SET version = 7 WHERE id = 1");
    await tx.query("UPDATE purchase_orders SET updated_by = NULL, updated_by_label = 'someone else' WHERE id = ?", [draft.id]);

    const input = { eventId: randomUUID(), version: 1 }, context = { requestId: "req-s", correlationId: "corr-s", ip: "127.0.0.1" };
    const result = await orders.submit({ claims: f.claims, purchaseOrderId: draft.id, input, context });
    assert.deepEqual(result, { id: draft.id, number: draft.number, status: "CONFIRMED", version: 2, outcome: "CONFIRMED", warnings: [], replayed: false });

    const header = await order(tx, draft.id), confirmed = await lines(tx, draft.id);
    assert.deepEqual([header.status, header.version, header.confirmed_at, header.confirmed_by, header.updated_by, header.has_outstanding, header.has_confirmed_receipt],
      ["CONFIRMED", 2, NOW, f.actorId, f.actorId, 1, 0]);
    assert.equal(header.updated_by_label, (await tx.query("SELECT username FROM users WHERE id = ?", [f.actorId]))[0][0].username);
    assert.equal(header.supplier_name_snapshot, "Renamed Supplier", "確認時寫目前快照");
    assert.equal(header.total_amount, "30.0200");
    assert.deepEqual(confirmed.map((row) => row.id), [lineA.id, lineB.id], "Line ID 唔變");
    assert.deepEqual(confirmed.map((row) => [row.sku_name_snapshot, row.version, Number(row.ordered_base_quantity), row.line_amount]),
      [["Renamed SKU", 2, 72, "30.0200"], ["SKU b", 2, 2, "0.0000"]]);
    assert.deepEqual(await inventoryCounts(tx), inventory, "Inventory 零效果");

    const audit = (await audits(tx, f.actorId)).at(-1);
    assert.deepEqual([audit.action, audit.outcome, audit.target_id, audit.target_label], ["purchase_order.confirmed", "SUCCEEDED", draft.id, draft.number]);
    assert.deepEqual(audit.detail, { version: 2, lineCount: 2, totalAmount: "30.02", currencyCode: f.currency, policyVersion: 7 });
    const operation = (await operationsOf(tx, f.actorId)).at(-1);
    assert.deepEqual([operation.command_type, operation.source_document_id], ["SUBMIT_PURCHASE_ORDER", String(draft.id)]);

    const replay = await orders.submit({ claims: f.claims, purchaseOrderId: draft.id, input });
    assert.deepEqual(replay, { ...result, replayed: true });
    assert.equal((await order(tx, draft.id)).version, 2, "Replay 唔再 +1");
    await assert.rejects(orders.submit({ claims: f.claims, purchaseOrderId: draft.id, input: { eventId: input.eventId, version: 9 } }), coded("PURCHASING_EVENT_CONFLICT"));

    // 確認之後商業內容凍結，update 同再 submit 都係 PO_STATE_CONFLICT。
    await assert.rejects(orders.update({ claims: f.claims, purchaseOrderId: draft.id, input: editable(f, { version: 2 }, confirmed) }), coded("PO_STATE_CONFLICT"));
    await assert.rejects(orders.submit({ claims: f.claims, purchaseOrderId: draft.id, input: { eventId: randomUUID(), version: 2 } }), coded("PO_STATE_CONFLICT"));
  });
});

integrationTest("submit 嚴格重驗已保存嘅值：Draft 期間失效嘅主檔全部成張拒絕，寫 REJECTED Audit，PO 唔郁（FR-PO-018）", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const draft = await orders.create({ claims: f.claims, input: body(f) });
    const submit = () => orders.submit({ claims: f.claims, purchaseOrderId: draft.id, input: { eventId: randomUUID(), version: 1 } });
    const failing = [
      ["UPDATE suppliers SET status = 'suspended' WHERE id = ?", [f.supplierA], "UPDATE suppliers SET status = 'active' WHERE id = ?", "SUPPLIER_NOT_PURCHASABLE", "supplierId"],
      ["UPDATE item_skus SET purchasable = 0 WHERE id = ?", [f.skuB], "UPDATE item_skus SET purchasable = 1 WHERE id = ?", "SKU_NOT_PURCHASABLE", "lines.1.skuId"],
      ["UPDATE item_skus SET inventory_tracked = 0 WHERE id = ?", [f.skuA], "UPDATE item_skus SET inventory_tracked = 1 WHERE id = ?", "SKU_NOT_PURCHASABLE", "lines.0.skuId"],
      ["UPDATE item_skus SET tracking_policy = 'serial' WHERE id = ?", [f.skuB], "UPDATE item_skus SET tracking_policy = 'none' WHERE id = ?", "SKU_NOT_PURCHASABLE", "lines.1.skuId"],
      ["UPDATE item_uoms SET status = 'inactive' WHERE id = ?", [f.box], "UPDATE item_uoms SET status = 'active' WHERE id = ?", "SKU_NOT_PURCHASABLE", "lines.0.purchaseSkuUomId"],
      ["UPDATE currencies SET status = 'INACTIVE' WHERE code = ?", [f.currency], "UPDATE currencies SET status = 'ACTIVE' WHERE code = ?", "CURRENCY_NOT_ACTIVE", undefined],
      ["UPDATE payment_terms SET status = 'INACTIVE' WHERE id = ?", [f.paymentTerm], "UPDATE payment_terms SET status = 'ACTIVE' WHERE id = ?", "PAYMENT_TERM_NOT_ACTIVE", undefined],
      ["UPDATE inventory_warehouses SET status = 'INACTIVE' WHERE id = ?", [f.warehouse], "UPDATE inventory_warehouses SET status = 'ACTIVE' WHERE id = ?", "WAREHOUSE_INVALID", "defaultReceivingWarehouseId"],
      ["UPDATE users SET status = 'disabled' WHERE id = ?", [f.buyer], "UPDATE users SET status = 'active' WHERE id = ?", "PURCHASING_INPUT_INVALID", "buyerId"],
      ["UPDATE supplier_address_purposes SET is_primary = 0 WHERE address_id = ?", [f.primaryAddress], "UPDATE supplier_address_purposes SET is_primary = 1 WHERE address_id = ?", "PURCHASING_INPUT_INVALID", "orderingAddressId"]
    ];
    for (const [breakSql, params, restoreSql, code, field] of failing) {
      await tx.query(breakSql, params);
      await assert.rejects(submit(), (error) => {
        assert.equal(error.code, code, breakSql);
        assert.equal(error.publicDetails?.field, field, breakSql);
        return true;
      });
      const header = await order(tx, draft.id);
      assert.deepEqual([header.status, header.version, header.confirmed_at], ["DRAFT", 1, null], breakSql);
      await tx.query(restoreSql, params);
    }
    const rejected = (await audits(tx, f.actorId)).filter((row) => row.outcome === "REJECTED");
    assert.deepEqual(rejected.map((row) => [row.action, row.detail.code]), failing.map((entry) => ["purchase_order.confirmed", entry[3]]));
    await tx.query("UPDATE purchase_order_lines SET zero_price_reason = '' WHERE purchase_order_id = ? AND unit_price = 0", [draft.id]);
    await assert.rejects(submit(), coded("ZERO_PRICE_REASON_REQUIRED", { field: "lines.1.zeroPriceReason" }));
    await tx.query("UPDATE purchase_order_lines SET zero_price_reason = '免費樣品 sample' WHERE purchase_order_id = ? AND unit_price = 0", [draft.id]);
    assert.equal((await submit()).status, "CONFIRMED", "全部復原就確認到");
  });
});

integrationTest("submit 遇到保存後改咗嘅換算或者 Currency 小數位就拒絕（HD-018 2A）；重新保存睇到新數字先確認到", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const draft = await orders.create({ claims: f.claims, input: body(f) });
    const submit = (version) => orders.submit({ claims: f.claims, purchaseOrderId: draft.id, input: { eventId: randomUUID(), version } });

    await tx.query("UPDATE currencies SET decimal_places = 3 WHERE code = ?", [f.currency]);
    await assert.rejects(submit(1), coded("PO_MASTER_CHANGED", { field: "currencyCode" }));
    await tx.query("UPDATE currencies SET decimal_places = 2 WHERE code = ?", [f.currency]);

    await tx.query("UPDATE item_sku_uoms SET to_base_factor = 12 WHERE id = ?", [f.boxA]);
    await assert.rejects(submit(1), coded("PO_MASTER_CHANGED", { field: "lines.0.purchaseSkuUomId" }));
    assert.equal((await lines(tx, draft.id))[0].ordered_base_quantity, 72, "拒絕之後保存嘅數量唔變");

    const rows = await lines(tx, draft.id);
    await orders.update({ claims: f.claims, purchaseOrderId: draft.id, input: editable(f, { version: 1 }, rows) });
    assert.equal((await lines(tx, draft.id))[0].ordered_base_quantity, 36, "重新保存用新換算");
    assert.equal((await submit(2)).status, "CONFIRMED");
  });
});

integrationTest("submit 拒絕舊 version、唔存在嘅 PO、未知欄位同撤咗嘅權限；審批開住就唔可以直接確認；設定 row 唔見就 fail closed", async (t) => {
  const db = database(t);
  await inRollback(db, async (tx) => {
    const f = await masters(tx), orders = service(db, tx);
    const draft = await orders.create({ claims: f.claims, input: body(f) });
    const submit = (input = {}, id = draft.id, claims = f.claims) => orders.submit({ claims, purchaseOrderId: id, input: { eventId: randomUUID(), version: 1, ...input } });
    const unchanged = async () => assert.deepEqual([(await order(tx, draft.id)).status, (await order(tx, draft.id)).version], ["DRAFT", 1]);

    await assert.rejects(submit({ version: 5 }), coded("VERSION_CONFLICT", { currentVersion: 1 }));
    await assert.rejects(submit({}, Number.MAX_SAFE_INTEGER), coded("PURCHASE_ORDER_NOT_FOUND"));
    await assert.rejects(submit({}, 0), coded("PURCHASING_INPUT_INVALID", { field: "purchaseOrderId" }));
    await assert.rejects(submit({ version: "1" }), coded("PURCHASING_INPUT_INVALID", { field: "version" }));
    await assert.rejects(submit({ eventId: "NOPE" }), coded("PURCHASING_INPUT_INVALID", { field: "eventId" }));
    for (const field of ["assignedApproverId", "status", "requestNote"]) {
      await assert.rejects(submit({ [field]: 1 }), (error) => error.code === "PURCHASING_INPUT_INVALID", field);
    }
    await unchanged();

    await tx.query("UPDATE purchasing_settings SET require_po_approval = 1 WHERE id = 1");
    await assert.rejects(submit(), coded("PO_APPROVAL_REQUIRED"));
    await unchanged();
    await tx.query("UPDATE purchasing_settings SET require_po_approval = 0 WHERE id = 1");

    const [[settings]] = await tx.query("SELECT * FROM purchasing_settings WHERE id = 1");
    await tx.query("DELETE FROM purchasing_settings WHERE id = 1");
    await assert.rejects(submit(), coded("PURCHASING_DEPENDENCY_UNAVAILABLE"));
    await tx.query("INSERT INTO purchasing_settings SET ?", [settings]);
    await unchanged();

    await tx.query("DELETE rp FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?", [f.actorId]);
    await assert.rejects(submit({}, draft.id, { ...f.claims, permissions: [] }), coded("PERMISSION_STALE"));
    await unchanged();
  });
});

integrationTest("Submit 同 Update 同時用同一 version：PO 行鎖令輸嗰個收到 VERSION_CONFLICT，唔會確認到舊內容", async (t) => {
  const db = database(t), f = await committedMasters(db);
  const month = Date.UTC(2100 + Math.floor(Math.random() * 7900), 6, 15);
  const clock = new SystemTimeService({ config: { application: { timeZone: "Asia/Hong_Kong" } }, options: { clock: () => new Date(month) } });
  const businessMaster = new BusinessMasterProvider({ database: db, repository: new BusinessMasterRepository() });
  const po = new PurchaseOrderService({ database: db, logger: silent, time: clock, businessMaster, audit: new PurchasingAuditService({ auditDetailMaxBytes: 8192 }),
    suppliers: new SupplierLookupService({ database: db, logger: silent, time: clock }), sequences: new PurchasingSequenceService(),
    operations: new PurchasingOperationService(), config: normalizePurchasingConfig() });
  const draft = (notes) => ({ eventId: randomUUID(), supplierId: f.supplierId, currencyCode: "HKD", orderDate: "2099-11-15",
    buyerId: f.actorId, notes, lines: [{ skuId: f.skuId, purchaseSkuUomId: f.skuUomId, orderedQuantity: "1", unitPrice: "1" }] });
  const blocker = await db.pool.getConnection();
  const observer = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD });
  let id = null;
  try {
    ({ id } = await po.create({ claims: f.claims, input: draft("v1") }));
    await blocker.query("START TRANSACTION");
    await blocker.query("SELECT id FROM purchase_orders WHERE id = ? FOR UPDATE", [id]);
    const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
    const outcomes = [settle(po.submit({ claims: f.claims, purchaseOrderId: id, input: { eventId: randomUUID(), version: 1 } })),
      settle(po.update({ claims: f.claims, purchaseOrderId: id, input: { ...draft("edited"), version: 1 } }))];
    const limit = Date.now() + 10000;
    for (;;) {
      const [[{ waits }]] = await observer.query(`SELECT COUNT(*) waits FROM performance_schema.data_lock_waits w
        JOIN performance_schema.data_locks l ON l.engine_lock_id = w.blocking_engine_lock_id
        WHERE l.object_schema = ? AND l.object_name = 'purchase_orders'`, [process.env.DB_NAME]);
      if (Number(waits) >= 2) break;
      assert.ok(Date.now() < limit, "Submit 同 Update 都要等緊 PO 行鎖");
      await delay(20);
    }
    await blocker.query("COMMIT");
    const [submitted, updated] = await Promise.all(outcomes);
    const [[header]] = await db.query("SELECT status, version, notes FROM purchase_orders WHERE id = ?", [id]);
    assert.equal(Boolean(submitted.value) !== Boolean(updated.value), true, JSON.stringify([submitted.error?.code, updated.error?.code]));
    const loser = submitted.error ?? updated.error;
    assert.ok(["VERSION_CONFLICT", "PO_STATE_CONFLICT"].includes(loser.code), loser.code);
    assert.deepEqual({ ...header }, submitted.value ? { status: "CONFIRMED", version: 2, notes: "v1" } : { status: "DRAFT", version: 2, notes: "edited" });
  } finally {
    await blocker.query("ROLLBACK").catch(() => {});
    blocker.release();
    await observer.end();
    // Trigger 唔准刪已確認 PO 嘅 Line，所以先返 DRAFT 先清得走。
    if (id) await db.query("UPDATE purchase_orders SET status = 'DRAFT' WHERE id = ?", [id]);
    await f.cleanup();
  }
});

