import assert from "node:assert/strict";
import test from "node:test";

import { CustomerService } from "../src/modules/customer/CustomerService.js";

const rowsById = {
  3: {
    id: 3, customer_code: "CUS-003", legal_name: "Three Limited", trading_name: "",
    default_currency_code: null, default_payment_term_id: null, account_manager_user_id: null,
    category_id: null, industry_id: null, territory_id: null, general_phone: "", general_email: "",
    credit_status: "not_configured", status: "draft", version: 1, updated_at: 30
  },
  9: {
    id: 9, customer_code: "CUS-009", legal_name: "Nine Limited", trading_name: "Nine",
    default_currency_code: "HKD", default_payment_term_id: 2, account_manager_user_id: null,
    category_id: null, industry_id: null, territory_id: null, general_phone: "", general_email: "",
    credit_status: "on_hold", status: "draft", version: 4, updated_at: 90
  }
};

test("TC-028 Customer list pages stable IDs before fetching the summary projection", async () => {
  const queries = [];
  const database = {
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (text.includes("COUNT(*)")) return [[{ total: 2 }]];
      if (/SELECT id FROM customers/.test(text)) return [[{ id: 9 }, { id: 3 }]];
      if (text.includes("WHERE id IN")) return [[rowsById[3], rowsById[9]]];
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  const service = new CustomerService({
    database,
    time: { nowMs: () => 1 },
    actorVerifier: async () => ({ username: "list-test" })
  });

  const result = await service.list({ actorId: 1, claimedRoles: [], claimedPermissions: [], page: 1, pageSize: 20 });

  assert.deepEqual(result.items.map((item) => item.id), [9, 3]);
  assert.equal(result.total, 2);
  assert.equal(queries.length, 3);
  assert.match(queries[1], /SELECT id FROM customers/);
  assert.match(queries[0], /status <> 'archived'/);
  assert.doesNotMatch(queries[1], /JOIN customer_(?:addresses|contacts|identifiers)/);
  assert.match(queries[2], /WHERE id IN/);
  assert.deepEqual(result.items.map((item) => item.creditStatus), ["on_hold", "not_configured"]);
});

test("TC-028 Customer list accepts a maximum-length legal-name prefix without normalizing it as a code", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes("COUNT(*)")) return [[{ total: 0 }]];
      if (/SELECT id FROM customers/.test(sql)) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const service = new CustomerService({
    database,
    time: { nowMs: () => 1 },
    actorVerifier: async () => ({ username: "list-test" })
  });

  const result = await service.list({ actorId: 1, claimedRoles: [], claimedPermissions: [], q: "L".repeat(190) });

  assert.deepEqual(result.items, []);
  assert.doesNotMatch(queries[0].sql, /customer_code_key LIKE/);
  assert.equal(queries[0].params.length, 13);
  assert.equal(queries[0].params[4], `${"L".repeat(190)}%`);
  assert.ok(queries[0].params.filter((_, index) => index !== 4).every((value) => value === `${"l".repeat(190)}%`));
});

