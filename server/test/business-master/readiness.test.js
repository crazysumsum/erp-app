import assert from "node:assert/strict";
import test from "node:test";

import { BusinessMasterReadinessService } from "../../src/modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterService } from "../../src/modules/businessMaster/BusinessMasterService.js";

test("TC-015 readiness reports the provider contract, schema, HKD, permissions, and checker registry", async () => {
  const database = {
    async query(sql) {
      if (sql.includes("information_schema.tables")) return [[{ TABLE_NAME: "business_master_audit_logs" }, { TABLE_NAME: "currencies" }, { TABLE_NAME: "payment_terms" }]];
      if (sql.includes("COUNT(*) AS total FROM currencies")) return [[{ total: 1 }]];
      if (sql.includes("COUNT(*) AS total FROM payment_terms")) return [[{ total: 0 }]];
      if (sql.includes("FROM currencies")) return [[{ code: "HKD", decimal_places: 2, status: "ACTIVE" }]];
      if (sql.includes("FROM permissions")) return [[{ name: "business_master.mgmt" }, { name: "business_master.view" }]];
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
  const readiness = new BusinessMasterReadinessService({
    database,
    checkerIds: ["customer", "supplier", "sales", "purchasing", "ar", "ap"],
    schemaInspector: async () => new Map([["business_master_audit_logs", new Set()], ["currencies", new Set()], ["payment_terms", new Set()]])
  });
  assert.deepEqual(await readiness.inspect(), {
    status: "READY",
    providerContract: "business-master-currency-payment-term-provider/v1",
    schemaReady: true,
    hkdReady: true,
    permissionsReady: true,
    checkerIds: ["ap", "ar", "customer", "purchasing", "sales", "supplier"],
    activeCurrencyCount: 1,
    activePaymentTermCount: 0
  });
});

test("TC-015 eager Business Master service registers provider and fails startup when readiness is not READY", async () => {
  const ready = {
    async inspect() {
      return { status: "READY", providerContract: "business-master-currency-payment-term-provider/v1" };
    }
  };
  const logged = [];
  const service = new BusinessMasterService({
    services: {
      require(name) {
        if (name === "mysqldatabase") return {};
        if (name === "logging") return { logger: { async info(event, message, context) { logged.push({ event, message, context }); } } };
        throw new Error(`unexpected service: ${name}`);
      }
    },
    options: { readiness: ready }
  });

  await service.initialize();
  assert.equal(service.provider.constructor.contract, "business-master-currency-payment-term-provider/v1");
  assert.equal(logged[0].event, "business_master.readiness.ready");

  const unavailable = new BusinessMasterService({
    services: {
      require(name) {
        if (name === "mysqldatabase") return {};
        if (name === "logging") return { logger: { async info() {} } };
        throw new Error(`unexpected service: ${name}`);
      }
    },
    options: { readiness: { async inspect() { return { status: "NOT_READY", schemaReady: false }; } } }
  });
  await assert.rejects(() => unavailable.initialize(), /Business Master readiness failed/);
});
