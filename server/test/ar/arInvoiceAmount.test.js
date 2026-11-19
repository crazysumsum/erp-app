/** 發票行金額的剩餘池規則（Sam 已批准；SCOPE §3）。金額以萬分之一為單位的 BigInt。 */
import assert from "node:assert/strict";
import test from "node:test";

import { ArInvoiceService, INVOICE_AMOUNT_POLICY, shipmentLineAmount } from "../../src/modules/ar/ArInvoiceService.js";

const amount = (lineAmount, ordered, prior, shipped) => shipmentLineAmount({ lineAmount: BigInt(lineAmount), orderedBaseQuantity: BigInt(ordered),
  priorShippedBaseQuantities: prior.map(BigInt), shippedBaseQuantity: BigInt(shipped) });

test("each shipment takes its half-up share of what remains, and the shipment that uses up the quantity takes the remainder", () => {
  // 一次出齊：整個訂單行金額。
  assert.equal(amount(100000, 3, [], 3), 100000n);
  // 10.0000 分三次各 1 件：3.3333、3.3334（6.6667 的一半 half-up）、3.3333（餘數）；三次相加等於訂單行金額。
  assert.deepEqual([amount(100000, 3, [], 1), amount(100000, 3, [1], 1), amount(100000, 3, [1, 1], 1)], [33333n, 33334n, 33333n]);
  // 1.0001 訂 5 件，先出 2 件再出 3 件：0.4000（0.40004 捨去）及 0.6001（餘數）。
  assert.deepEqual([amount(10001, 5, [], 2), amount(10001, 5, [2], 3)], [4000n, 6001n]);
  // 正好一半時進位：0.0001 訂 2 件，第一件 0.0001，第二件取餘數 0。
  assert.deepEqual([amount(1, 2, [], 1), amount(1, 2, [1], 1)], [1n, 0n]);
  // 未出齊的最後一次不取餘數，仍按比例：10.0000 訂 4 件，出 1 件再出 2 件。
  assert.deepEqual([amount(100000, 4, [], 1), amount(100000, 4, [1], 2)], [25000n, 50000n]);
  // 很大的數字不經過 Number：15 位整數金額、13 位數量。
  assert.equal(amount("9999999999999999999", "9999999999999", ["1"], "9999999999998") + amount("9999999999999999999", "9999999999999", [], "1"), 9999999999999999999n);
});

test("the result depends only on the order line and the quantities shipped before it, and a shipment beyond the ordered quantity is refused", () => {
  // 同一輸入永遠同一結果：與開票先後及是否同時開票無關。
  assert.equal(amount(100000, 3, [1], 1), amount(100000, 3, [1], 1));
  // 各次出貨金額之和永遠等於訂單行金額（出齊時）。
  for (const [total, quantities] of [[100000, [1, 1, 1]], [10001, [2, 3]], [77777, [3, 1, 2, 1]], [1, [1, 1, 1]]]) {
    const ordered = quantities.reduce((sum, quantity) => sum + quantity, 0);
    const parts = quantities.map((quantity, index) => amount(total, ordered, quantities.slice(0, index), quantity));
    assert.equal(parts.reduce((sum, part) => sum + part, 0n), BigInt(total), JSON.stringify(quantities));
    assert.ok(parts.every((part) => part >= 0n));
  }
  // 精度是參數：若改為直接按幣別 2 位小數分攤（step = 0.01），10.0000 分三次是 3.33、3.34、3.33，同樣守恆。
  const cents = (prior) => shipmentLineAmount({ lineAmount: 100000n, orderedBaseQuantity: 3n, priorShippedBaseQuantities: prior, shippedBaseQuantity: 1n, step: 100n });
  assert.deepEqual([cents([]), cents([1n]), cents([1n, 1n])], [33300n, 33400n, 33300n]);
  // 現行取法：分攤到 4 位小數；總額 half-up 到幣別小數位（0.005 進位，0 位小數的幣別取整數）。
  assert.equal(INVOICE_AMOUNT_POLICY.lineStep(2), 1n);
  assert.deepEqual([[10001n, 2], [10049n, 2], [10050n, 2], [333333n, 2], [15000n, 0], [14999n, 0], [12345n, 4]].map(([sum, places]) => INVOICE_AMOUNT_POLICY.total(sum, places)),
    [10000n, 10000n, 10100n, 333300n, 20000n, 10000n, 12345n]);
  assert.throws(() => amount(100000, 3, [2], 2), RangeError);
  assert.throws(() => amount(100000, 3, [], 0), RangeError);
  assert.throws(() => new ArInvoiceService({ commands: {}, readInvoiceSources: () => [], customers: {}, businessMaster: {}, time: {} }), TypeError);
});
