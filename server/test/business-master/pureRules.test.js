import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCurrencyInput,
  assertPaymentTermRule,
  calculateDueDate,
  normalizePaymentTermCode,
  normalizePaymentTermInput
} from "../../src/modules/businessMaster/businessMasterRules.js";

test("TC-002 accepts official uppercase currencies and rejects aliases or private codes", () => {
  assert.deepEqual(assertCurrencyInput({ code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2 }), {
    code: "HKD",
    name: "Hong Kong Dollar",
    decimalPlaces: 2
  });
  assert.equal(assertCurrencyInput({ code: "  HKD  ", name: " Hong Kong Dollar ", decimalPlaces: 2 }).code, "HKD");
  assert.equal(assertCurrencyInput({ code: "JPY", name: "Yen", decimalPlaces: 0 }).code, "JPY");
  assert.equal(assertCurrencyInput({ code: "BHD", name: "Bahraini Dinar", decimalPlaces: 3 }).code, "BHD");
  assert.equal(assertCurrencyInput({ code: "XCG", name: "Caribbean Guilder", decimalPlaces: 2 }).code, "XCG");

  for (const code of ["hkd", "BTC", "ZZZ", "ＨＫＤ", "XTS", "ANG", "BGN"]) {
    assert.throws(
      () => assertCurrencyInput({ code, name: "Invalid", decimalPlaces: 2 }),
      (error) => error.publicCode === "CURRENCY_CODE_INVALID"
    );
  }
  for (const decimalPlaces of [-1, 5, 1.5, "2"]) {
    assert.throws(
      () => assertCurrencyInput({ code: "HKD", name: "Hong Kong Dollar", decimalPlaces }),
      (error) => error.publicCode === "CURRENCY_PRECISION_INVALID"
    );
  }
});

test("TC-005 payment term codes use NFKC, trim, collapse whitespace, and uppercase", () => {
  assert.deepEqual(normalizePaymentTermCode("  ｎｅｔ   30  "), {
    code: "NET 30",
    codeKey: "NET 30"
  });
  assert.throws(
    () => normalizePaymentTermCode("   "),
    (error) => error.publicCode === "PAYMENT_TERM_CODE_INVALID"
  );
  assert.throws(
    () => normalizePaymentTermCode("x".repeat(51)),
    (error) => error.publicCode === "PAYMENT_TERM_CODE_INVALID"
  );
});

test("TC-006 validates the complete payment term type and dueDays decision table", () => {
  for (const calculationType of ["IMMEDIATE", "END_OF_MONTH", "MANUAL"]) {
    assert.deepEqual(assertPaymentTermRule({ calculationType, dueDays: null }), {
      calculationType,
      dueDays: null
    });
    assert.throws(
      () => assertPaymentTermRule({ calculationType, dueDays: 0 }),
      (error) => error.publicCode === "PAYMENT_TERM_RULE_INVALID"
    );
  }

  for (const dueDays of [0, 1, 3650]) {
    assert.deepEqual(assertPaymentTermRule({ calculationType: "NET_DAYS", dueDays }), {
      calculationType: "NET_DAYS",
      dueDays
    });
  }
  for (const dueDays of [null, -1, 3651, 1.5, "30"]) {
    assert.throws(
      () => assertPaymentTermRule({ calculationType: "NET_DAYS", dueDays }),
      (error) => error.publicCode === "PAYMENT_TERM_RULE_INVALID"
    );
  }
  assert.throws(
    () => assertPaymentTermRule({ calculationType: "WEEKLY", dueDays: null }),
    (error) => error.publicCode === "PAYMENT_TERM_RULE_INVALID"
  );
  assert.equal(normalizePaymentTermInput({ code: "NOW", name: " Now ", description: " ".repeat(501), calculationType: "IMMEDIATE", dueDays: null }).description, "");
});

test("TC-007 calculates calendar due dates without local timezone drift", () => {
  assert.deepEqual(calculateDueDate({ calculationType: "IMMEDIATE", dueDays: null }, "2024-02-29"), {
    dueDate: "2024-02-29",
    manual: false
  });
  assert.deepEqual(calculateDueDate({ calculationType: "NET_DAYS", dueDays: 30 }, "2024-01-31"), {
    dueDate: "2024-03-01",
    manual: false
  });
  assert.deepEqual(calculateDueDate({ calculationType: "END_OF_MONTH", dueDays: null }, "2024-02-03"), {
    dueDate: "2024-02-29",
    manual: false
  });
  assert.deepEqual(calculateDueDate({ calculationType: "END_OF_MONTH", dueDays: null }, "2025-02-28"), {
    dueDate: "2025-02-28",
    manual: false
  });
  assert.deepEqual(calculateDueDate({ calculationType: "MANUAL", dueDays: null }, "2025-01-31"), {
    dueDate: null,
    manual: true
  });

  for (const baseDate of ["2024-02-30", "2024-2-01", "not-a-date", "9999-12-31"]) {
    assert.throws(
      () => calculateDueDate({ calculationType: "NET_DAYS", dueDays: 3650 }, baseDate),
      (error) => error.publicCode === "BASE_DATE_INVALID"
    );
  }
});
