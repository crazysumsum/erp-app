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

function customerRow(overrides = {}) {
  return {
    id: 21, customer_code: "CUS-021", customer_code_key: "cus-021",
    legal_name: "Example Limited", legal_name_key: "example limited", trading_name: "Example",
    trading_name_key: "example", default_currency_code: "HKD", default_payment_term_id: 2,
    account_manager_user_id: 3, category_id: 4, industry_id: 5, territory_id: 6,
    website: "https://example.test", general_phone: "1234", general_email: "ops@example.test",
    notes: "note", status: "draft", ever_activated_at: null, version: 1,
    created_at: 1, updated_at: 1, created_by: 9, updated_by: 9,
    ...overrides
  };
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

test("TC-014 update preserves unchanged inactive references", async () => {
  const before = {
    id: 1, customer_code: "CUS-001", legal_name: "Example Limited", trading_name: "",
    default_currency_code: "HKD", default_payment_term_id: 2, account_manager_user_id: 3,
    category_id: 4, industry_id: 5, territory_id: 6, website: "", general_phone: "",
    general_email: "", notes: "", status: "draft", ever_activated_at: null, version: 1,
    created_at: 1, updated_at: 1, created_by: 9, updated_by: 9
  };
  let reads = 0;
  const connection = {
    async query(sql) {
      if (!String(sql).includes("FROM customers WHERE id")) throw new Error("unchanged references must not be revalidated");
      reads += 1;
      return [[{ ...before, version: reads === 1 ? 1 : 2 }]];
    },
    async execute(sql) {
      if (!String(sql).startsWith("UPDATE customers SET")) throw new Error(`Unexpected write: ${sql}`);
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerService({
    database: { withTransaction: async (work) => work(connection) },
    time: { nowMs: () => 2 }, actorVerifier: async () => ({ username: "sam" }), operations,
    audit: { async record() {} },
    businessMaster: {
      async assertCurrencyUsableInTransaction() { throw new Error("unchanged currency must not be revalidated"); },
      async assertPaymentTermUsableInTransaction() { throw new Error("unchanged payment term must not be revalidated"); }
    }
  });

  const result = await service.update(input({
    id: 1, version: 1, reason: "metadata correction", defaultCurrencyCode: "HKD",
    defaultPaymentTermId: 2, accountManagerUserId: 3, categoryId: 4, industryId: 5, territoryId: 6
  }));

  assert.equal(result.customer.version, 2);
});

test("TC-014 update rejects a changed inactive reference", async () => {
  const before = {
    id: 1, customer_code: "CUS-001", legal_name: "Example Limited", trading_name: "",
    default_currency_code: null, default_payment_term_id: null, account_manager_user_id: null,
    category_id: 4, industry_id: null, territory_id: null, website: "", general_phone: "",
    general_email: "", notes: "", status: "draft", ever_activated_at: null, version: 1,
    created_at: 1, updated_at: 1, created_by: 9, updated_by: 9
  };
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers WHERE id")) return [[before]];
      if (String(sql).includes("FROM customer_categories")) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute() { throw new Error("write must not run"); }
  };

  await assert.rejects(
    () => serviceWithConnection(connection).update(input({ id: 1, version: 1, reason: "category correction", categoryId: 7 })),
    (error) => error.code === "CUSTOMER_REFERENCE_NOT_USABLE" && error.statusCode === 400
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

test("Customer import row application creates the full aggregate without dropping optional children", async () => {
  const writes = [];
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM customer_credit_profiles")) return [[]];
      if (text.includes("FROM customers WHERE id")) return [[customerRow()]];
      if (/FROM (?:customer_categories|customer_industries|customer_territories|users)/u.test(text)) return [[{ id: 1 }]];
      throw new Error(`Unexpected query: ${text}`);
    },
    async execute(sql) {
      const text = String(sql); writes.push(text);
      if (text.includes("INSERT INTO customers")) return [{ insertId: 21 }];
      if (text.includes("INSERT INTO customer_addresses")) return [{ insertId: 31 }];
      if (text.includes("INSERT INTO customer_contacts")) return [{ insertId: 32 }];
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerService({
    database: {}, time: { nowMs: () => 1 }, audit: { async record() {} },
    businessMaster: {
      async assertCurrencyUsableInTransaction() {},
      async assertPaymentTermUsableInTransaction() {}
    }
  });
  const customerId = await service.applyImportRowInTransaction(connection, {
    job: { activation_mode: "draft" }, row: {
      operation: "create",
      normalized_payload: JSON.stringify({
        root: {
          customerCode: "CUS-021", legalName: "Example Limited", tradingName: "Example",
          defaultCurrencyCode: "HKD", defaultPaymentTermId: 2, accountManagerUserId: 3,
          categoryId: 4, industryId: 5, territoryId: 6, website: "https://example.test",
          generalPhone: "1234", generalEmail: "ops@example.test", notes: "note"
        },
        address: {
          label: "HQ", recipientCompanyDepartment: "Ops", addressLine1: "1 Road", addressLine2: "",
          addressLine3: "", city: "Hong Kong", stateRegion: "", postalCode: "", countryCode: "HK",
          phone: "1234", notes: "", sortOrder: 0, purposes: [{ code: "billing", isDefault: true }]
        },
        contact: {
          name: "Alex", jobTitle: "Manager", department: "Ops", email: "alex@example.test",
          phone: "1234", mobile: "5678", preferredLanguage: "en", notes: "", sortOrder: 0,
          purposes: [{ code: "general", isDefault: true }]
        },
        identifier: {
          identifierType: "tax", issuerCountryCode: "HK", identifierValue: "12-34",
          validFrom: null, expiresAt: null, notes: ""
        },
        credit: { creditLimit: "100.0000", creditCurrencyCode: "HKD", creditStatus: "normal" }
      })
    }, actor: { id: 9, username: "sam", permissions: [] }, nowMs: 1
  });

  assert.equal(customerId, 21);
  for (const table of [
    "customers", "customer_addresses", "customer_address_purposes", "customer_contacts",
    "customer_contact_purposes", "customer_identifiers", "customer_credit_profiles"
  ]) assert.ok(writes.some((sql) => sql.includes(`INSERT INTO ${table}`)), table);
});

test("Customer import update inherits omitted root fields and rejects invalid row contexts", async () => {
  let reads = 0;
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM customers WHERE id")) {
        reads += 1;
        return [[customerRow({ version: reads === 1 ? 1 : 2 })]];
      }
      throw new Error(`Unexpected query: ${text}`);
    },
    async execute(sql) {
      assert.match(String(sql), /^UPDATE customers SET/u);
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerService({ database: {}, time: { nowMs: () => 1 }, audit: { async record() {} } });

  assert.equal(await service.applyImportRowInTransaction(connection, {
    job: { activation_mode: "draft" },
    row: { operation: "update", match_customer_id: 21, expected_customer_version: 1, normalized_payload: { root: {} } },
    actor: { id: 9, username: "sam", permissions: [] }, nowMs: 1
  }), 21);
  await assert.rejects(
    () => service.applyImportRowInTransaction(null, {}),
    /row context is invalid/u
  );
  await assert.rejects(
    () => service.applyImportRowInTransaction(connection, {
      job: {}, row: { operation: "delete", normalized_payload: {} }, actor: { id: 9 }, nowMs: 1
    }),
    /operation is invalid/u
  );
});
