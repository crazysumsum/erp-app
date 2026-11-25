import assert from "node:assert/strict";
import test from "node:test";
import { confirmedRefundBalance, voidedRefundBalance } from "../../src/modules/refunds/refundBalance.js";

const credit = (available, refunded) => ({ available_amount: available, refunded_amount: refunded });

test("a confirmed refund consumes only the available credit and preserves four-place precision", () => {
  assert.deepEqual(confirmedRefundBalance(credit("17.3400", "4.0000"), "17.34"), {
    availableAmount: "0.0000",
    refundedAmount: "21.3400"
  });
  assert.throws(() => confirmedRefundBalance(credit("0.0000", "21.3400"), "0.01"), {
    code: "REFUND_EXCEEDS_CREDIT"
  });
  assert.deepEqual(confirmedRefundBalance(credit("90071992547409.1000", "0.0000"), "0.0001"), {
    availableAmount: "90071992547409.0999",
    refundedAmount: "0.0001"
  });
});

test("voiding a confirmed refund restores exactly its amount without unwinding other refunded amounts", () => {
  assert.deepEqual(voidedRefundBalance(credit("0.0000", "21.3400"), "17.3400"), {
    availableAmount: "17.3400",
    refundedAmount: "4.0000"
  });
  assert.throws(() => voidedRefundBalance(credit("17.3400", "4.0000"), "17.3400"), {
    code: "REFUND_BALANCE_CONFLICT"
  });
});

test("refund commands reject zero as an invalid amount in either direction", () => {
  assert.throws(() => confirmedRefundBalance(credit("1.0000", "1.0000"), "0"), { code: "REFUND_INPUT_INVALID" });
  assert.throws(() => voidedRefundBalance(credit("1.0000", "1.0000"), "0"), { code: "REFUND_INPUT_INVALID" });
});
