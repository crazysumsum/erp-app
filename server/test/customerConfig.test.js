import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";

import { normalizeCustomerConfig } from "../src/modules/customer/normalizeCustomerConfig.js";

const key = () => randomBytes(32).toString("base64");

test("Customer bank and import capabilities are disabled when their config is absent", () => {
  assert.deepEqual(normalizeCustomerConfig({}), {
    bankEncryption: null,
    bankLookup: null,
    attachment: null,
    import: null
  });
});

test("Customer attachment config requires isolated absolute roots, encryption and scanner", () => {
  const bankEncryption = { activeKeyId: "enc", keyRing: { enc: key() } };
  const bankLookup = { activeKeyId: "lookup", keyRing: { lookup: key() } };
  const attachment = {
    generalRoot: "/private/tmp/customer-general", bankSensitiveRoot: "/private/tmp/customer-bank",
    tempRoot: "/private/tmp/customer-temp", maxFileBytes: 1024, orphanGraceMs: 20000,
    malwareScanner: { mode: "clamd", host: "127.0.0.1", port: 3310, timeoutMs: 15000 }
  };
  const normalized = normalizeCustomerConfig({ bankEncryption, bankLookup, attachment });
  assert.equal(normalized.attachment.maxFileBytes, 1024);
  assert.deepEqual(normalized.attachment.allowedMimeTypes, ["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  assert.throws(() => normalizeCustomerConfig({ bankEncryption, bankLookup, attachment: { ...attachment, tempRoot: "/private/tmp/customer-general/temp" } }), /non-overlapping/u);
  assert.throws(() => normalizeCustomerConfig({ attachment }), /requires the Customer encryption key ring/u);
  assert.throws(() => normalizeCustomerConfig({ bankEncryption, bankLookup, attachment: { ...attachment, malwareScanner: null } }), /requires a clamd/u);
  assert.throws(() => normalizeCustomerConfig({ bankEncryption, bankLookup, attachment: { ...attachment, orphanGraceMs: 15000 } }), /must exceed/u);
  assert.throws(() => normalizeCustomerConfig({ bankEncryption, bankLookup, attachment: { ...attachment, malwareScanner: { ...attachment.malwareScanner, port: 65536 } } }), /at most 65535/u);
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
