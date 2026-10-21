import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateFulfillmentArchivePrepare, validateFulfillmentArchiveManifest,
  validateFulfillmentArchiveCommand } from "../src/modules/fulfillment/fulfillmentArchiveContract.js";

const contract = JSON.parse(readFileSync(new URL("../../docs/fulfillment_shipping_management/10_archive_prerequisite_contract.json", import.meta.url)));
const tables = contract.persistence.active_tables;
const manifest = () => ({ version: "1", orderId: "1", archiveBatchId: "2", cutoffMs: 100,
  tableCounts: Object.fromEntries(tables.map(table => [table, 0])),
  hashSummary: Object.fromEntries(tables.map(table => [table, "a".repeat(64)])) });
const prepare = () => ({ orderId: "1", archiveBatchId: "2", cutoffMs: 100 });
const command = () => ({ ...prepare(), archivedAtMs: 101, expectedManifest: manifest() });

test("approved Archive commands and complete twelve-table manifests validate without mutation", () => {
  for (const [validate, value] of [[validateFulfillmentArchivePrepare, prepare()],
    [validateFulfillmentArchiveManifest, manifest()], [validateFulfillmentArchiveCommand, command()]]) {
    const original = structuredClone(value);
    assert.equal(validate(value), value);
    assert.deepEqual(value, original);
  }
});
test("Archive identities never coerce numbers, leading zeros or unsafe decimal strings", () => {
  for (const field of ["orderId", "archiveBatchId"]) for (const value of [1, "0", "01", "-1", "1e3", "9007199254740992", null]) {
    assert.throws(() => validateFulfillmentArchivePrepare({ ...prepare(), [field]: value }), TypeError);
  }
  validateFulfillmentArchivePrepare({ orderId: "9007199254740991", archiveBatchId: "2", cutoffMs: 0 });
});
test("Archive timestamps obey the approved epoch bounds without coercion", () => {
  for (const cutoffMs of [-1, 0.5, "100", NaN, Infinity, 8640000000000001]) {
    assert.throws(() => validateFulfillmentArchivePrepare({ ...prepare(), cutoffMs }), TypeError);
  }
  validateFulfillmentArchivePrepare({ ...prepare(), cutoffMs: 8640000000000000 });
  for (const archivedAtMs of [99, -1, "101", 8640000000000001]) {
    assert.throws(() => validateFulfillmentArchiveCommand({ ...command(), archivedAtMs }), TypeError);
  }
});
test("manifest requires every owner table count and hash even for an empty aggregate", () => {
  for (const field of ["tableCounts", "hashSummary"]) for (const table of tables) {
    const value = manifest(); delete value[field][table];
    assert.throws(() => validateFulfillmentArchiveManifest(value), TypeError);
  }
  for (const count of [-1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1, NaN]) {
    const value = manifest(); value.tableCounts.fulfillments = count;
    assert.throws(() => validateFulfillmentArchiveManifest(value), TypeError);
  }
  for (const hash of ["A".repeat(64), "a".repeat(63), "g".repeat(64), null]) {
    const value = manifest(); value.hashSummary.fulfillments = hash;
    assert.throws(() => validateFulfillmentArchiveManifest(value), TypeError);
  }
});
test("Archive rejects mismatched identity, batch, cutoff or manifest version", () => {
  for (const [field, value] of [["orderId", "3"], ["archiveBatchId", "3"], ["cutoffMs", 99], ["version", 1]]) {
    const input = command(); input.expectedManifest[field] = value;
    assert.throws(() => validateFulfillmentArchiveCommand(input), TypeError);
  }
});
test("unknown keys and payload identity claims cannot enter the participant contract", () => {
  for (const [validate, value] of [[validateFulfillmentArchivePrepare, prepare()],
    [validateFulfillmentArchiveManifest, manifest()], [validateFulfillmentArchiveCommand, command()]]) {
    for (const key of ["actor", "permission", "serviceName", "identity", "unknown"]) {
      assert.throws(() => validate({ ...value, [key]: "salesJobs" }), TypeError);
    }
    for (const key of Object.keys(value)) {
      const missing = { ...value }; delete missing[key];
      assert.throws(() => validate(missing), TypeError);
    }
    for (const invalid of [null, [], "value", Object.create(value)]) assert.throws(() => validate(invalid), TypeError);
    assert.throws(() => validate({ ...value, [Symbol("authority")]: true }), TypeError);
  }
  for (const field of ["tableCounts", "hashSummary"]) {
    const extra = manifest(); extra[field].other_owner = 0;
    assert.throws(() => validateFulfillmentArchiveManifest(extra), TypeError);
  }
});
test("validation rejects accessors without executing payload code", () => {
  let reads = 0;
  const value = prepare(); Object.defineProperty(value, "orderId", { enumerable: true, get() { reads++; return "1"; } });
  assert.throws(() => validateFulfillmentArchivePrepare(value), TypeError);
  assert.equal(reads, 0);
});
