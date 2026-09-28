import assert from "node:assert/strict";
import test from "node:test";

import { ServiceContainer } from "../src/framework/services/ServiceContainer.js";
import { BusinessMasterProvider } from "../src/modules/businessMaster/BusinessMasterProvider.js";
import {
  SupplierBankKeyCheckService,
  SupplierBusinessMasterImpactCheckerService,
  SupplierCoreProviderService
} from "../src/modules/supplier/SupplierProviderServices.js";
import { SupplierLookupService } from "../src/modules/supplier/SupplierLookupService.js";
import { MySqlDatabaseOperationError } from "../src/services/mysqldatabase/MySqlDatabaseService.js";

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

test("DEF-027: startup logs bank rows on a key outside the ring as an error, and never refuses to start", async () => {
  const supplier = {
    bankEncryption: { activeKeyId: "enc-1", keyRing: { "enc-1": "x" } },
    bankLookup: { activeKeyId: "look-2", keyRing: { "look-1": "x", "look-2": "x" } }
  };
  const start = async ({ config = { supplier }, counts = {}, fails = false } = {}) => {
    const queries = [];
    const errors = [];
    const infos = [];
    const container = new ServiceContainer({
      config,
      definitions: [definition(SupplierBankKeyCheckService)],
      values: {
        mysqldatabase: { async query(sql, params) {
          queries.push([sql, params]);
          if (fails) {
            // 同真嘅 MySqlDatabaseExecutor 一樣包一層（REV-057 L-3）。
            const driver = Object.assign(new Error("Table 'erp.supplier_bank_accounts' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
            throw new MySqlDatabaseOperationError("MySQL database query failed", { cause: driver });
          }
          return [[{ n: counts[sql.includes("blind_index_key_id") ? "lookup" : "encryption"] ?? 0 }]];
        } },
        logging: { logger: { async error(...args) { errors.push(args); }, async info(...args) { infos.push(args); } } }
      }
    });
    await container.initialize();
    return { queries, errors, infos };
  };
  const events = (list) => list.map(([event, , context]) => [event, context]);

  const healthy = await start();
  assert.deepEqual(healthy.errors, [], "a clean database logs no error");
  assert.deepEqual(events(healthy.infos), [["supplier.bank.key_check_completed", { encryption: 0, lookup: 0 }]],
    "but it does say the check ran, so silence is not the pass signal");
  assert.deepEqual(healthy.queries.map(([, params]) => params), [["enc-1"], ["look-1", "look-2"]], "each column against its own ring");

  const broken = await start({ counts: { lookup: 2 } });
  assert.deepEqual(events(broken.errors), [["supplier.bank.keys_outside_ring", { kind: "lookup", rows: 2 }]]);
  assert.deepEqual(events(broken.infos), [["supplier.bank.key_check_completed", { encryption: 0, lookup: 2 }]]);

  const failing = await start({ fails: true });
  assert.deepEqual(events(failing.errors), [["supplier.bank.key_check_failed", { reason: "ER_NO_SUCH_TABLE" }]],
    "a failed check is logged with the driver's code, not thrown");
  assert.deepEqual(failing.infos, [], "and is not reported as completed");

  const undeployed = await start({ config: {} });
  assert.equal(undeployed.queries.length, 0, "no Bank keys configured, nothing to check (design §1700)");
  assert.deepEqual([...undeployed.errors, ...undeployed.infos], [], "and nothing to alert on (REV-057 L-2)");
});
