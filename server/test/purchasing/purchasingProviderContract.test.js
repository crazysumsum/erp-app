/**
 * TASK-008 — Provider／Framework contract Gate（consumer 側）。
 *
 * 呢個 suite 刻意唔重測 provider 自己嘅行為：Supplier 嘅 non-bank projection 同
 * purchase／history purpose 語義由 `supplierLookupService.test.js` 釘住，Item 嘅
 * committed-receipt warning 矩陣同批量查詢（100 個 ID 恰好兩條 SELECT，冇 N+1）由
 * `itemLookupService.test.js` TC-019 釘住，Inventory 嘅 purchase ABI 由
 * `inventoryPurchaseContract.test.js` 同三個 integration test 釘住。
 *
 * 呢度釘嘅係 Purchasing 自己嘅假設 —— 設計 §2.4 列出嘅 provider 介面形狀、Purchasing
 * 會讀嘅 allowlisted projection keys、會分支嘅 warning 詞彙、fail-closed error code，
 * 同 Inventory 收貨路徑實際要求嘅 permission 名。provider 改到自己嘅測試仍然綠、但
 * Purchasing 嘅假設唔再成立嘅時候，紅嘅係呢個 file。
 *
 * 權限詞彙同 warning 詞彙用讀 source 嘅方式比對：呢啲常數係 provider 模組私有，而
 * Purchasing 唔可以改 Inventory 嘅檔（HD-007 B）。讀文字係為咗偵測 rename，唔係代替
 * provider 自己嘅行為測試。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { PERMISSION_CATALOGUE } from "../../src/modules/authorization/permissionCatalogue.js";
import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { InventoryLookupService } from "../../src/modules/inventory/InventoryLookupService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { BusinessMasterLookupProvider } from "../../src/modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierLookupService } from "../../src/modules/supplier/SupplierLookupService.js";
import { SupplierRelationService } from "../../src/modules/supplier/SupplierRelationService.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/** 設計 §2.4：Purchasing 讀嘅 Supplier 欄位。bank 欄永遠唔喺呢度。 */
const SUPPLIER_FIELDS = ["defaultCurrencyCode", "defaultPaymentTermId", "displayName", "reasons",
  "status", "supplierCode", "supplierId", "supplierName", "usable", "version"];

/** 設計 §3.6：Purchasing 會逐個分支嘅 warning code，多一個都要先改 Purchasing。 */
const COMMITTED_RECEIPT_WARNINGS = ["NOT_INVENTORY_TRACKED", "NOT_PURCHASABLE",
  "OUTSIDE_EFFECTIVE_RANGE", "STATUS_NOT_ACTIVE"];

function supplierRow(overrides = {}) {
  return { id: 7, supplier_code: "SUP-007", supplier_name: "Evergreen Trading", display_name: "Evergreen",
    default_currency_code: "HKD", default_payment_term_id: 3, status: "active", version: 4, ...overrides };
}

function addressRow(overrides = {}) {
  return { id: 12, supplier_id: 7, label: "總部", address_line1: "1 Main Street", address_line2: "",
    address_line3: "", city: "Hong Kong", state_region: "", postal_code: "", country_code: "HK",
    phone: "", notes: "", status: "active", sort_order: 3, version: 1, created_at: 100, updated_at: 100, ...overrides };
}

function fakeDatabase(responses = []) {
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [responses.shift() ?? []];
    }
  };
  return { calls, connection, async withTransaction(work) { return work(connection); } };
}

function supplierService(database, overrides = {}) {
  return new SupplierLookupService({
    database,
    logger: { error() {} },
    time: { nowMs: () => 1_000 },
    businessMaster: {
      async assertSupplierDefaultsInTransaction(_connection, input) {
        return {
          currency: { code: input.currencyCode, name: "Hong Kong Dollar", status: "ACTIVE", version: 1 },
          paymentTerm: input.paymentTermId === null
            ? null
            : { id: input.paymentTermId, code: "NET30", name: "Net 30", status: "ACTIVE", version: 2 }
        };
      }
    },
    ...overrides
  });
}

