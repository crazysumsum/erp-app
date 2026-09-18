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
