import assert from "node:assert/strict";
import test from "node:test";

import { CustomerService } from "../src/modules/customer/CustomerService.js";

const rowsById = {
  3: {
    id: 3, customer_code: "CUS-003", legal_name: "Three Limited", trading_name: "",
    default_currency_code: null, default_payment_term_id: null, account_manager_user_id: null,
    category_id: null, industry_id: null, territory_id: null, general_phone: "", general_email: "",
    status: "draft", version: 1, updated_at: 30
  },
  9: {
    id: 9, customer_code: "CUS-009", legal_name: "Nine Limited", trading_name: "Nine",
    default_currency_code: "HKD", default_payment_term_id: 2, account_manager_user_id: null,
    category_id: null, industry_id: null, territory_id: null, general_phone: "", general_email: "",
    status: "draft", version: 4, updated_at: 90
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
  assert.doesNotMatch(queries[1], /JOIN customer_(?:addresses|contacts|identifiers)/);
  assert.match(queries[2], /WHERE id IN/);
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
  assert.deepEqual(queries[0].params, [`${"l".repeat(190)}%`]);
});
