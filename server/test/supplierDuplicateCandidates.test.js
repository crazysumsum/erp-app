import assert from "node:assert/strict";
import test from "node:test";

import {
  bigramDiceScore,
  hashNameBigrams,
  replaceSupplierNameGrams,
  SupplierDuplicateCandidates
} from "../src/modules/supplier/supplierDuplicateCandidates.js";

test("Unicode bigrams are unique, deterministic and exact single-character names have no grams", () => {
  assert.deepEqual(hashNameBigrams("公司公司").map((value) => value.toString("hex")), hashNameBigrams("公司公司").map((value) => value.toString("hex")));
  assert.equal(hashNameBigrams("公司公司").length, 2);
  assert.deepEqual(hashNameBigrams("甲"), []);
});

test("Dice score has deterministic exact and threshold boundaries", () => {
  assert.equal(bigramDiceScore("abc", "abc"), 1);
  assert.equal(bigramDiceScore("甲", "甲"), 1);
  assert.equal(bigramDiceScore("甲", "乙"), 0);
  assert.equal(bigramDiceScore("abcdefghi", "abcdefghx"), 0.875);
  assert.ok(bigramDiceScore("abcdefghij", "abcdefgxyz") < 0.85);
});

test("candidate ranking is exact first, thresholded, stable and capped at ten warnings", async () => {
  const rows = [
    { id: 9, supplier_code: "S9", supplier_name: "ABC Trading", supplier_name_key: "abc trading" },
    { id: 3, supplier_code: "S3", supplier_name: "ABC Trading", supplier_name_key: "abc trading" },
    ...Array.from({ length: 15 }, (_, index) => ({
      id: 20 + index,
      supplier_code: `S${20 + index}`,
      supplier_name: `ABC Tradin${String.fromCharCode(97 + index)}`,
      supplier_name_key: `abc tradin${String.fromCharCode(97 + index)}`
    }))
  ];
  const connection = { async query() { return [rows]; } };
  const service = new SupplierDuplicateCandidates({ threshold: 0.85 });
  const result = await service.find(connection, { nameKey: "abc trading" });
  assert.equal(result.length, 10);
  assert.deepEqual(result.slice(0, 2).map((row) => row.supplierId), [3, 9]);
  assert.ok(result.every((row) => row.warningOnly === true && row.score >= 0.85));
});

test("single-character candidate lookup uses exact name only", async () => {
  const calls = [];
  const connection = { async query(sql, params) { calls.push([sql, params]); return [[]]; } };
  await new SupplierDuplicateCandidates().find(connection, { nameKey: "甲" });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /supplier_name_key = \?/u);
});

test("name gram replacement uses the caller transaction and deletes before bulk insert", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) { calls.push(["execute", sql, params]); },
    async query(sql, params) { calls.push(["query", sql, params]); }
  };
  await replaceSupplierNameGrams(connection, 7, "abc");
  assert.match(calls[0][1], /DELETE FROM supplier_name_grams/u);
  assert.match(calls[1][1], /INSERT INTO supplier_name_grams/u);
  assert.equal(calls[1][2].length, 4);
});
