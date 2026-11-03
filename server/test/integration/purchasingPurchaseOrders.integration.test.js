/**
 * TASK-014／TC-003：PurchaseOrderService Draft create／update 對真 MySQL（設計 §3.1、§5.2、§8.2；HD-015）。
 *
 * Supplier、Item、Business Master provider、sequence、operation 同 audit 全部用真 class。Operation／audit／sequence 有 trigger
 * 擋 DELETE，所以每個案例喺一個外層 transaction 入面做，最後 rollback；service 嘅 `withTransaction()` 用 SAVEPOINT 代替，
 * 失敗時 ROLLBACK TO SAVEPOINT，等「全有或全無」喺同一個外層 transaction 入面睇得到。主檔同月份（2099-11）都係測試專用。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

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
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 2,
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
    assert.deepEqual((await audits(tx, f.actorId)).at(-1).detail, { version: 2, lineCount: 2, totalAmount: "17.50", currencyCode: f.currency });
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
