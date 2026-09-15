import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { SecretValue } from "../src/framework/configuration/SecretValue.js";
import { normalizeSupplierConfig } from "../src/modules/supplier/normalizeSupplierConfig.js";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

test("Supplier config supplies bounded Phase 1 defaults without requiring Bank keys", () => {
  const config = normalizeSupplierConfig({});

  assert.equal(config.bankEncryption, null);
  assert.equal(config.bankLookup, null);
  assert.equal(config.duplicateNameThreshold, 0.85);
  assert.deepEqual(config.import, {
    maxFileBytes: 10_485_760,
    maxRows: 10_000,
    fileRetentionDays: 365
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.import), true);
});

test("Supplier config validates and redacts both independent Bank key rings", () => {
  const config = normalizeSupplierConfig({
    bankEncryption: { activeKeyId: "enc-2", keyRing: JSON.stringify({ "enc-1": KEY_A, "enc-2": KEY_B }) },
    bankLookup: { activeKeyId: "lookup-1", keyRing: JSON.stringify({ "lookup-1": KEY_A }) }
  });

  assert.ok(config.bankEncryption.keyRing["enc-1"] instanceof SecretValue);
  assert.equal(config.bankEncryption.keyRing["enc-2"].reveal(), KEY_B);
  assert.equal(config.bankLookup.keyRing["lookup-1"].reveal(), KEY_A);
  assert.doesNotMatch(JSON.stringify(config), new RegExp(KEY_A));
  assert.doesNotMatch(inspect(config, { depth: 6 }), new RegExp(KEY_B));
});

test("Supplier config rejects partial, malformed and unusable Bank key rings", () => {
  assert.throws(
    () => normalizeSupplierConfig({ bankEncryption: { activeKeyId: "enc-1", keyRing: JSON.stringify({ "enc-1": KEY_A }) } }),
    /both bankEncryption and bankLookup/
  );
  assert.throws(
    () => normalizeSupplierConfig({
      bankEncryption: { activeKeyId: "enc-1", keyRing: "not-json" },
      bankLookup: { activeKeyId: "lookup-1", keyRing: JSON.stringify({ "lookup-1": KEY_A }) }
    }),
    /valid JSON object/
  );
  assert.throws(
    () => normalizeSupplierConfig({
      bankEncryption: { activeKeyId: "enc-missing", keyRing: JSON.stringify({ "enc-1": KEY_A }) },
      bankLookup: { activeKeyId: "lookup-1", keyRing: JSON.stringify({ "lookup-1": KEY_A }) }
    }),
    /activeKeyId.*keyRing/
  );
  assert.throws(
    () => normalizeSupplierConfig({
      bankEncryption: { activeKeyId: "enc-1", keyRing: JSON.stringify({ "enc-1": Buffer.alloc(31).toString("base64") }) },
      bankLookup: { activeKeyId: "lookup-1", keyRing: JSON.stringify({ "lookup-1": KEY_A }) }
    }),
    /32 bytes/
  );
});

test("Supplier config rejects unbounded duplicate and import values", () => {
  for (const duplicateNameThreshold of [0.49, 1.01, Number.NaN]) {
    assert.throws(() => normalizeSupplierConfig({ duplicateNameThreshold }), /duplicateNameThreshold/);
  }
  for (const [field, value] of [
    ["maxFileBytes", 0],
    ["maxFileBytes", 104_857_601],
    ["maxRows", -1],
    ["maxRows", 50_001],
    ["fileRetentionDays", 0],
    ["fileRetentionDays", 3651]
  ]) {
    assert.throws(() => normalizeSupplierConfig({ import: { [field]: value } }), new RegExp(field));
  }
});
