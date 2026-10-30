/**
 * TASK-010：Purchasing config 喺 startup 正規化，任何錯誤都令 server 起唔到（設計 §12.1）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import purchasingConfig from "../../config/purchasing.js";
import { normalizePurchasingConfig } from "../../src/modules/purchasing/normalizePurchasingConfig.js";

const HTTP = { requestTimeoutMs: 30_000 };

test("TASK-010 the defaults are the §12.1 values and the result is frozen", () => {
  const config = normalizePurchasingConfig({}, HTTP);
  assert.deepEqual({ ...config }, {
    maxPurchaseOrderLines: 100,
    maxGoodsReceiptDetails: 200,
    maxQuantity: Number.MAX_SAFE_INTEGER,
    duplicateDeliveryNoteLookbackDays: 90,
    exportMaxRows: 50_000,
    exportTimeoutMs: 120_000,
    approvalSnapshotMaxBytes: 65_536,
    auditDetailMaxBytes: 8_192,
    transactionTimeoutMs: 30_000
  });
  assert.ok(Object.isFrozen(config));
  // server/config/purchasing.js 未設環境變數時同 defaults 一致。
  assert.deepEqual({ ...normalizePurchasingConfig(purchasingConfig, HTTP) }, { ...config });
});

test("TASK-010 every setting must be a positive safe integer within its limit", () => {
  const ceilings = {
    maxPurchaseOrderLines: 100, maxGoodsReceiptDetails: 200, maxQuantity: Number.MAX_SAFE_INTEGER,
    duplicateDeliveryNoteLookbackDays: 366, exportMaxRows: 50_000, exportTimeoutMs: 120_000,
    approvalSnapshotMaxBytes: 65_536, auditDetailMaxBytes: 8_192
  };
  for (const [name, ceiling] of Object.entries(ceilings)) {
    assert.equal(normalizePurchasingConfig({ [name]: 1 }, HTTP)[name], 1, name);
    assert.equal(normalizePurchasingConfig({ [name]: ceiling }, HTTP)[name], ceiling, name);
    // 環境變數讀成 Number：未設定以外嘅空字串係 0、亂打係 NaN，兩樣都要起唔到。
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, ceiling + 1, "10", null, 10n]) {
      assert.throws(() => normalizePurchasingConfig({ [name]: bad }, HTTP), Error, `${name}=${String(bad)}`);
    }
  }
});

test("TASK-010 a transaction may not outlive the HTTP request that started it", () => {
  assert.equal(normalizePurchasingConfig({ transactionTimeoutMs: 30_000 }, HTTP).transactionTimeoutMs, 30_000);
  assert.equal(normalizePurchasingConfig({ transactionTimeoutMs: 1 }, HTTP).transactionTimeoutMs, 1);
  assert.throws(() => normalizePurchasingConfig({ transactionTimeoutMs: 30_001 }, HTTP), /request timeout/u);
  // 冇實際 HTTP timeout 就驗唔到上面嗰條關係：唔准靜靜略過。
  for (const requestTimeoutMs of [undefined, 0, -1, 1.5, "30000"]) {
    assert.throws(() => normalizePurchasingConfig({}, { requestTimeoutMs }), TypeError, String(requestTimeoutMs));
  }
  assert.throws(() => normalizePurchasingConfig({}), TypeError);
});

test("TASK-010 unknown settings and schema-bound constants cannot be configured", () => {
  // 精度同 PO／GR 6 位編號綁死 DB 欄位：係 purchasingConstants，唔係 config（§12.1）。
  for (const name of ["quantityDecimalPlaces", "unitPriceDecimalPlaces", "documentSequenceMax", "maxLines", "__proto__x"]) {
    assert.throws(() => normalizePurchasingConfig({ [name]: 6 }, HTTP), /unsupported setting/u, name);
  }
  for (const source of [null, [], "x", 1]) {
    assert.throws(() => normalizePurchasingConfig(source, HTTP), TypeError, String(source));
  }
});