test("TC-011 Supplier purchase defaults expose exactly the fields Purchasing consumes", async () => {
  const database = fakeDatabase([[supplierRow()], [addressRow()]]);
  const defaults = await supplierService(database)
    .getPurchaseDefaultsInTransaction(database.connection, 7, { atMs: 1_000 });

  assert.deepEqual(Object.keys(defaults).sort(), ["currency", "orderingAddress", "paymentTerm", "supplier"]);
  assert.deepEqual(Object.keys(defaults.supplier).sort(), SUPPLIER_FIELDS);
  // 顯示次序係 Supplier 內部嘅事（DEF-037／HD-136），唔屬於呢個契約。
  assert.ok(!("sortOrder" in defaults.orderingAddress));
  assert.equal(defaults.orderingAddress.id, 12);

  // Bank 資料唔可以經任何一條 query 回嚟：SELECT 本身唔提 bank 欄。
  for (const { sql } of database.calls) assert.doesNotMatch(sql, /bank/iu);
  assert.doesNotMatch(JSON.stringify(defaults), /bank/iu);
});

test("TC-011 purchase defaults carry the currency scale and payment term Purchasing snapshots", async () => {
  // 真 SupplierLookupService → 真 BusinessMasterLookupProvider → 真 BusinessMasterProvider；只換最底嘅 repository。
  // 設計 §2.8／TASK-009：金額按 Currency 小數位（0～4）逐行 HALF_UP，所以 decimalPlaces 一定要原樣到達 Purchasing。
  assert.equal(BusinessMasterLookupProvider.contract, "business-master-currency-payment-term-provider/v1");
  for (const decimalPlaces of [0, 2, 3, 4]) {
    const repository = {
      async getCurrency(_connection, code) {
        return { code, name: "Currency", decimalPlaces, status: "ACTIVE", version: 1, createdAt: 1, internalNote: "x" };
      },
      async getPaymentTerm(_connection, id) {
        return { id, code: "NET30", name: "Net 30", calculationType: "DAYS_AFTER_INVOICE", dueDays: 30,
          status: "ACTIVE", version: 2, createdAt: 1 };
      }
    };
    const businessMaster = new BusinessMasterLookupProvider({
      provider: new BusinessMasterProvider({ database: {}, repository }),
      readiness: { async inspect() { return { status: "READY", providerContract: BusinessMasterProvider.contract }; } }
    });
    const database = fakeDatabase([[supplierRow()], [addressRow()]]);
    const { currency, paymentTerm } = await supplierService(database, { businessMaster })
      .getPurchaseDefaultsInTransaction(database.connection, 7, { atMs: 1_000 });

    assert.deepEqual(Object.keys(currency).sort(), ["code", "decimalPlaces", "name", "status", "version"]);
    assert.equal(currency.decimalPlaces, decimalPlaces);
    assert.deepEqual(Object.keys(paymentTerm).sort(),
      ["calculationType", "code", "dueDays", "id", "name", "status", "version"]);
  }
});

test("TC-011 the Supplier contract version and purposes are the ones Purchasing pinned", async () => {
  assert.equal(SupplierLookupService.contract, "supplier-core-provider/v1");

  // Purchasing 只用 purchase（提交／批准）同 history（GR confirm 讀目前狀態）。
  const database = fakeDatabase([[supplierRow()], [supplierRow({ status: "blocked" })]]);
  const service = supplierService(database);
  assert.equal((await service.findById(7, { purpose: "purchase" })).usable, true);
  const historical = await service.findById(7, { purpose: "history" });
  assert.equal(historical.status, "blocked");
  assert.equal(historical.usable, true);
  await assert.rejects(() => service.findById(7, { purpose: "receiving" }), TypeError);
});

