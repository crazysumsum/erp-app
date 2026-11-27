import assert from "node:assert/strict";
import test from "node:test";

import { invoiceLineCreditLimits } from "../../src/modules/ar/arCreditLimits.js";

test("AR credit caps distribute the rounding remainder by remainder then line number, independent of input order", () => {
  const lines = [
    { id: 2, line_no: 2, line_amount: "0.0149" },
    { id: 3, line_no: 3, line_amount: "0.0100" },
    { id: 1, line_no: 1, line_amount: "0.0149" }
  ];
  const caps = invoiceLineCreditLimits(lines, 400n, 2);
  assert.deepEqual([caps.get(1), caps.get(2), caps.get(3)], [200n, 100n, 100n]);
  assert.equal([...caps.values()].reduce((sum, cap) => sum + cap, 0n), 400n);

  const unequal = invoiceLineCreditLimits([
    { id: 1, line_no: 1, line_amount: "0.0138" },
    { id: 2, line_no: 2, line_amount: "0.0149" }
  ], 300n, 2);
  assert.deepEqual([unequal.get(1), unequal.get(2)], [100n, 200n]);
});

test("AR credit caps keep four-place amounts exact and reject an inconsistent original invoice total", () => {
  assert.deepEqual(invoiceLineCreditLimits([{ id: 1, line_no: 1, line_amount: "999999999999999.9999" }],
    9999999999999999999n, 4), new Map([[1, 9999999999999999999n]]));
  assert.throws(() => invoiceLineCreditLimits([{ id: 1, line_no: 1, line_amount: "10.00" }], 100100n, 2), { code: "AR_CREDIT_SOURCE_INVALID" });
});
