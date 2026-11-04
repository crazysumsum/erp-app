/**
 * TASK-016／TC-003：PurchasingInquiryService 對真 MySQL（設計 §5.2、§5.6、§8.9；HD-017）。
 *
 * PO 同 Line 直接 INSERT，先做到各種狀態同收貨進度；每個案例喺一個外層 transaction 入面做，最後 rollback，乜都唔留。
 * 其他檔案可能留低已 commit 嘅 PO，所以 list 一定配上呢個案例專用嘅 Supplier 或者搜尋字。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PurchasingInquiryService } from "../../src/modules/purchasing/PurchasingInquiryService.js";
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
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 3,
    waitForConnections: true, queueLimit: 10, acquireTimeoutMs: 5000, queryTimeoutMs: 10000, transactionTimeoutMs: 20000,
    abandonedConnectionAction: "destroy" };
  const pool = createMySqlDatabasePool(config);
  t.after(() => pool.end());
  return new MySqlDatabaseService({ pool, config, context: new RequestContextService({ services: { require: () => time } }), logger: silent });
}

async function inRollback(db, work) {
  await assert.rejects(db.withTransaction(async (tx) => { await work(tx); throw ROLLBACK; }), (error) => {
    if (error.cause !== ROLLBACK) throw error.code === "DATABASE_TRANSACTION_FAILED" ? error.cause : error;
    return true;
  });
}

/** Service 全部讀取都行外層 transaction，先見到未 commit 嘅 fixture。 */
function service(tx) {
  const database = { query: (...args) => tx.query(...args), withTransaction: (work) => work(tx) };
  return new PurchasingInquiryService({ database, logger: silent, time, suppliers: new SupplierLookupService({ database, logger: silent, time }) });
}

