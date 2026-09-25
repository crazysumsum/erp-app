import assert from "node:assert/strict";
import test from "node:test";

import * as handlers from "../src/handlers/customers/customerBankHandlers.js";
import * as schemas from "../src/handlers/customers/customerBankSchemas.js";

test("Customer bank routes enforce exact step-up authentication and permission policies", () => {
  assert.equal(handlers.ListCustomerBankAccountsHandler.api.authType, undefined);
  assert.equal(handlers.CreateCustomerBankAccountHandler.api.authType, "jwt-device-password");
  assert.equal(handlers.UpdateCustomerBankAccountHandler.api.authType, "jwt-device-password");
  assert.equal(handlers.SetDefaultCustomerBankAccountHandler.api.authType, "jwt-device-password");
  assert.equal(handlers.DeactivateCustomerBankAccountHandler.api.authType, "jwt-device-password");
  assert.equal(handlers.RevealCustomerBankAccountHandler.api.authType, "jwt-password");
  assert.deepEqual(
    handlers.CreateCustomerBankAccountHandler.api.authorizationPolicies[0].options.permissions,
    ["customer.view", "customer.bank.view", "customer.bank.mgmt"]
  );
  assert.deepEqual(
    handlers.RevealCustomerBankAccountHandler.api.authorizationPolicies[0].options.permissions,
    ["customer.view", "customer.bank.view"]
  );
  assert.equal(handlers.RevealCustomerBankAccountHandler.api.idempotency, undefined,
    "plaintext reveal must never enter the durable idempotency response cache");
});

test("Customer masked Bank response schemas structurally exclude plaintext and crypto metadata", () => {
  const serialized = JSON.stringify({
    list: schemas.CUSTOMER_BANK_LIST_RESPONSE,
    item: schemas.CUSTOMER_BANK_RESPONSE
  });
  for (const forbidden of ["accountNumber", "ciphertext", "authTag", "blindIndex", "encryptionKeyId", "lastFour", "accountLength"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.ok(serialized.includes("maskedAccountNumber"));
});

test("every Customer Bank schema is deeply frozen", () => {
  const unfrozen = [];
  const seen = new WeakSet();
  const walk = (value, path) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (!Object.isFrozen(value)) unfrozen.push(path);
    for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
  };
  for (const [name, schema] of Object.entries(schemas)) walk(schema, name);
  assert.deepEqual(unfrozen, []);
});
