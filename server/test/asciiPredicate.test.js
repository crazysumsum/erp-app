import assert from "node:assert/strict";
import test from "node:test";
import { asciiPredicate } from "../src/services/mysqldatabase/asciiPredicate.js";

test("ASCII search predicates preserve matching parameters and exclude unrepresentable text", () => {
  const sql = "code LIKE ? AND number = ?";
  for (const args of [["SO%", "SO-1"], ["", ""]]) assert.deepEqual(asciiPredicate(sql, ...args), { sql, params: args });
  for (const value of ["中文", "é", "😀"]) assert.deepEqual(asciiPredicate(sql, "SO%", value), { sql: "FALSE", params: [] });
});
