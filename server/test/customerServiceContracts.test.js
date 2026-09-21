import assert from "node:assert/strict";
import test from "node:test";

import { CustomerService } from "../src/modules/customer/CustomerService.js";

const actor = { actorId: 9, claimedRoles: [], claimedPermissions: [] };
const operations = {
  async begin() { return { operationId: "11111111-1111-4111-8111-111111111111" }; },
  async succeed() {}
};
const businessMaster = {
  async assertCurrencyUsableInTransaction() {},
  async assertPaymentTermUsableInTransaction() {}
};

function input(overrides = {}) {
  return {
    ...actor,
    idempotencyKey: "customer-contract",
    customerCode: "CUS-001",
    legalName: "Example Limited",
    tradingName: "",
    ...overrides
  };
}

function serviceWithConnection(connection) {
  return new CustomerService({
    database: { withTransaction: async (work) => work(connection) },
    time: { nowMs: () => 1 },
    actorVerifier: async () => ({ username: "sam" }),
    operations,
    businessMaster
  });
}

test("TC-013 duplicate check selects normalized keys before grouping matches", async () => {
  let selectClause = "";
  const database = {
    async query(sql) {
      selectClause = String(sql).split(/\bFROM\b/u, 1)[0];
      const row = {
        id: 1, customer_code: "CUS-001", legal_name: "Example Limited", trading_name: "Example",
        general_phone: "", general_email: "", default_currency_code: null,
        default_payment_term_id: null, account_manager_user_id: null, category_id: null,
        industry_id: null, territory_id: null, status: "draft", version: 1, updated_at: 1,
        credit_status: "not_configured"
      };
      if (selectClause.includes("customer_code_key")) {
        Object.assign(row, { customer_code_key: "cus-001", legal_name_key: "example limited", trading_name_key: "example" });
      }
      return [[row]];
    }
  };
  const service = new CustomerService({ database, time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "sam" }) });

  const result = await service.checkDuplicates({ ...actor, customerCode: "CUS-001", legalName: "Example Limited", tradingName: "Example" });

  assert.match(selectClause, /customer_code_key/);
  assert.match(selectClause, /legal_name_key/);
  assert.match(selectClause, /trading_name_key/);
  assert.deepEqual(result.code.map((item) => item.id), [1]);
  assert.deepEqual(result.legalName.map((item) => item.id), [1]);
  assert.deepEqual(result.tradingName.map((item) => item.id), [1]);
});

for (const [field, table] of [
  ["categoryId", "customer_categories"],
  ["industryId", "customer_industries"],
  ["territoryId", "customer_territories"],
  ["accountManagerUserId", "users"]
]) {
  test(`TC-014 create rejects an inactive or missing ${field}`, async () => {
    const calls = [];
    const connection = {
      async query(sql) { calls.push(String(sql)); return [[]]; },
      async execute() { throw new Error("write must not run"); }
    };
    const service = serviceWithConnection(connection);

    await assert.rejects(
      () => service.create(input({ [field]: 7 })),
      (error) => error.code === "CUSTOMER_REFERENCE_NOT_USABLE" && error.statusCode === 400
    );
    assert.ok(calls.some((sql) => sql.includes(`FROM ${table}`) && sql.includes("status = 'active'")));
  });
}

test("TC-016 create maps a wrapped legal-name duplicate to the stable 409", async () => {
  const connection = {
    async query() { return [[]]; },
    async execute(sql) {
      if (String(sql).includes("INSERT INTO customers")) {
        const cause = Object.assign(new Error("Duplicate entry for key 'uq_customers_legal_name_key'"), { code: "ER_DUP_ENTRY" });
        throw Object.assign(new Error("Database query failed"), { cause });
      }
      return [{}];
    }
  };

  await assert.rejects(
    () => serviceWithConnection(connection).create(input()),
    (error) => error.code === "CUSTOMER_LEGAL_NAME_TAKEN" && error.statusCode === 409
  );
});

test("TC-016 update maps a wrapped legal-name duplicate to the stable 409", async () => {
  const before = {
    id: 1, customer_code: "CUS-001", legal_name: "Before Limited", trading_name: "",
    default_currency_code: null, default_payment_term_id: null, account_manager_user_id: null,
    category_id: null, industry_id: null, territory_id: null, website: "", general_phone: "",
    general_email: "", notes: "", status: "draft", ever_activated_at: null, version: 1,
    created_at: 1, updated_at: 1, created_by: 9, updated_by: 9
  };
  const connection = {
    async query(sql) { return String(sql).includes("FROM customers WHERE id") ? [[before]] : [[]]; },
    async execute(sql) {
      if (String(sql).startsWith("UPDATE customers SET")) {
        const cause = Object.assign(new Error("Duplicate entry for key 'uq_customers_legal_name_key'"), { code: "ER_DUP_ENTRY" });
        throw Object.assign(new Error("Database query failed"), { cause });
      }
      return [{}];
    }
  };

  await assert.rejects(
    () => serviceWithConnection(connection).update(input({ id: 1, version: 1, reason: "legal rename", legalName: "Taken Limited" })),
    (error) => error.code === "CUSTOMER_LEGAL_NAME_TAKEN" && error.statusCode === 409
  );
});

test("TC-012 root validation rejects non-HTTP websites and malformed email addresses before database work", async () => {
  const service = new CustomerService({
    database: { async withTransaction() { throw new Error("database must not run"); } },
    time: { nowMs: () => 1 }
  });

  await assert.rejects(() => service.create(input({ website: "ftp://example.test" })), /website is invalid/);
  await assert.rejects(() => service.create(input({ generalEmail: "not-an-email" })), /generalEmail is invalid/);
});