test("TC-012/013 Customer list applies the approved search, filter, missing-data and ranking contract", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes("COUNT(*)")) return [[{ total: 0 }]];
      if (/SELECT id FROM customers/.test(sql)) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const service = new CustomerService({ database, time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "list-test" }) });

  await service.list({
    actorId: 1, claimedRoles: [], claimedPermissions: [], q: "CUS-001", status: ["draft", "active"],
    currencyCode: "HKD", paymentTermId: 2, accountManagerUserId: 3, categoryId: 4,
    industryId: 5, territoryId: 6, creditStatus: "on_hold",
    missing: ["shippingDefault", "billingDefault", "contactDefault", "paymentTerm", "credit"],
    createdFrom: 10, createdTo: 20, updatedFrom: 30, updatedTo: 40,
    sortBy: "accountManager", sortDirection: "asc"
  });

  const countSql = queries[0].sql;
  const pageSql = queries[1].sql;
  assert.match(countSql, /trading_name_key LIKE/);
  assert.match(countSql, /general_phone LIKE/);
  assert.match(countSql, /general_email LIKE/);
  assert.match(countSql, /EXISTS \(SELECT 1 FROM customer_identifiers/);
  assert.match(countSql, /EXISTS \(SELECT 1 FROM customer_contacts/);
  assert.match(countSql, /EXISTS \(SELECT 1 FROM customer_addresses/);
  assert.match(countSql, /status IN \(\?,\?\)/);
  assert.match(countSql, /default_currency_code = \?/);
  assert.match(countSql, /EXISTS \(SELECT 1 FROM customer_credit_profiles/);
  assert.match(countSql, /purpose_code = 'shipping'/);
  assert.match(countSql, /purpose_code = 'billing'/);
  assert.match(countSql, /purpose_code = 'general'/);
  assert.match(countSql, /default_payment_term_id IS NULL/);
  assert.match(countSql, /NOT EXISTS \(SELECT 1 FROM customer_credit_profiles/);
  assert.match(countSql, /created_at >= \?/);
  assert.match(countSql, /updated_at <= \?/);
  assert.match(pageSql, /CASE WHEN customer_code_key = \? THEN 0 WHEN legal_name_key = \? THEN 1 ELSE 2 END/);
  assert.match(pageSql, /account_manager_user_id ASC/);
});

test("TC-013 Customer list rejects Phase 1 filters whose resources are not delivered", async () => {
  const service = new CustomerService({
    database: { async query() { throw new Error("database query must not run"); } },
    time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "list-test" })
  });

  await assert.rejects(
    () => service.list({ actorId: 1, claimedRoles: [], claimedPermissions: [], missing: ["bank"] }),
    /missing value is not supported: bank/
  );
});

for (const [method, table, item] of [
  ["listAddresses", "customer_addresses", { id: 11, customer_id: 9, label: "HQ", recipient_company_department: "", address_line1: "1 Main", address_line2: "", address_line3: "", city: "", state_region: "", postal_code: "", country_code: null, phone: "", notes: "", sort_order: 0, status: "active", version: 1 }],
  ["listContacts", "customer_contacts", { id: 12, customer_id: 9, name: "Sam", job_title: "", department: "", email: "", phone: "", mobile: "", preferred_language: "", notes: "", sort_order: 0, status: "active", version: 1 }],
  ["listIdentifiers", "customer_identifiers", { id: 13, customer_id: 9, identifier_type: "tax", issuer_country_code: "HK", identifier_value: "123", valid_from: null, expires_at: null, notes: "", status: "active", version: 1 }]
]) {
  test(`TC-013 ${method} returns a stable server-paginated projection`, async () => {
    const root = { ...rowsById[9], website: "", notes: "", ever_activated_at: null, created_at: 1, created_by: 1, updated_by: 1 };
    const database = {
      async query(sql, params) {
        const text = String(sql);
        if (text.includes("FROM customers WHERE id")) return [[root]];
        if (text.includes(`COUNT(*) AS total FROM ${table}`)) return [[{ total: 1 }]];
        if (text.includes(`FROM ${table}`)) {
          assert.deepEqual(params, [9, 10, 10]);
          return [[item]];
        }
        if (text.includes("FROM customer_address_purposes")) return [[{ address_id: 11, purpose_code: "shipping", is_default: 1 }]];
        if (text.includes("FROM customer_contact_purposes")) return [[{ contact_id: 12, purpose_code: "general", is_default: 1 }]];
        throw new Error(`Unexpected query: ${text}`);
      }
    };
    const service = new CustomerService({ database, time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "list-test" }) });

    const result = await service[method]({ actorId: 1, claimedRoles: [], claimedPermissions: [], id: 9, page: 2, pageSize: 10 });

    assert.equal(result.total, 1);
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 10);
    assert.equal(result.items[0].id, item.id);
  });
}

