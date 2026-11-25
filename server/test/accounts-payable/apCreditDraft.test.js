import assert from "node:assert/strict";
import test from "node:test";
import { creditLineCaps, validateCreditAmounts } from "../../src/modules/accounts-payable/apCreditDraft.js";

const original = [
  { id: 20, line_no: 2, line_amount: "0.0149" },
  { id: 10, line_no: 1, line_amount: "0.0149" }
];
const creditLine = (invoiceLineId, amount) => ({ invoiceLineId, amount });

test("Credit caps distribute the original rounded total by remainder, then by original line number", () => {
  assert.deepEqual(creditLineCaps(original, "0.0300", 2), new Map([[10, 200n], [20, 100n]]));
  assert.deepEqual(creditLineCaps([
    { id: 1, line_no: 1, line_amount: "1.0001" },
    { id: 2, line_no: 2, line_amount: "1.9999" }
  ], "3.0000", 0), new Map([[2, 20000n], [1, 10000n]]));
});

test("Credit line limits include prior confirmed amounts and repeated invoice-line references", () => {
  const caps = creditLineCaps(original, "0.0300", 2);
  const amounts = validateCreditAmounts([
    creditLine(10, "0.01"), creditLine(10, "0.01"), creditLine(20, "0.01")
  ], caps, new Map(), 300n, 0n, 2);
  assert.equal(amounts, "0.0300");
  const code = "AP_CREDIT_EXCEEDS_INVOICE";
  assert.throws(() => validateCreditAmounts([
    creditLine(10, "0.01"), creditLine(10, "0.01")
  ], caps, new Map([[10, 100n]]), 300n, 100n, 2), { code });
  assert.throws(() => validateCreditAmounts([creditLine(20, "0.01")], caps, new Map(), 300n, 300n, 2), { code });
  for (const line of [creditLine(20, "0.0101"), creditLine(20, "0"), creditLine(99, "0.01")]) {
    assert.throws(() => validateCreditAmounts([line], caps, new Map(), 300n, 0n, 2), { code: "AP_INPUT_INVALID" });
  }
});
