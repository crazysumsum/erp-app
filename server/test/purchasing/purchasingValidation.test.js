/**
 * TASK-010：共用輸入驗證（設計 §1.6、§5.1、§10.2；SEC-013、SEC-014）。
 * 錯誤只帶穩定 code 同欄位名，永遠唔回用戶送嚟嘅值。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  eventId, localDate, notes, positiveId, reason, reference, onlyFields, requireItems
} from "../../src/modules/purchasing/purchasingValidation.js";

const invalid = (field) => (error) => error.code === "PURCHASING_INPUT_INVALID" && error.statusCode === 400 &&
  (field === undefined || error.publicDetails?.field === field);

test("TASK-010 IDs are positive safe integers", () => {
  assert.equal(positiveId(1, "supplierId"), 1);
  assert.equal(positiveId(Number.MAX_SAFE_INTEGER, "supplierId"), Number.MAX_SAFE_INTEGER);
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, "1", 1n, null, undefined, true]) {
    assert.throws(() => positiveId(bad, "supplierId"), invalid("supplierId"), String(bad));
  }
});

test("TASK-010 eventId is a canonical lowercase UUID the Inventory provider will accept", () => {
  const id = "3f2c8a1e-9b4d-4c7a-8e2f-1a2b3c4d5e6f";
  assert.equal(eventId(id), id);
  assert.equal(eventId("00000000-0000-1000-8000-000000000000"), "00000000-0000-1000-8000-000000000000");
  // client 用 crypto.randomUUID() 產生：一定要收。
  for (let i = 0; i < 1000; i += 1) { const generated = randomUUID(); assert.equal(eventId(generated), generated); }
  // 大寫唔正規化：Idempotency-Key 一定要同 eventId 逐字相同，而 Inventory 只收小寫（provider 契約 §2）。
  for (const bad of [id.toUpperCase(), `{${id}}`, id.replaceAll("-", ""), `${id} `, id.slice(0, 35),
    "3f2c8a1e-9b4d-0c7a-8e2f-1a2b3c4d5e6f", "3f2c8a1e-9b4d-4c7a-7e2f-1a2b3c4d5e6f", "", 1, null]) {
    assert.throws(() => eventId(bad), invalid("eventId"), String(bad));
  }
});

test("TASK-010 dates are real calendar days in YYYY-MM-DD", () => {
  for (const ok of ["2026-10-30", "2024-02-29", "2000-02-29", "1970-01-01", "9999-12-31"]) {
    assert.equal(localDate(ok, "orderDate"), ok);
  }
  for (const bad of ["2026-02-29", "1900-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-5", "26-10-30",
    "2026/10/30", "2026-10-30T00:00:00Z", " 2026-10-30", "+02026-10-30", "", 20261030, null]) {
    assert.throws(() => localDate(bad, "orderDate"), invalid("orderDate"), String(bad));
  }
});

test("TASK-010 reason is trimmed to 5..500 characters; notes and references are bounded free text", () => {
  assert.equal(reason("  短缺補貨原因  "), "短缺補貨原因");
  assert.equal(reason("x".repeat(500)), "x".repeat(500));
  assert.equal(reason("五個中文字"), "五個中文字");
  assert.equal(reason("第一行\n第二行"), "第一行\n第二行");
  // 按 code point 計，emoji 唔會被當兩個字。
  assert.equal(reason("😀".repeat(500)), "😀".repeat(500));
  for (const bad of ["四個字", "    abcd    ", "x".repeat(501), "", 12345, null, undefined]) {
    assert.throws(() => reason(bad), invalid("reason"), String(bad).slice(0, 20));
  }
  assert.throws(() => reason("ok but\u0000hidden"), invalid("reason"));
  assert.throws(() => reason("valid text \uD800"), invalid("reason"));

  assert.equal(notes(), "");
  assert.equal(notes("備註\n第二行"), "備註\n第二行");
  assert.equal(notes("x".repeat(2000)), "x".repeat(2000));
  for (const bad of ["x".repeat(2001), "a\u0007b", "a\u007fb", "a\uDC00b", null, 1]) {
    assert.throws(() => notes(bad), invalid("notes"), JSON.stringify(bad)?.slice(0, 20));
  }

  assert.equal(reference(), "");
  assert.equal(reference("SUP-REF/2026-001"), "SUP-REF/2026-001");
  assert.equal(reference("x".repeat(190), "supplierReference"), "x".repeat(190));
  // 單行欄位：換行同 tab 會喺 CSV 同列印度拆開一行。
  for (const bad of ["x".repeat(191), "a\nb", "a\rb", "a\tb", "a\u0000b", null]) {
    assert.throws(() => reference(bad, "supplierReference"), invalid("supplierReference"), JSON.stringify(bad));
  }
});

test("TASK-010 objects are allowlisted, so client totals, snapshots and status never get through", () => {
  // §5.2 嘅 PO line 輸入欄位；其餘全部由 server 計或者由快照得出。
  const LINE = ["skuId", "purchaseSkuUomId", "orderedQuantity", "unitPrice", "zeroPriceReason", "lineNote"];
  const line = { skuId: 1, purchaseSkuUomId: 2, orderedQuantity: "3", unitPrice: "125.5" };
  assert.equal(onlyFields(line, LINE, "lines[0]"), line);

  for (const forged of ["lineAmount", "subtotalAmount", "totalAmount", "toBaseFactor", "orderedBaseQuantity",
    "unitPriceSnapshot", "skuSnapshot", "currencyDecimalPlacesSnapshot", "status", "warnings", "trackingPolicy",
    "receivedQuantity", "outstandingQuantity", "id", "__proto__", "constructor"]) {
    const body = JSON.parse(JSON.stringify(line));
    Object.defineProperty(body, forged, { value: "1", enumerable: true });
    assert.throws(() => onlyFields(body, LINE, "lines[0]"), invalid("lines[0]"), forged);
  }
  for (const bad of [null, [], "x", 1, undefined]) {
    assert.throws(() => onlyFields(bad, LINE, "lines[0]"), invalid("lines[0]"), String(bad));
  }
});

test("TASK-010 line and detail arrays need at least one item and respect the configured cap", () => {
  const lines = Array.from({ length: 100 }, (_, index) => ({ index }));
  assert.equal(requireItems(lines, 100, "lines"), lines);
  assert.equal(requireItems([{}], 1, "details").length, 1);
  assert.throws(() => requireItems([...lines, {}], 100, "lines"), invalid("lines"));
  assert.throws(() => requireItems([], 100, "lines"), invalid("lines"));
  for (const bad of [null, {}, "x", { length: 1 }]) assert.throws(() => requireItems(bad, 100, "lines"), invalid("lines"));
  // 上限嚟自已正規化嘅 config：唔係正整數即係 server bug。
  for (const cap of [0, -1, 1.5, "100", null]) assert.throws(() => requireItems([{}], cap, "lines"), TypeError);
});

test("TASK-010 errors carry a stable code and a field name, never the submitted value", () => {
  const secret = "token=abc123; DROP TABLE purchase_orders; <script>";
  for (const run of [
    () => reason(`${secret}${"x".repeat(600)}`),
    () => notes(secret.repeat(100)),
    () => reference(`${secret}\n`, "supplierReference"),
    () => localDate(secret, "orderDate"),
    () => eventId(secret),
    () => positiveId(secret, "supplierId"),
    () => onlyFields({ [secret]: 1 }, ["skuId"], "lines[0]")
  ]) {
    try { run(); assert.fail("expected a validation error"); } catch (error) {
      assert.equal(error.code, "PURCHASING_INPUT_INVALID");
      assert.deepEqual(Object.keys(error.publicDetails), ["field"]);
      for (const text of [error.message, error.publicMessage, JSON.stringify(error.publicDetails)]) {
        assert.doesNotMatch(text, /abc123|DROP TABLE|script/u);
      }
    }
  }
});
