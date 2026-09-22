import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";

import { normalizeCustomerConfig } from "../src/modules/customer/normalizeCustomerConfig.js";

const key = () => randomBytes(32).toString("base64");

test("Customer bank capability is disabled when both key rings are absent", () => {
  assert.deepEqual(normalizeCustomerConfig({}), {
    bankEncryption: null,
    bankLookup: null
  });
});

test("Customer config validates independent key rings and redacts their material", () => {
  const encryptionKey = key();
  const lookupKey = key();
  const config = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: { "enc-1": encryptionKey } },
    bankLookup: { activeKeyId: "lookup-1", keyRing: JSON.stringify({ "lookup-1": lookupKey }) }
  });

  assert.equal(config.bankEncryption.keyRing["enc-1"].reveal(), encryptionKey);
  assert.equal(config.bankLookup.keyRing["lookup-1"].reveal(), lookupKey);
  assert.equal(JSON.stringify(config).includes(encryptionKey), false);
  assert.equal(inspect(config, { depth: 6 }).includes(lookupKey), false);
});

test("Customer config fails closed for incomplete or unusable key rings", () => {
  const material = key();
  assert.throws(
    () => normalizeCustomerConfig({ bankEncryption: { activeKeyId: "enc", keyRing: { enc: material } } }),
    /both bankEncryption and bankLookup/
  );
  assert.throws(
    () => normalizeCustomerConfig({
      bankEncryption: { activeKeyId: "missing", keyRing: { enc: material } },
      bankLookup: { activeKeyId: "lookup", keyRing: { lookup: key() } }
    }),
    /activeKeyId.*keyRing/
  );
  assert.throws(
    () => normalizeCustomerConfig({
      bankEncryption: { activeKeyId: "enc", keyRing: { enc: Buffer.alloc(31).toString("base64") } },
      bankLookup: { activeKeyId: "lookup", keyRing: { lookup: key() } }
    }),
    /32 bytes/
  );
  assert.throws(
    () => normalizeCustomerConfig({
      bankEncryption: { activeKeyId: "enc", keyRing: `{"enc":"${material}","enc":"${key()}"}` },
      bankLookup: { activeKeyId: "lookup", keyRing: { lookup: key() } }
    }),
    /invalid or duplicate key ID/
  );
  assert.throws(
    () => normalizeCustomerConfig({
      bankEncryption: { activeKeyId: "enc", keyRing: { enc: material } },
      bankLookup: { activeKeyId: "lookup", keyRing: { lookup: material } }
    }),
    /must use independent key material/
  );
});
