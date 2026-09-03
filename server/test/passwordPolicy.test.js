import assert from "node:assert/strict";
import test from "node:test";
import { assertPasswordChanged, assertPasswordStrength } from "../src/modules/user/passwordPolicy.js";
import { hashPassword } from "../src/modules/user/passwordHash.js";

function code(fn) {
  try {
    fn();
    throw new Error("expected function to throw");
  } catch (error) {
    return error.code;
  }
}

test("assertPasswordStrength accepts 12+ chars with upper and lower case", () => {
  assert.doesNotThrow(() => assertPasswordStrength("Sixty-Nine-Cats"));
});

test("assertPasswordStrength accepts exactly 12 characters", () => {
  assert.doesNotThrow(() => assertPasswordStrength("Abcdefghijkl"));
});

test("assertPasswordStrength rejects fewer than 12 characters", () => {
  const error = (() => {
    try {
      assertPasswordStrength("Short1Aa");
      throw new Error("expected function to throw");
    } catch (e) {
      return e;
    }
  })();
  assert.equal(error.code, "PASSWORD_TOO_WEAK");
  assert.equal(error.statusCode, 400);
  assert.match(error.publicMessage, /12/);
});

test("assertPasswordStrength rejects missing lowercase", () => {
  assert.equal(code(() => assertPasswordStrength("ALLUPPERCASE1")), "PASSWORD_TOO_WEAK");
});

test("assertPasswordStrength rejects missing uppercase", () => {
  assert.equal(code(() => assertPasswordStrength("alllowercase1")), "PASSWORD_TOO_WEAK");
});

test("assertPasswordStrength error messages name what is missing, not a generic complaint", () => {
  const tooShort = (() => {
    try {
      assertPasswordStrength("short");
    } catch (e) {
      return e;
    }
    return null;
  })();
  assert.match(tooShort.publicMessage, /個字元/);

  const noUpper = (() => {
    try {
      assertPasswordStrength("alllowercase123");
    } catch (e) {
      return e;
    }
    return null;
  })();
  assert.match(noUpper.publicMessage, /大寫/);
});

test("assertPasswordStrength allows spaces and symbols; only trims the ends", () => {
  assert.doesNotThrow(() => assertPasswordStrength("Correct Horse Battery"));
});

test("assertPasswordStrength returns the trimmed password, not the raw input", () => {
  // DEF-004: 呼叫端一定要用呢個回傳值去 hash，唔可以再用原本未 trim 嘅
  // password——否則強度檢查同實際存落去嘅值會唔一致。
  assert.equal(assertPasswordStrength("  Correct-Horse-Battery-1  "), "Correct-Horse-Battery-1");
});

test("assertPasswordStrength keeps interior spaces untouched", () => {
  assert.equal(assertPasswordStrength("Correct Horse Battery"), "Correct Horse Battery");
});

test("assertPasswordStrength does not require digits or symbols", () => {
  assert.doesNotThrow(() => assertPasswordStrength("OnlyLettersHere"));
});

test("assertPasswordChanged rejects the same password", async () => {
  const hash = await hashPassword("Correct-Horse-Battery-1");

  await assert.rejects(
    () => assertPasswordChanged("Correct-Horse-Battery-1", hash),
    (error) => {
      assert.equal(error.code, "PASSWORD_UNCHANGED");
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

test("assertPasswordChanged accepts a genuinely new password", async () => {
  const hash = await hashPassword("Correct-Horse-Battery-1");

  await assert.doesNotReject(() => assertPasswordChanged("Different-Password-2", hash));
});
