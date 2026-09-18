import assert from "node:assert/strict";
import test from "node:test";

import { GetSupplierBusinessMasterReadinessHandler } from "../src/handlers/supplier-lookups/businessMasterReadinessHandler.js";
import { GetSupplierSettingsHandler } from "../src/handlers/supplier-settings/settingsHandlers.js";

const services = { require: () => ({ logger: { warn() {} }, nowMs: () => 1 }) };

function handlerWith(readiness) {
  const handler = new GetSupplierBusinessMasterReadinessHandler(services);
  handler.readiness = { async inspect() { return readiness; } };
  return handler;
}

const FULL = Object.freeze({
  status: "READY",
  providerContract: "business-master-currency-payment-term-provider/v1",
  schemaReady: true,
  hkdReady: true,
  permissionsReady: true,
  checkerIds: ["supplier"],
  activeCurrencyCount: 3,
  activePaymentTermCount: 2
});

test("the readiness lookup lives under supplier-lookups, not under business-master", () => {
  // HD-022：Business Master 擁有嗰個 catalog，但 consumer-facing 嘅讀取由 consumer
  // 自己嘅 handler 用自己嘅 permission 授權（Business Master DES-001／DES-012）。
  assert.equal(GetSupplierBusinessMasterReadinessHandler.api.path, "/api/v1/supplier-lookups/business-master");
  assert.equal(GetSupplierBusinessMasterReadinessHandler.api.method, "GET");
});

test("it requires exactly supplier.settings, the same permission as the page that uses it", () => {
  // 設計 §4.3：permission catalogue 冇隱式繼承，所以唔可以當 supplier.settings
  // 持有人順手有 supplier.view。
  const [policy] = GetSupplierBusinessMasterReadinessHandler.api.authorizationPolicies;
  // REV-028 L-1：policy 個名打錯（hasPermissions）會令 registry 喺開機時拋，但呢個
  // 檔案原本只睇 options，所以打錯字喺呢度係綠嘅。
  assert.equal(policy.name, "hasPermission");
  assert.deepEqual(policy.options.permissions, ["supplier.settings"]);
  assert.equal(policy.options.match, undefined, "both-or-nothing is the default; do not relax it to any");
  assert.deepEqual(
    policy.options.permissions,
    GetSupplierSettingsHandler.api.authorizationPolicies[0].options.permissions,
    "the lookup and the settings read must not drift apart"
  );
});

test("reading readiness does not demand a password, and its schemas are closed", () => {
  assert.equal(GetSupplierBusinessMasterReadinessHandler.api.authType, undefined);
  for (const [part, schema] of Object.entries(GetSupplierBusinessMasterReadinessHandler.api.requestSchema)) {
    assert.equal(schema.additionalProperties, false, `${part} is open`);
  }
  assert.equal(GetSupplierBusinessMasterReadinessHandler.api.responseSchema[200].additionalProperties, false);
});

test("the response is a whitelist: internal assembly detail cannot leak through it", async () => {
  // checkerIds 係 server 內部組裝細節。用 { ...result } 會令佢靜靜哋出到街，而
  // 因為 response schema 係 closed，真正嘅後果係 500 而唔係洩漏——兩個都唔想要。
  const { data } = await handlerWith(FULL).execute();
  assert.deepEqual(Object.keys(data).sort(), [
    "activeCurrencyCount", "activePaymentTermCount", "hkdReady",
    "permissionsReady", "providerContract", "schemaReady", "status"
  ]);
  assert.ok(!("checkerIds" in data));
});

test("a NOT_READY provider is reported, not turned into an error", async () => {
  // BusinessMasterLookupProvider.assertReady() 唔 READY 就拋 503。呢條 route 嘅工作
  // 正正係報告嗰個狀態畀設定頁顯示，所以佢唔可以行嗰條路。
  const { data } = await handlerWith({
    ...FULL, status: "NOT_READY", hkdReady: false, activeCurrencyCount: 0
  }).execute();
  assert.equal(data.status, "NOT_READY");
  assert.equal(data.hkdReady, false);
  assert.equal(data.activeCurrencyCount, 0);
});

test("every declared field survives the projection", async () => {
  // 漏抄一個欄位會令 response schema 嘅 required 喺 runtime 先爆。
  const { data } = await handlerWith(FULL).execute();
  for (const field of GetSupplierBusinessMasterReadinessHandler.api.responseSchema[200].required) {
    assert.ok(field in data, `${field} is required by the schema but never projected`);
  }
});

// ---- REV-028 M-2: the real readiness service, not a hand-written object -----

/**
 * 上面每個 case 都換走咗 handler.readiness，所以真正嗰個 service 由頭到尾冇行過。
 * 呢兩個 case 行真嘅 BusinessMasterReadinessService，只係俾佢一個好似 MySQL 咁
 * 失敗嘅 database double。
 */
async function realServiceHandler(fail) {
  const { BusinessMasterReadinessService } = await import("../src/modules/businessMaster/BusinessMasterReadinessService.js");
  const handler = new GetSupplierBusinessMasterReadinessHandler(services);
  handler.readiness = new BusinessMasterReadinessService({
    database: { async query() { throw fail(); } },
    checkerIds: ["supplier"]
  });
  return handler;
}

test("absent Business Master tables read as NOT_READY, which is what the page must show", async () => {
  // inspect() 查 currencies 係喺計 schemaReady 之前，而且冇 try。表未建 —— 即係
  // schemaReady 應該係 false 嗰個最常見原因 —— 本來會變成 500，設定頁就永遠顯示
  // 唔到「資料表尚未建立或版本不符」。
  const handler = await realServiceHandler(() => {
    const error = new Error("Table 'erp_dev.currencies' doesn't exist");
    error.code = "ER_NO_SUCH_TABLE";
    error.errno = 1146;
    return error;
  });
  const { data } = await handler.execute();
  assert.equal(data.status, "NOT_READY");
  assert.equal(data.schemaReady, false);
  assert.equal(data.activeCurrencyCount, 0);
  assert.equal(data.providerContract, "business-master-currency-payment-term-provider/v1");
});

test("any other database failure is not dressed up as a readiness answer", async () => {
  // 連線斷、逾時、權限 —— 嗰啲情況我哋根本唔知 provider 就唔就緒。報 NOT_READY
  // 等於講一個未證實嘅嘢，所以要照拋。
  const handler = await realServiceHandler(() => {
    const error = new Error("Connection lost");
    error.code = "PROTOCOL_CONNECTION_LOST";
    return error;
  });
  await assert.rejects(() => handler.execute(), (error) => error.code === "PROTOCOL_CONNECTION_LOST");
});

test("a table present with the wrong columns is the version-mismatch half of the same label", async () => {
  // REV-029 L-1：頁面個 label 講「資料表尚未建立**或版本不符**」，而 1054 就係
  // 第二種。inspect() 喺行 inspectBusinessMasterSchema 之前已經 SELECT 過欄位,
  // 所以嗰個專門用嚟驗結構嘅檢查，永遠行唔到喺一個結構真係壞咗嘅 schema 上面。
  const handler = await realServiceHandler(() => {
    const error = new Error("Unknown column 'decimal_places' in 'field list'");
    error.code = "ER_BAD_FIELD_ERROR";
    error.errno = 1054;
    return error;
  });
  const { data } = await handler.execute();
  assert.equal(data.status, "NOT_READY");
  assert.equal(data.schemaReady, false);
});