test("TC-011 Supplier providers fail closed rather than degrade", async () => {
  const database = fakeDatabase([[supplierRow()]]);
  await assert.rejects(
    () => supplierService(database, { businessMaster: null })
      .getPurchaseDefaultsInTransaction(database.connection, 7, { atMs: 1_000 }),
    (error) => error.publicCode === "BUSINESS_MASTER_NOT_READY" && error.statusCode === 503
  );

  // 提交時嘅重驗一定要收 caller 自己嘅 transaction，唔准悄悄開一條新連線。
  const service = supplierService(fakeDatabase([[supplierRow()]]));
  for (const notAConnection of [undefined, null, {}, { execute() {} }]) {
    await assert.rejects(() => service.getPurchaseDefaultsInTransaction(notAConnection, 7), TypeError);
    await assert.rejects(() => service.assertUsableInTransaction(notAConnection, 7, { purpose: "purchase" }), TypeError);
  }
});

/** recordSupply 嘅 SQL 由 provider 自己決定；呢個 fake 唔理解語句，只答 Supplier 鎖同既有 event／relation。 */
function supplyHarness({ event = null, relation = null, sourceVerified = true } = {}) {
  const executed = [], audited = [];
  const connection = {
    async query(sql) {
      if (sql.includes("FROM suppliers")) return [[{ id: 2, supplier_code: "SUP-2", status: "active" }]];
      if (sql.includes("FROM supplier_supply_events")) return [[event].filter(Boolean)];
      if (sql.includes("FROM supplier_sku_refs WHERE supplier_id = ? AND sku_id = ?")) return [[relation].filter(Boolean)];
      return [[]];
    },
    async execute(sql, params) { executed.push({ sql, params }); return [{ insertId: 9, affectedRows: 1 }]; }
  };
  const service = new SupplierRelationService({
    database: { withTransaction: (work) => work(connection) },
    logger: { error() {} },
    time: { nowMs: () => 1_000 },
    items: { findById: async () => ({ skuId: 5, skuCode: "SKU-5", usable: true, reasons: [] }) },
    audit: { async record(_connection, entry) { audited.push(entry); } },
    ...(sourceVerified ? { verifySource: async () => {} } : {})
  });
  return { service, executed, audited };
}

const SUPPLY = Object.freeze({ eventId: "GR-1:7", sourceType: "goods_receipt", sourceId: 1, sourceLineId: 7,
  supplierId: 2, skuId: 5, suppliedAt: 10 });

