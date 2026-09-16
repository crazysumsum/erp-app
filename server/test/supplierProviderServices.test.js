import assert from "node:assert/strict";
import test from "node:test";

import { ServiceContainer } from "../src/framework/services/ServiceContainer.js";
import { BusinessMasterProvider } from "../src/modules/businessMaster/BusinessMasterProvider.js";
import {
  SupplierBusinessMasterImpactCheckerService,
  SupplierCoreProviderService
} from "../src/modules/supplier/SupplierProviderServices.js";
import { SupplierLookupService } from "../src/modules/supplier/SupplierLookupService.js";

function definition(ServiceClass) {
  return {
    ...ServiceClass.service,
    enabled: true,
    ServiceClass,
    moduleUrl: `test:${ServiceClass.name}`
  };
}

test("the application container resolves both Supplier provider contracts and a downstream consumer can call Core lookup", async () => {
  const supplier = {
    id: 7,
    supplier_code: "SUP-007",
    supplier_name: "Evergreen Trading",
    display_name: "Evergreen",
    default_currency_code: "HKD",
    default_payment_term_id: null,
    status: "active",
    version: 4
  };
  const connection = {
    async query(sql) {
      if (/WHERE id = \?/u.test(sql)) return [[supplier]];
      throw new Error(`unexpected transaction query: ${sql}`);
    }
  };
  const database = {
    async query(sql) {
      if (/table_name IN/u.test(sql)) {
        return [[
          { table_name: "supplier_address_purposes" },
          { table_name: "supplier_addresses" },
          { table_name: "suppliers" }
        ]];
      }
      if (/COALESCE\(SUM/u.test(sql)) {
        return [[{ active_default_count: 1, open_use_count: 0, historical_count: 0, total_count: 1, max_updated_at: 20, max_id: 7, version_sum: 4 }]];
      }
      if (/table_name = 'suppliers'/u.test(sql)) return [[{ present: 1 }]];
      throw new Error(`unexpected database query: ${sql}`);
    },
    async withTransaction(work) {
      return work(connection);
    }
  };
  const businessMaster = {
    provider: {},
    readiness: {
      async inspect() {
        return { status: "READY", providerContract: BusinessMasterProvider.contract };
      }
    }
  };
  const container = new ServiceContainer({
    definitions: [definition(SupplierBusinessMasterImpactCheckerService), definition(SupplierCoreProviderService)],
    values: {
      mysqldatabase: database,
      logging: { logger: { info() {}, error() {} } },
      time: { nowMs: () => 1_000 },
      businessMaster
    }
  });
  await container.initialize();

  const core = container.require("supplierCoreProvider");
  assert.equal(core.constructor.service.name, "supplierCoreProvider");
  assert.equal(SupplierLookupService.contract, "supplier-core-provider/v1");
  assert.equal((await core.findById(7, { purpose: "purchase" })).supplierCode, "SUP-007");
  assert.deepEqual(await core.inspectReadiness(), {
    status: "READY",
    providerContract: "supplier-core-provider/v1",
    businessMasterContract: BusinessMasterProvider.contract,
    schemaReady: true
  });

  const impact = container.require("supplierBusinessMasterImpactChecker");
  assert.equal(impact.id, "supplier");
  assert.equal((await impact.check({ entityType: "CURRENCY", entityKey: "HKD" })).activeDefaultCount, 1);
});