async function masters(tx) {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = NOW;
  const insert = async (table, row) => Number((await tx.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
  const user = async (suffix, permissions) => {
    const id = await insert("users", { username: `inq_${suffix}_${tag}`, password_hash: "synthetic", created_at: now, updated_at: now });
    const role = await insert("roles", { name: `inq_${suffix}_${tag}`, created_at: now });
    for (const name of permissions) await tx.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, name]);
    await tx.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
    return { id, claims: { sub: String(id), roles: [`inq_${suffix}_${tag}`], permissions } };
  };
  const manager = await user("manager", ["purchasing.view", "purchasing.mgmt"]), viewer = await user("viewer", ["purchasing.view"]);
  const currency = `Q${tag.slice(0, 2).toUpperCase().replace(/\d/gu, "Z")}`;
  await tx.query("INSERT IGNORE INTO currencies SET ?", [{ code: currency, name: `Probe ${tag}`, decimal_places: 2, status: "ACTIVE", version: 1, created_at: now, updated_at: now }]);
  const supplier = (suffix, status = "active") => insert("suppliers", { supplier_code: `INQ-${tag}-${suffix}`, supplier_code_key: `inq-${tag}-${suffix}`,
    supplier_name: `Name${tag} ${suffix}`, supplier_name_key: `name${tag} ${suffix}`, display_name: `Disp${tag} ${suffix}`, default_currency_code: "HKD",
    status, created_at: now, updated_at: now });
  const supplierA = await supplier("a"), supplierB = await supplier("b"), inactiveSupplier = await supplier("off", "inactive");
  const item = await insert("items", { name: `Item${tag}`, status: "active", created_at: now, updated_at: now });
  const uom = await insert("item_uoms", { code: `I${tag}`, name: "Each", created_at: now, updated_at: now });
  const sku = async (suffix, status = "active") => {
    const id = await insert("item_skus", { item_id: item, sku_code: `SKU${tag}${suffix}`, sku_name: `Goods${tag} ${suffix}`, status, created_at: now, updated_at: now });
    const mapping = await insert("item_sku_uoms", { sku_id: id, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
    return { id, mapping, code: `SKU${tag}${suffix}`, name: `Goods${tag} ${suffix}` };
  };
  const skuA = await sku("a"), skuB = await sku("b"), retired = await sku("r", "archived");
  await tx.query("INSERT INTO item_sku_barcodes SET ?", [{ sku_id: skuB.id, sku_uom_id: skuB.mapping, barcode_type: "internal", barcode: `B${tag}`, normalized_barcode: `B${tag}`, created_at: now, updated_at: now }]);

  let sequence = 100000 + Math.floor(Math.random() * 800000);
  const order = async ({ supplierId = supplierA, status = "DRAFT", lines = [{ sku: skuA }], updatedAt = now, ...overrides } = {}) => {
    sequence += 1;
    const number = `PO-209911-${String(sequence).padStart(6, "0")}`;
    const [[snapshot]] = await tx.query("SELECT supplier_code, supplier_name FROM suppliers WHERE id = ?", [supplierId]);
    const id = await insert("purchase_orders", { po_number: number, document_year_month: "209911", sequence_no: sequence, supplier_id: supplierId,
      supplier_code_snapshot: snapshot.supplier_code, supplier_name_snapshot: snapshot.supplier_name, currency_code: "HKD", currency_name_snapshot: "HK Dollar",
      currency_decimal_places_snapshot: 2, order_date: "2099-11-01", buyer_id: manager.id, buyer_label: "Buyer", total_amount: "10.0000", subtotal_amount: "10.0000",
      created_at: now, updated_at: updatedAt, created_by: manager.id, created_by_label: "maker", updated_by: manager.id, updated_by_label: "editor", ...overrides });
    let index = 0;
    for (const { sku: chosen, ordered = 10, net = 0, reversed = 0, closed = 0, unitPrice = "1.0000", zeroPriceReason = "", date = null } of lines) {
      index += 1;
      await insert("purchase_order_lines", { purchase_order_id: id, line_number: index, sku_id: chosen.id, sku_code_snapshot: chosen.code, sku_name_snapshot: chosen.name,
        tracking_policy_snapshot: "none", inventory_tracked_snapshot: 1, base_uom_id: uom, base_uom_code_snapshot: "EA", purchase_sku_uom_id: chosen.mapping,
        purchase_uom_code_snapshot: "EA", uom_to_base_factor_snapshot: 1, ordered_quantity: String(ordered), ordered_base_quantity: ordered, unit_price: unitPrice,
        line_amount: "1.0000", zero_price_reason: zeroPriceReason, expected_delivery_date: date, gross_received_base_quantity: net + reversed, reversed_base_quantity: reversed,
        net_received_base_quantity: net, closed_remaining_base_quantity: closed, created_at: now, updated_at: now });
    }
    // Line trigger 喺表頭離開 DRAFT 之後唔准加行，所以最後先改狀態。
    if (status !== "DRAFT") await tx.query("UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?", [status, updatedAt, id]);
    return { id, number };
  };
  return { tag, currency, manager, viewer, supplierA, supplierB, inactiveSupplier, skuA, skuB, retired, order };
}

const ids = (result) => result.items.map((item) => item.id);
const coded = (code, field) => (error) => {
  assert.equal(error.code, code, `${error.code}: ${error.message}`);
  if (field) assert.equal(error.publicDetails?.field, field);
  return true;
};

integrationTest("列表預設按更新時間同 ID 倒序，分頁穩定；summary 係交易快照同安全欄位，allowedActions 跟 DB 權限", async (t) => {
  await inRollback(database(t), async (tx) => {
    const f = await masters(tx), inquiry = service(tx);
    const older = await f.order({ updatedAt: NOW - 1000 }), tieLow = await f.order(), tieHigh = await f.order({ status: "CONFIRMED" });
    const list = (input, actor = f.manager) => inquiry.list({ claims: actor.claims, input: { supplierId: f.supplierA, ...input } });

    const all = await list({});
    assert.deepEqual(ids(all), [tieHigh.id, tieLow.id, older.id], "同一更新時間用 ID 做 tie-breaker");
    assert.deepEqual({ total: all.total, page: all.page, pageSize: all.pageSize }, { total: 3, page: 1, pageSize: 20 });
    const [second] = (await list({ page: 2, pageSize: 1 })).items;
    assert.equal(second.id, tieLow.id);
    assert.deepEqual(ids(await list({ sortBy: "number", descending: false })), [older.id, tieLow.id, tieHigh.id]);
    assert.deepEqual((await list({ page: 9 })).items, [], "超出範圍回空，total 照計");
    assert.equal((await list({ page: 9 })).total, 3);

    const item = all.items[1];
    assert.deepEqual(item, { id: tieLow.id, number: tieLow.number, status: "DRAFT", version: 1, supplierId: f.supplierA, supplierCode: `INQ-${f.tag}-a`,
      supplierName: `Name${f.tag} a`, currencyCode: "HKD", orderDate: "2099-11-01", expectedDeliveryDate: null, buyerId: f.manager.id, buyerLabel: "Buyer",
      supplierReference: "", totalAmount: "10.0000", hasOutstanding: false, createdAt: NOW, updatedAt: NOW, allowedActions: ["edit", "copy"], lineCount: 1,
      orderedBaseQuantity: "10", netReceivedBaseQuantity: "0", outstandingBaseQuantity: "0", closedRemainingBaseQuantity: "0", risks: [] });
    assert.deepEqual(all.items[0].allowedActions, ["copy"], "已確認唔可以再改");
    assert.deepEqual((await list({}, f.viewer)).items.map((row) => row.allowedActions), [[], [], []], "只有 view 冇任何寫入動作");
  });
});

integrationTest("每個 filter 都會篩，日期範圍包頭包尾，條件之間係 AND", async (t) => {
  await inRollback(database(t), async (tx) => {
    const f = await masters(tx), inquiry = service(tx);
    const a = await f.order({ order_date: "2099-11-01", expected_delivery_date: "2099-11-20", lines: [{ sku: f.skuA }] });
    const b = await f.order({ order_date: "2099-11-10", expected_delivery_date: "2099-11-25", status: "CONFIRMED", lines: [{ sku: f.skuB }], buyer_id: f.viewer.id });
    const other = await f.order({ supplierId: f.supplierB, currency_code: f.currency, lines: [{ sku: f.skuB }] });
    const list = async (input) => ids(await inquiry.list({ claims: f.manager.claims, input: { sortBy: "number", descending: false, supplierId: f.supplierA, ...input } }));

    assert.deepEqual(await list({}), [a.id, b.id]);
    assert.deepEqual(await list({ status: "CONFIRMED" }), [b.id]);
    assert.deepEqual(await list({ status: ["DRAFT", "CONFIRMED"] }), [a.id, b.id]);
    assert.deepEqual(await list({ status: ["CLOSED"] }), []);
    assert.deepEqual(await list({ supplierId: f.supplierB }), [other.id]);
    assert.deepEqual(await list({ supplierId: f.supplierB, currencyCode: "HKD" }), [], "currency 同 supplier 要同時成立");
    assert.deepEqual(await list({ supplierId: f.supplierB, currencyCode: f.currency }), [other.id]);
    assert.deepEqual(await list({ buyerId: f.viewer.id }), [b.id]);
    assert.deepEqual(await list({ skuId: f.skuA.id }), [a.id]);
    assert.deepEqual(await list({ orderDateFrom: "2099-11-10" }), [b.id]);
    assert.deepEqual(await list({ orderDateTo: "2099-11-01" }), [a.id]);
    assert.deepEqual(await list({ expectedDeliveryDateFrom: "2099-11-25" }), [b.id]);
    assert.deepEqual(await list({ expectedDeliveryDateTo: "2099-11-20" }), [a.id]);

    for (const [input, field] of [[{ orderDateFrom: "2099-11-02", orderDateTo: "2099-11-01" }, "orderDate"],
      [{ expectedDeliveryDateFrom: "2099-11-02", expectedDeliveryDateTo: "2099-11-01" }, "expectedDeliveryDate"], [{ sortBy: "password_hash" }, "sortBy"],
      [{ orderDateFrom: "2099-02-30" }, "orderDateFrom"], [{ expectedDeliveryDateTo: "2099-13-01" }, "expectedDeliveryDateTo"], [{ q: "a\u0000b" }, "q"], [{ page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, "page"]]) {
      await assert.rejects(inquiry.list({ claims: f.manager.claims, input }), coded("PURCHASING_INPUT_INVALID", field));
    }
  });
});

integrationTest("q 搵 PO 編號、Supplier code／名稱、SKU code／名稱、barcode 同 Supplier Reference，已停用主檔都搵到；通配符只係普通字", async (t) => {
  await inRollback(database(t), async (tx) => {
    const f = await masters(tx), inquiry = service(tx);
    const onA = await f.order({ supplier_reference: `REF${f.tag}`, lines: [{ sku: f.skuA }] });
    const withBarcode = await f.order({ supplierId: f.supplierB, lines: [{ sku: f.skuB }] });
    const stopped = await f.order({ supplierId: f.inactiveSupplier, lines: [{ sku: f.retired }] });
    const search = async (q) => ids(await inquiry.list({ claims: f.manager.claims, input: { q, sortBy: "number", descending: false } }));

    assert.deepEqual(await search(onA.number), [onA.id]);
    assert.deepEqual(await search(` ${onA.number.toLowerCase()} `), [onA.id], "PO 編號唔分大細楷，前後空格唔計");
    assert.deepEqual(await search(onA.number.slice(0, -1)), [], "PO 編號要完全相符");
    assert.deepEqual(await search(`REF${f.tag}`), [onA.id]);
    assert.deepEqual(await search(`INQ-${f.tag}-b`), [withBarcode.id]);
    assert.deepEqual(await search(`inq-${f.tag}-B`), [withBarcode.id], "Supplier code 唔分大細楷");
    assert.deepEqual(await search(`Name${f.tag} b`), [withBarcode.id]);
    assert.deepEqual(await search(`Disp${f.tag} a`), [onA.id]);
    assert.deepEqual(await search(`Name${f.tag} off`), [stopped.id], "停用 Supplier 嘅舊 PO 用名稱搵到（HD-017 1A）");
    assert.deepEqual(await search(f.skuA.code), [onA.id]);
    assert.deepEqual(await search(f.skuB.name), [withBarcode.id]);
    assert.deepEqual(await search(f.retired.name), [stopped.id], "停用 SKU 嘅舊 PO 用名稱搵到（HD-017 1A）");
    assert.deepEqual(await search(`Item${f.tag}`), [onA.id, withBarcode.id, stopped.id], "Item 名稱亦搵到佢嘅 SKU");
    assert.deepEqual(await search(`B${f.tag}`), [withBarcode.id]);
    assert.deepEqual(await search(`Goods${f.tag}%`), [], "% 唔係通配符");
    assert.deepEqual(await search(`Goods${f.tag}_a`), [], "_ 唔係通配符");
    assert.deepEqual(await search(`%`), [], "淨係 % 唔會配中全部");
    assert.deepEqual(await search(`冇呢個${f.tag}`), [], "非 ASCII 字對 ascii_bin 編號欄位都唔會出錯");

    const onlyB = await inquiry.list({ claims: f.manager.claims, input: { q: `Item${f.tag}`, supplierId: f.supplierB } });
    assert.deepEqual([ids(onlyB), onlyB.total], [[withBarcode.id], 1], "q 同 filter 係 AND");
    const blank = await inquiry.list({ claims: f.manager.claims, input: { q: "   ", supplierId: f.supplierB } });
    assert.deepEqual(ids(blank), [withBarcode.id], "空白 q 等於冇搜尋");
  });
});

integrationTest("Outstanding 只計已確認、收緊貨嘅 PO（HD-017 4A）；進度分開計，超收唔抵銷其他行，風險有文字碼", async (t) => {
  await inRollback(database(t), async (tx) => {
    const f = await masters(tx), inquiry = service(tx);
    const draft = await f.order({ lines: [{ sku: f.skuA, unitPrice: "0.0000", zeroPriceReason: "免費樣品" }] });
    const confirmed = await f.order({ status: "CONFIRMED", expected_delivery_date: "2099-11-14",
      lines: [{ sku: f.skuA, ordered: 10, net: 4, reversed: 1, closed: 2 }, { sku: f.skuB, ordered: 5, net: 8 }] });
    const onTime = await f.order({ status: "PARTIALLY_RECEIVED", expected_delivery_date: "2099-11-14", lines: [{ sku: f.skuA, net: 1, date: "2099-11-15" }] });
    const received = await f.order({ status: "FULLY_RECEIVED", has_outstanding: 0, lines: [{ sku: f.skuA, net: 10 }] });
    const cancelled = await f.order({ status: "CANCELLED", lines: [{ sku: f.skuA }] });
    const inactive = await f.order({ supplierId: f.inactiveSupplier, lines: [{ sku: f.skuA }] });
    const retired = await f.order({ supplierId: f.supplierB, lines: [{ sku: f.retired }] });
    const list = (input) => inquiry.list({ claims: f.manager.claims, input: { sortBy: "number", descending: false, ...input } });

    assert.deepEqual(ids(await list({ supplierId: f.supplierA, hasOutstanding: true })), [confirmed.id, onTime.id]);
    assert.deepEqual(ids(await list({ supplierId: f.supplierA, hasOutstanding: false })), [draft.id, received.id, cancelled.id]);

    const items = new Map((await list({ supplierId: f.supplierA })).items.map((item) => [item.id, item]));
    const of = (id) => { const { hasOutstanding, outstandingBaseQuantity, netReceivedBaseQuantity, orderedBaseQuantity, closedRemainingBaseQuantity, lineCount, risks } = items.get(id);
      return { hasOutstanding, outstandingBaseQuantity, netReceivedBaseQuantity, orderedBaseQuantity, closedRemainingBaseQuantity, lineCount, risks }; };
    assert.deepEqual(of(draft.id), { hasOutstanding: false, outstandingBaseQuantity: "0", netReceivedBaseQuantity: "0", orderedBaseQuantity: "10",
      closedRemainingBaseQuantity: "0", lineCount: 1, risks: ["ZERO_PRICE"] }, "Draft 冇 Outstanding，亦唔會逾期");
    assert.deepEqual(of(confirmed.id), { hasOutstanding: true, outstandingBaseQuantity: "4", netReceivedBaseQuantity: "12", orderedBaseQuantity: "15",
      closedRemainingBaseQuantity: "2", lineCount: 2, risks: ["OVERDUE", "OVER_RECEIVED"] }, "(10-4-2)+max(5-8,0)，唔係 15-12-2");
    assert.deepEqual(of(onTime.id).risks, [], "Line 交期蓋過表頭：今日到期未算逾期");
    assert.deepEqual(of(received.id).risks, [], "收齊就唔係逾期");
    assert.deepEqual(of(cancelled.id).outstandingBaseQuantity, "0");
    assert.deepEqual((await list({ supplierId: f.inactiveSupplier })).items.find((item) => item.id === inactive.id).risks, ["INACTIVE_MASTER"]);
    assert.deepEqual((await list({ supplierId: f.supplierB })).items.find((item) => item.id === retired.id).risks, ["INACTIVE_MASTER"]);
  });
});

integrationTest("列表 query 數量固定，唔跟 PO 同 Line 數量增加", async (t) => {
  await inRollback(database(t), async (tx) => {
    const f = await masters(tx);
    let count = 0;
    const counting = { query: (...args) => { count += 1; return tx.query(...args); } };
    const inquiry = service(counting);
    const run = async (input) => { count = 0; const result = await inquiry.list({ claims: f.manager.claims, input: { supplierId: f.supplierA, ...input } }); return [count, result.items.length]; };

    await f.order();
    const [one, oneItem] = await run({}), [searchOne] = await run({ q: `Item${f.tag}` });
    assert.equal(oneItem, 1);
    for (let index = 0; index < 5; index += 1) await f.order({ lines: [{ sku: f.skuA }, { sku: f.skuB }, { sku: f.skuA }] });
    const [many, manyItems] = await run({}), [searchMany, searched] = await run({ q: `Item${f.tag}` });
    assert.equal(manyItems, 6);
    assert.equal(searched, 6);
    assert.equal(many, one);
    assert.equal(searchMany, searchOne);
  });
});

integrationTest("詳情回交易快照同逐行進度，目前主資料另外放；只回有分別嘅，唔露 Supplier 內部欄位", async (t) => {
  await inRollback(database(t), async (tx) => {
    const f = await masters(tx), inquiry = service(tx);
    const address = { addressLine1: "1 Road", addressLine2: null, addressLine3: null, city: "HK", stateRegion: null, postalCode: null, countryCode: "HK", phone: null };
    const term = { code: "N30", name: "Net 30", calculationType: "NET_DAYS", dueDays: 30 };
    const po = await f.order({ status: "PARTIALLY_RECEIVED", supplier_reference: "Q-1", notes: "備註", ordering_address_snapshot: JSON.stringify(address),
      payment_term_snapshot: JSON.stringify(term), default_warehouse_code_snapshot: "W1", has_confirmed_receipt: 1, confirmed_at: NOW - 5,
      lines: [{ sku: f.skuA, ordered: 10, net: 4, reversed: 1, closed: 2, date: "2099-12-01" }, { sku: f.skuB, ordered: 5, net: 8 }] });

    const clean = await inquiry.get({ claims: f.manager.claims, id: po.id });
    assert.deepEqual(clean.currentMasterDifferences, { supplier: null, lines: [] }, "冇變就冇差異");
    assert.deepEqual(Object.keys(clean).sort(), ["allowedActions", "buyerId", "buyerLabel", "cancelledAt", "closedAt", "confirmedAt", "createdAt", "createdByLabel", "currencyCode",
      "currencyDecimalPlaces", "currencyName", "currentMasterDifferences", "defaultReceivingWarehouseId", "defaultWarehouseCode", "expectedDeliveryDate", "hasConfirmedReceipt",
      "hasOutstanding", "id", "lines", "notes", "number", "orderDate", "orderingAddress", "orderingAddressId", "paymentTerm", "paymentTermId", "status", "subtotalAmount", "supplierCode",
      "supplierId", "supplierName", "supplierReference", "totalAmount", "updatedAt", "updatedByLabel", "version"], "冇銀行、冇 DB 欄位名，亦冇未有表嘅 approval／GR／history（HD-017 3A）");
    assert.deepEqual(clean.orderingAddress, address);
    assert.deepEqual(clean.paymentTerm, term);
    assert.deepEqual({ a: clean.confirmedAt, b: clean.cancelledAt, c: clean.hasConfirmedReceipt, d: clean.hasOutstanding, e: clean.allowedActions, f: clean.createdByLabel },
      { a: NOW - 5, b: null, c: true, d: true, e: ["copy"], f: "maker" });
    const progress = (line) => [line.orderedBaseQuantity, line.grossReceivedBaseQuantity, line.reversedBaseQuantity, line.netReceivedBaseQuantity, line.outstandingBaseQuantity,
      line.overReceivedBaseQuantity, line.closedRemainingBaseQuantity];
    assert.deepEqual(progress(clean.lines[0]), ["10", "5", "1", "4", "4", "0", "2"]);
    assert.deepEqual(progress(clean.lines[1]), ["5", "8", "0", "8", "0", "3", "0"]);
    assert.equal(clean.lines[0].expectedDeliveryDate, "2099-12-01");
    assert.equal(clean.lines[0].unitPrice, "1.0000");

    await tx.query("UPDATE suppliers SET supplier_name = ?, status = 'inactive' WHERE id = ?", [`Renamed ${f.tag}`, f.supplierA]);
    await tx.query("UPDATE item_skus SET sku_name = ?, status = 'archived' WHERE id = ?", [`New ${f.tag}`, f.skuB.id]);
    const changed = await inquiry.get({ claims: f.viewer.claims, id: po.id });
    assert.equal(changed.supplierName, `Name${f.tag} a`, "快照唔變（AC-051）");
    assert.equal(changed.lines[1].skuName, f.skuB.name);
    assert.deepEqual(changed.currentMasterDifferences, {
      supplier: { supplierCode: `INQ-${f.tag}-a`, supplierName: `Renamed ${f.tag}`, status: "inactive" },
      lines: [{ lineId: changed.lines[1].id, skuId: f.skuB.id, skuCode: f.skuB.code, skuName: `New ${f.tag}`, skuStatus: "archived", itemStatus: "active" }]
    });
    assert.deepEqual(changed.allowedActions, [], "只有 view 冇動作");

    const draft = await inquiry.get({ claims: f.manager.claims, id: (await f.order({ supplierId: f.supplierB, lines: [{ sku: f.skuA }] })).id });
    assert.deepEqual(draft.allowedActions, ["edit", "copy"]);
    assert.deepEqual([draft.hasOutstanding, draft.lines[0].outstandingBaseQuantity], [false, "0"], "Draft 未有嘢要收");
  });
});

integrationTest("唔存在嘅 ID 回一致 404；撤咗權嘅 token 讀唔到", async (t) => {
  await inRollback(database(t), async (tx) => {
    const f = await masters(tx), inquiry = service(tx);
    const [[{ last }]] = await tx.query("SELECT COALESCE(MAX(id), 0) AS last FROM purchase_orders");
    await assert.rejects(inquiry.get({ claims: f.manager.claims, id: Number(last) + 1000 }), coded("PURCHASE_ORDER_NOT_FOUND"));
    await assert.rejects(inquiry.get({ claims: f.manager.claims, id: 0 }), coded("PURCHASING_INPUT_INVALID", "id"));

    const po = await f.order();
    await tx.query("DELETE rp FROM role_permissions rp JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?", [f.viewer.id]);
    await assert.rejects(inquiry.get({ claims: f.viewer.claims, id: po.id }), coded("PERMISSION_STALE"));
    await assert.rejects(inquiry.list({ claims: f.viewer.claims, input: { supplierId: f.supplierA } }), coded("PERMISSION_STALE"));
    await assert.rejects(inquiry.list({ claims: { sub: "0", roles: [], permissions: [] }, input: {} }));
  });
});
