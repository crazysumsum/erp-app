/** AR 共用命令流程的純函式及錯誤轉譯（不連資料庫；交易行為由 arReceipts.integration.test.js 以真 MySQL 驗）。 */
import assert from "node:assert/strict";
import test from "node:test";

import { ArCommandRunner, amountUnits, eventId, formatUnits, localDate, nextDocumentNumber, onlyFields, positiveId, reason, storedUnits, text } from "../../src/modules/ar/arCommand.js";
import { arError } from "../../src/modules/ar/arErrors.js";
import { ArInquiryService } from "../../src/modules/ar/ArInquiryService.js";
import { ArReceiptService } from "../../src/modules/ar/ArReceiptService.js";

const invalid = (field) => (error) => error.code === "AR_INPUT_INVALID" && error.publicDetails?.field === field;

test("AR amounts are exact ten-thousandths, limited to the currency's decimal places, and never pass through Number", () => {
  assert.equal(amountUnits("1250.5", "amount"), 12505000n);
  assert.equal(amountUnits("0.0001", "amount"), 1n);
  assert.equal(amountUnits("999999999999999.9999", "amount"), 9999999999999999999n);
  assert.equal(amountUnits("10.1000", "amount", 2), 101000n); // 超出小數位的 0 可以接受。
  assert.equal(amountUnits("7", "amount", 0), 70000n);
  for (const [value, places] of [["10.001", 2], ["10.1", 0], ["0.00001", 4]]) assert.throws(() => amountUnits(value, "amount", places), invalid("amount"));
  for (const value of [10, "", " 1", "1.", ".5", "-1", "1e3", "1,000", "1234567890123456", null, undefined]) assert.throws(() => amountUnits(value, "amount"), invalid("amount"));
  assert.equal(storedUnits("100.0000"), 1000000n);
  assert.deepEqual([0n, 1n, 12505000n, 9999999999999999999n].map(formatUnits), ["0.0000", "0.0001", "1250.5000", "999999999999999.9999"]);
});

test("AR input validators reject by field path and never echo the value", () => {
  assert.equal(positiveId(7, "id"), 7);
  for (const value of [0, -1, 1.5, "7", 2 ** 53, null]) assert.throws(() => positiveId(value, "id"), invalid("id"));
  assert.equal(eventId("0190a5f0-0000-7000-8000-000000000001"), "0190a5f0-0000-7000-8000-000000000001");
  for (const value of ["0190A5F0-0000-7000-8000-000000000001", "not-a-uuid", 1, undefined]) assert.throws(() => eventId(value), invalid("eventId"));
  assert.equal(localDate("2028-02-29", "date"), "2028-02-29");
  for (const value of ["2026-02-30", "2026-13-01", "2026-1-1", "20260101", 20260101, null]) assert.throws(() => localDate(value, "date"), invalid("date"));

  assert.equal(text("第一行\n第二行\t完", "notes", { maximum: 10, multiline: true }), "第一行\n第二行\t完");
  assert.equal(text("😀😀", "reference", { maximum: 2 }), "😀😀"); // 按 code point 計長度。
  for (const value of ["a\nb", "a\u0000b", "a\u007fb", "abc", "\ud800", 5]) assert.throws(() => text(value, "reference", { maximum: 2 }), invalid("reference"));
  assert.throws(() => text("a\u0001b", "notes", { maximum: 10, multiline: true }), invalid("notes"));
  assert.equal(reason("  作廢的原因  "), "作廢的原因");
  for (const value of ["短", "    四個字    ".slice(0, 8), "x".repeat(501), undefined, 12345]) assert.throws(() => reason(value), invalid("reason"));

  assert.deepEqual(onlyFields({ a: 1 }, ["a", "b"]), { a: 1 });
  for (const value of [{ a: 1, status: "CONFIRMED" }, [], null, "x"]) assert.throws(() => onlyFields(value, ["a"]), invalid("body"));
  assert.throws(() => onlyFields({ c: 1 }, ["a"], "allocations.0"), invalid("allocations.0"));
  assert.throws(() => arError("NOT_A_CODE"), TypeError);
  assert.deepEqual(arError("VERSION_CONFLICT", { currentVersion: 3 }).publicDetails, { currentVersion: 3 });
});

test("AR document numbers are yearly, six digits, taken under the row lock, and stop at the limit instead of rolling over", async () => {
  const time = { at: (ms) => ms, fileDate: () => "2031-01-01" };
  const sequence = (next) => {
    const statements = [];
    return { statements, tx: {
      execute: async (sql, values) => { statements.push([sql.split(" ")[0], values]); },
      query: async (sql, values) => { statements.push([/FOR UPDATE$/u.test(sql) ? "LOCK" : "READ", values]); return [[{ next_value: next }]]; }
    } };
  };
  const first = sequence(1);
  assert.equal(await nextDocumentNumber(first.tx, { documentType: "INVOICE", time, nowMs: 5 }), "INV-2031-000001");
  assert.deepEqual(first.statements, [["INSERT", ["INVOICE", 2031, 5]], ["LOCK", ["INVOICE", 2031]], ["UPDATE", [5, "INVOICE", 2031]]]);
  assert.equal(await nextDocumentNumber(sequence(999999).tx, { documentType: "RECEIPT", time, nowMs: 5 }), "RCT-2031-999999");
  const exhausted = sequence(1000000);
  await assert.rejects(nextDocumentNumber(exhausted.tx, { documentType: "RECEIPT", time, nowMs: 5 }), (error) => error.code === "DOCUMENT_SEQUENCE_EXHAUSTED");
  assert.deepEqual(exhausted.statements.map(([kind]) => kind), ["INSERT", "LOCK"]); // 用盡時不再前進。
});

test("AR commands run READ COMMITTED and translate lock and indeterminate failures; other errors pass through unchanged", async () => {
  const time = { nowMs: () => 1 };
  const failing = (error) => new ArCommandRunner({ time, database: { withTransaction: async (work, options) => { assert.deepEqual(options, { isolationLevel: "READ COMMITTED" }); throw error; } } });
  const command = { claims: { sub: "1" }, permission: "ar.receipt.mgmt", commandType: "X", targetType: "RECEIPT", eventId: "e", payload: {} };
  const code = (expected) => (error) => error.code === expected;
  await assert.rejects(failing(Object.assign(new Error("lost"), { code: "DATABASE_TRANSACTION_INDETERMINATE" })).run(command, () => {}), code("TRANSACTION_OUTCOME_UNKNOWN"));
  await assert.rejects(failing(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" })).run(command, () => {}), code("CONCURRENT_OPERATION"));
  await assert.rejects(failing(new Error("wrapped", { cause: Object.assign(new Error("wait"), { code: "ER_LOCK_WAIT_TIMEOUT" }) })).run(command, () => {}), code("CONCURRENT_OPERATION"));
  const other = new Error("something else");
  await assert.rejects(failing(other).run(command, () => {}), (error) => error === other);

  assert.throws(() => new ArCommandRunner({ database: {} }), TypeError);
  assert.throws(() => new ArReceiptService({ commands: {}, customers: {}, businessMaster: {}, time: {} }), TypeError);
  assert.throws(() => new ArInquiryService({ database: {} }), TypeError);
});
