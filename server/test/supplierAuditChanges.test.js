import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { changedFieldsDetail, purposeList, sortedPurposes, textDigest } from "../src/modules/supplier/auditChanges.js";

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

test("HD-112 A: only changed fields are recorded, and an update that changes nothing records null", () => {
  assert.equal(changedFieldsDetail({ name: "A", city: "HK" }, { name: "A", city: "HK" }), null);
  assert.deepEqual(changedFieldsDetail({ name: "A", city: "HK", countryCode: null }, { name: "B", city: "HK", countryCode: "HK" }),
    { before: { name: "A", countryCode: null }, after: { name: "B", countryCode: "HK" } });
  assert.deepEqual(changedFieldsDetail({ termId: 5 }, { termId: 5 }), null, "a number compared with a number");
});

test("HD-112 A: notes are recorded on both sides as changed, length in characters and SHA-256, never as text", () => {
  const before = "舊".repeat(10);
  const after = "😀".repeat(3);
  const detail = changedFieldsDetail({ notes: before }, { notes: after });
  assert.deepEqual(detail, {
    before: { notes: { changed: true, length: 10, sha256: sha(before) } },
    after: { notes: { changed: true, length: 3, sha256: sha(after) } }
  });
  assert.ok(!JSON.stringify(detail).includes("舊") && !JSON.stringify(detail).includes("😀"));
  assert.deepEqual(textDigest(""), { changed: true, length: 0, sha256: sha("") });
});

test("HD-112 A: purposes compare by code and primary, whatever their order", () => {
  const stored = purposeList([{ purpose_code: "ordering", is_primary: 1 }, { purpose_code: "office", is_primary: 0 }]);
  assert.deepEqual(stored, [{ purposeCode: "office", isPrimary: false }, { purposeCode: "ordering", isPrimary: true }]);
  const reordered = sortedPurposes([{ purposeCode: "ordering", isPrimary: true }, { purposeCode: "office", isPrimary: false }]);
  assert.equal(changedFieldsDetail({ purposes: stored }, { purposes: reordered }), null);
  const flipped = sortedPurposes([{ purposeCode: "office", isPrimary: true }, { purposeCode: "ordering" }]);
  assert.deepEqual(changedFieldsDetail({ purposes: stored }, { purposes: flipped }), {
    before: { purposes: [{ purposeCode: "office", isPrimary: false }, { purposeCode: "ordering", isPrimary: true }] },
    after: { purposes: [{ purposeCode: "office", isPrimary: true }, { purposeCode: "ordering", isPrimary: false }] }
  });
});

test("REV-099 F-1: every field at its maximum in 4-byte characters still fits the 8192-byte limit, by digesting changed text", () => {
  const max = (character, length) => character.repeat(length);
  const supplier = (c) => ({ supplierName: max(c, 190), displayName: max(c, 190), defaultCurrencyCode: "HKD", defaultPaymentTermId: 5,
    website: max(c, 500), generalPhone: max(c, 50), generalEmail: max(c, 254), notes: max(c, 2000) });
  const address = (c) => ({ label: max(c, 100), addressLine1: max(c, 190), addressLine2: max(c, 190), addressLine3: max(c, 190),
    city: max(c, 100), stateRegion: max(c, 100), postalCode: max(c, 100), countryCode: "HK", phone: max(c, 50), notes: max(c, 500),
    purposes: sortedPurposes(["registered", "office", "ordering", "return", "remittance", "other"].map((purposeCode) => ({ purposeCode, isPrimary: c === "😀" })))
  });
  for (const [label, make] of [["supplier", supplier], ["address", address]]) {
    for (const [from, to] of [["😀", "😁"], ["\u0001", "\u0002"]]) {
      const detail = changedFieldsDetail(make(from), make(to));
      const bytes = Buffer.byteLength(JSON.stringify(detail), "utf8");
      assert.ok(bytes <= 8192, `${label} ${JSON.stringify(from)}: ${bytes} bytes`);
      assert.ok(!JSON.stringify(detail).includes(to), `${label}: text replaced by digests`);
    }
  }
  // 細嘅更新唔會被迫 digest：
  assert.deepEqual(changedFieldsDetail({ supplierName: "A" }, { supplierName: "B" }), { before: { supplierName: "A" }, after: { supplierName: "B" } });
});