test("TC-013 Customer detail caps inline children at 100 and loads purposes only for those rows", async () => {
  const root = {
    ...rowsById[9], website: "", notes: "", ever_activated_at: null,
    created_at: 1, created_by: 1, updated_by: 1
  };
  const addresses = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1, customer_id: 9, label: `Address ${index + 1}`,
    recipient_company_department: "", address_line1: "1 Main", address_line2: "", address_line3: "",
    city: "", state_region: "", postal_code: "", country_code: null, phone: "", notes: "",
    sort_order: index, status: "active", version: 1
  }));
  const queries = [];
  const database = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.includes("FROM customers WHERE id")) return [[root]];
      if (text.includes("FROM customer_addresses")) return [addresses];
      if (text.includes("FROM customer_contacts")) return [[]];
      if (text.includes("FROM customer_identifiers")) return [[]];
      if (text.includes("FROM customer_credit_profiles")) return [[]];
      if (text.includes("FROM customer_address_purposes")) return [[
        { address_id: 100, purpose_code: "shipping", is_default: 1 }
      ]];
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  const service = new CustomerService({ database, time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "detail-test" }) });

  const detail = await service.get({ actorId: 1, claimedRoles: [], claimedPermissions: [], id: 9 });

  assert.equal(detail.addresses.length, 100);
  assert.deepEqual(detail.addresses[99].purposes, [{ code: "shipping", isDefault: true }]);
  const addressRead = queries.find(({ sql }) => sql.includes("FROM customer_addresses"));
  const purposeRead = queries.find(({ sql }) => sql.includes("FROM customer_address_purposes"));
  assert.match(addressRead.sql, /LIMIT 100/);
  assert.doesNotMatch(addressRead.sql, /LIMIT 101/);
  assert.match(purposeRead.sql, /address_id IN \(/);
  assert.deepEqual(purposeRead.params, [9, ...Array.from({ length: 100 }, (_, index) => index + 1)]);
});

test("TC-012 Customer detail includes bounded party, identifier and credit projections", async () => {
  const root = {
    ...rowsById[9], website: "https://example.test", notes: "note", ever_activated_at: null,
    created_at: 1, created_by: 1, updated_by: 2
  };
  const database = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM customers WHERE id")) return [[root]];
      if (text.includes("FROM customer_addresses")) return [[{ id: 11, customer_id: 9, label: "HQ", address_line1: "1 Main", address_line2: "", address_line3: "", recipient_company_department: "", city: "Hong Kong", state_region: "", postal_code: "", country_code: "HK", phone: "", notes: "", sort_order: 0, status: "active", version: 1 }]];
      if (text.includes("FROM customer_address_purposes")) return [[{ address_id: 11, purpose_code: "shipping", is_default: 1 }]];
      if (text.includes("FROM customer_contacts")) return [[{ id: 12, customer_id: 9, name: "Sam", job_title: "", department: "", email: "sam@example.test", phone: "", mobile: "", preferred_language: "en", notes: "", sort_order: 0, status: "active", version: 1 }]];
      if (text.includes("FROM customer_contact_purposes")) return [[{ contact_id: 12, purpose_code: "general", is_default: 1 }]];
      if (text.includes("FROM customer_identifiers")) return [[{ id: 13, customer_id: 9, identifier_type: "tax", issuer_country_code: "HK", identifier_value: "123", valid_from: null, expires_at: null, notes: "", status: "active", version: 1 }]];
      if (text.includes("FROM customer_credit_profiles")) return [[{ credit_limit: "0.0000", credit_currency_code: "HKD", credit_status: "on_hold", version: 2 }]];
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  const service = new CustomerService({ database, time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "detail-test" }) });

  const detail = await service.get({ actorId: 1, claimedRoles: [], claimedPermissions: [], id: 9 });

  assert.deepEqual(detail.addresses[0].purposes, [{ code: "shipping", isDefault: true }]);
  assert.deepEqual(detail.contacts[0].purposes, [{ code: "general", isDefault: true }]);
  assert.equal(detail.identifiers[0].identifierValue, "123");
  assert.equal(detail.creditStatus, "on_hold");
  assert.deepEqual(detail.credit, { configured: true, creditLimit: "0.0000", currencyCode: "HKD", status: "on_hold", policyVersion: 2 });
});
