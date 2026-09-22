import assert from "node:assert/strict";
import test from "node:test";

import { CustomerCreditService } from "../src/modules/customer/CustomerCreditService.js";

function createService(connection, { audits = [], currencies = [] } = {}) {
  return new CustomerCreditService({
    database: { withTransaction: (work) => work(connection), query: (...args) => connection.query(...args) },
    time: { nowMs: () => 1_757_808_000_000 },
    actorVerifier: async () => ({ username: "sam" }),
    audit: { record: async (_connection, input) => audits.push(input) },
    businessMaster: { async assertCurrencyUsableInTransaction(_connection, input) { currencies.push(input); return { code: input.code, status: "ACTIVE" }; } }
  });
}

test("TC-022 get distinguishes no row from configured null, zero and on_hold", async () => {
  const rows = [
    [],
    [{ customer_id: 4, credit_limit: null, credit_currency_code: null, credit_status: "normal", version: 1 }],
    [{ customer_id: 4, credit_limit: "0.0000", credit_currency_code: "HKD", credit_status: "on_hold", version: 2 }]
  ];
  const connection = { async query(sql) {
    if (String(sql).includes("FROM customers")) return [[{ id: 4 }]];
    return [rows.shift()];
  } };
  const credit = createService(connection);
  assert.deepEqual(await credit.get({ customerId: 4, actorId: 2 }), { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null });
  assert.deepEqual(await credit.get({ customerId: 4, actorId: 2 }), { configured: true, creditLimit: null, currencyCode: null, status: "normal", policyVersion: 1 });
  assert.deepEqual(await credit.get({ customerId: 4, actorId: 2 }), { configured: true, creditLimit: "0.0000", currencyCode: "HKD", status: "on_hold", policyVersion: 2 });
});

test("TC-022/024 first save requires version null, preserves decimal strings and audits without notes", async () => {
  const calls = [];
  const audits = [];
  const currencies = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      if (String(sql).includes("FROM customer_credit_profiles")) return [[]];
      return [[]];
    },
    async execute(sql, params) { calls.push({ sql: String(sql), params }); return [{ affectedRows: 1 }]; }
  };
  const result = await createService(connection, { audits, currencies }).save({ customerId: 4, actorId: 2, version: null, creditLimit: "0.0000", creditCurrencyCode: "HKD", creditStatus: "on_hold", creditNotes: "private-credit-note", reason: "initial hold" });
  assert.deepEqual(result, { configured: true, creditLimit: "0.0000", currencyCode: "HKD", status: "on_hold", policyVersion: 1 });
  assert.deepEqual(currencies, [{ code: "HKD", purpose: "new_assignment" }]);
  assert.ok(calls.some((call) => /INSERT INTO customer_credit_profiles/.test(call.sql) && call.params.includes("0.0000")));
  assert.equal(audits[0].action, "customer.credit.create");
  assert.equal(audits[0].detail.after.creditNotes, undefined);
});

test("TC-023 rejects negative, imprecise and amount-without-currency values before any write", async () => {
  const credit = new CustomerCreditService({ database: { withTransaction() { throw new Error("must not transact"); }, query() { throw new Error("must not query"); } }, time: { nowMs: () => 1 }, businessMaster: {} });
  for (const input of [
    { creditLimit: "-1.0000", creditCurrencyCode: "HKD" },
    { creditLimit: "1.00000", creditCurrencyCode: "HKD" },
    { creditLimit: "1.0000", creditCurrencyCode: null },
    { creditLimit: null, creditCurrencyCode: null, reason: "" }
  ]) {
    await assert.rejects(() => credit.save({ customerId: 4, actorId: 2, version: null, creditStatus: "normal", creditNotes: "", reason: "test invalid", ...input }), (error) => error.code === "CREDIT_POLICY_INVALID");
  }
});

test("TC-023 maps inactive or missing Business Master currency to the stable credit error", async () => {
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      return [[]];
    }
  };
  const credit = createService(connection);
  credit.businessMaster.assertCurrencyUsableInTransaction = async () => { const error = new Error("private provider detail"); error.code = "CURRENCY_NOT_ACTIVE"; throw error; };
  await assert.rejects(() => credit.save({ customerId: 4, actorId: 2, version: null, creditLimit: "1.0000", creditCurrencyCode: "ZZZ", creditStatus: "normal", creditNotes: "", reason: "new policy" }), (error) => error.code === "CREDIT_POLICY_INVALID" && !error.message.includes("private"));
});

test("TC-022 an update that cannot read private credit notes preserves them", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      if (String(sql).includes("FROM customer_credit_profiles")) return [[{ customer_id: 4, credit_limit: "10.0000", credit_currency_code: "HKD", credit_status: "normal", credit_notes: "private", version: 3 }]];
      return [[]];
    },
    async execute(sql, params) { calls.push({ sql: String(sql), params }); return [{ affectedRows: 1 }]; }
  };
  await createService(connection).save({ customerId: 4, actorId: 2, version: 3, creditLimit: "20.0000", creditCurrencyCode: "HKD", creditStatus: "normal", reason: "raise limit" });
  const update = calls.find((call) => call.sql.includes("UPDATE customer_credit_profiles"));
  assert.equal(update.params[3], "private");
});

test("TC-024 clear uses policy CAS, removes the optional row and retains a redacted before audit", async () => {
  const calls = [];
  const audits = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      if (String(sql).includes("FROM customer_credit_profiles")) return [[{ customer_id: 4, credit_limit: "10.0000", credit_currency_code: "HKD", credit_status: "normal", credit_notes: "private", version: 3 }]];
      return [[]];
    },
    async execute(sql, params) { calls.push({ sql: String(sql), params }); return [{ affectedRows: 1 }]; }
  };
  const result = await createService(connection, { audits }).clear({ customerId: 4, actorId: 2, version: 3, reason: "remove policy" });
  assert.deepEqual(result, { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null });
  assert.ok(calls.some((call) => /DELETE FROM customer_credit_profiles WHERE customer_id = \? AND version = \?/.test(call.sql)));
  assert.equal(audits[0].detail.before.creditNotes, undefined);
  assert.equal(audits[0].detail.before.creditLimit, "10.0000");
});

test("TC-024 concurrent first-save loser receives VERSION_CONFLICT without a second audit", async () => {
  const audits = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      if (String(sql).includes("FROM customer_credit_profiles")) return [[{ customer_id: 4, credit_limit: null, credit_currency_code: null, credit_status: "normal", credit_notes: "", version: 1 }]];
      return [[]];
    },
    async execute() { throw new Error("must not write"); }
  };
  await assert.rejects(() => createService(connection, { audits }).save({ customerId: 4, actorId: 2, version: null, creditLimit: null, creditCurrencyCode: null, creditStatus: "normal", creditNotes: "", reason: "first setup" }), (error) => error.code === "VERSION_CONFLICT");
  assert.equal(audits.length, 0);
});
