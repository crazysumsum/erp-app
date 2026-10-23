import assert from "node:assert/strict";
import test from "node:test";

import { CreateSupplierHandler } from "../src/handlers/suppliers/createSupplierHandler.js";
import { ActivateSupplierHandler } from "../src/handlers/suppliers/supplierLifecycleHandlers.js";
import { CheckSupplierDuplicatesHandler } from "../src/handlers/suppliers/supplierQueryHandlers.js";
import { ChangeSupplierCodeHandler, UpdateSupplierHandler } from "../src/handlers/suppliers/supplierUpdateHandlers.js";
import { SupplierAdminService } from "../src/modules/supplier/SupplierAdminService.js";
import { SupplierDuplicateCandidates } from "../src/modules/supplier/supplierDuplicateCandidates.js";

/** DEF-030（HD-116 A）：SUPPLIER_DUPLICATE_NAME_THRESHOLD 真係去到每個做相似名稱檢查嘅 handler。 */
function services(threshold) {
  return {
    config: { supplier: { duplicateNameThreshold: threshold } },
    require(name) {
      if (name === "logging") return { logger: { warn() {}, info() {}, error() {} } };
      return { query: async () => [[]], nowMs: () => 1 };
    },
    get() { return undefined; },
    has() { return true; }
  };
}

test("DEF-030 (HD-116 A): every Supplier handler that checks similar names uses the configured threshold", () => {
  for (const Handler of [CreateSupplierHandler, UpdateSupplierHandler, ChangeSupplierCodeHandler, ActivateSupplierHandler, CheckSupplierDuplicatesHandler]) {
    assert.equal(new Handler(services(0.93)).suppliers.duplicates.threshold, 0.93, Handler.name);
  }
  // 冇設定（例如單元測試嘅 fake services）就係類別預設。
  const fallback = new CreateSupplierHandler({ ...services(undefined), config: {} });
  assert.equal(fallback.suppliers.duplicates.threshold, new SupplierDuplicateCandidates().threshold);
});

test("DEF-030 (HD-116 A): the service builds its checker from the threshold unless a checker is injected", () => {
  const base = { database: {}, logger: {}, time: {}, businessMaster: {} };
  assert.equal(new SupplierAdminService({ ...base, duplicateNameThreshold: 0.7 }).duplicates.threshold, 0.7);
  const injected = { threshold: 0.5, find: async () => [] };
  assert.equal(new SupplierAdminService({ ...base, duplicateNameThreshold: 0.7, duplicates: injected }).duplicates, injected);
});