test("TC-011 recordSupply replays a GR event without a second effect and never promotes the Supplier", async () => {
  const first = supplyHarness();
  assert.deepEqual(await first.service.recordSupply({ ...SUPPLY }), { eventId: "GR-1:7", relationId: 9, replayed: false });
  const eventInsert = first.executed.find(({ sql }) => sql.includes("INSERT INTO supplier_supply_events"));
  const payloadHash = eventInsert.params.find((value) => /^[0-9a-f]{64}$/u.test(String(value)));
  assert.ok(payloadHash, "the event row must carry the payload fence");
  // 設計 §2.4：供貨投影唔可以自動標 preferred。
  for (const { sql, params } of first.executed) assert.doesNotMatch(`${sql} ${JSON.stringify(params)}`, /preferred/u);
  assert.match(first.executed[0].sql, /'alternative'/u);

  // 既有 relation：只更新供貨時間，唔郁 relationship_status（stopped 唔會因為收貨復活）。
  const existing = supplyHarness({ relation: { id: 9 } });
  await existing.service.recordSupply({ ...SUPPLY });
  assert.doesNotMatch(existing.executed[0].sql, /relationship_status/u);

  // 同一 event 重送（例如 GR confirm 回應遺失後重試）：回原結果，冇第二次寫入或稽核。
  const replay = supplyHarness({ event: { event_id: "GR-1:7", relation_id: 9, payload_hash: payloadHash } });
  assert.deepEqual(await replay.service.recordSupply({ ...SUPPLY }), { eventId: "GR-1:7", relationId: 9, replayed: true });
  assert.equal(replay.executed.length, 0);
  assert.equal(replay.audited.length, 0);

  // 同一來源、唔同內容：衝突，唔覆蓋。
  const changed = supplyHarness({ event: { event_id: "GR-1:7", relation_id: 9, payload_hash: payloadHash } });
  await assert.rejects(() => changed.service.recordSupply({ ...SUPPLY, suppliedAt: 11 }),
    (error) => error.publicCode === "IDEMPOTENCY_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(changed.executed.length, 0);
});

test("TC-011 recordSupply fails closed until Purchasing supplies a GR source verifier", async () => {
  // 生產環境未有任何 verifySource：Purchasing 落地 GR 之後要自己提供，喺嗰之前投影一律 503，唔會猜來源存在。
  const unwired = supplyHarness({ sourceVerified: false });
  await assert.rejects(() => unwired.service.recordSupply({ ...SUPPLY }),
    (error) => (error.publicCode ?? error.code) === "SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE" && error.statusCode === 503);
  assert.equal(unwired.executed.length, 0);
});

test("TC-011 the Item committed receipt warning vocabulary stays the one Purchasing branches on", () => {
  const text = source("../../src/modules/item/ItemLookupService.js");
  const method = text.slice(text.indexOf("async findManyForCommittedReceipt"));
  const body = method.slice(0, method.indexOf("\n  async ", 1));
  const emitted = [...body.matchAll(/warnings\.push\("([A-Z_]+)"\)/gu)].map((match) => match[1]).sort();

  assert.deepEqual(emitted, COMMITTED_RECEIPT_WARNINGS);
  // Purchasing 唔准讀 usable／reasons：資格由 PO 確認快照決定，唔係由現在嘅 lookup 決定。
  assert.match(body, /delete projection\.usable/u);
  assert.match(body, /delete projection\.reasons/u);
});

test("TC-011 the Inventory purchase ABI is reachable as two transaction-first batch calls", () => {
  for (const name of ["postPurchaseReceiptBatchInTransaction", "reversePurchaseReceiptBatchInTransaction"]) {
    const method = InventoryPostingService.prototype[name];
    assert.equal(typeof method, "function", `${name} must stay on the posting service`);
    assert.equal(method.length, 2, `${name} must take (transaction, command)`);
  }
  assert.equal(typeof InventoryLookupService.prototype.findOperationsBySource, "function");

  // 設計 §8.7：唔准逐 detail 叫單筆 posting 代替 batch。
  const posting = source("../../src/modules/inventory/InventoryPostingService.js");
  assert.match(posting, /postPurchaseReceiptBatchInTransaction\(tx, command\)/u);
});

test("TC-011 every permission the Inventory purchase path demands exists in the catalogue", () => {
  const catalogue = new Set(PERMISSION_CATALOGUE.map((entry) => entry.name));
  const posting = source("../../src/modules/inventory/InventoryPostingService.js");
  const purchase = source("../../src/modules/inventory/InventoryPurchaseService.js");

  // PURCHASING_RECEIVING 路徑自己宣告嘅 caller permission。
  const receiving = posting.slice(posting.indexOf("const RECEIVING_RECEIPT"));
  const declared = [
    receiving.match(/requiredCallerPermission: "([a-z.]+)"/u)[1],
    posting.match(/const OVERRIDE_PERMISSION = "([a-z.]+)"/u)[1],
    ...[...purchase.matchAll(/permissions\.includes\("([a-z.]+)"\)/gu)].map((match) => match[1])
  ];

  assert.ok(declared.length >= 3, "expected the receiving, override and purchase-service demands");
  for (const permission of declared) {
    assert.ok(catalogue.has(permission),
      `Inventory demands "${permission}" but PERMISSION_CATALOGUE does not define it`);
  }
  // 呢兩個就係 TASK-003 之前令收貨 provider 無法到達嘅缺口。
  assert.ok(declared.includes("receiving.operation"));
  assert.ok(declared.includes("receiving.expiry.override"));
});
