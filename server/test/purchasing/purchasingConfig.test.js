/**
 * TASK-010：Purchasing config 喺 startup 正規化，任何錯誤都令 server 起唔到（設計 §12.1）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import purchasingConfig from "../../config/purchasing.js";
import { normalizePurchasingConfig } from "../../src/modules/purchasing/normalizePurchasingConfig.js";


test("TASK-010 the defaults are the §12.1 values and the result is frozen", () => {
  const config = normalizePurchasingConfig({});
  assert.deepEqual({ ...config }, {
    maxPurchaseOrderLines: 100,
    maxGoodsReceiptDetails: 200,
    maxQuantity: Number.MAX_SAFE_INTEGER,
    duplicateDeliveryNoteLookbackDays: 90,
    exportMaxRows: 50_000,
    exportTimeoutMs: 120_000,
    approvalSnapshotMaxBytes: 65_536,
    auditDetailMaxBytes: 8_192
  });
  assert.ok(Object.isFrozen(config));
  // server/config/purchasing.js 未設環境變數時同 defaults 一致。
  assert.deepEqual({ ...normalizePurchasingConfig(purchasingConfig) }, { ...config });
});

test("TASK-010 every setting must be a positive safe integer within its limit", () => {
  const ceilings = {
    maxPurchaseOrderLines: 100, maxGoodsReceiptDetails: 200, maxQuantity: Number.MAX_SAFE_INTEGER,
    duplicateDeliveryNoteLookbackDays: 366, exportMaxRows: 50_000, exportTimeoutMs: 120_000,
    approvalSnapshotMaxBytes: 65_536, auditDetailMaxBytes: 8_192
  };
  for (const [name, ceiling] of Object.entries(ceilings)) {
    assert.equal(normalizePurchasingConfig({ [name]: 1 })[name], 1, name);
    assert.equal(normalizePurchasingConfig({ [name]: ceiling })[name], ceiling, name);
    // 環境變數讀成 Number：未設定以外嘅空字串係 0、亂打係 NaN，兩樣都要起唔到。
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, ceiling + 1, "10", null, 10n]) {
      assert.throws(() => normalizePurchasingConfig({ [name]: bad }), Error, `${name}=${String(bad)}`);
    }
  }
});

test("TASK-010 unknown settings and schema-bound constants cannot be configured", () => {
  // 精度同 PO／GR 6 位編號綁死 DB 欄位：係 purchasingConstants，唔係 config（§12.1）。
  // 交易時限用 database.transactionTimeoutMs，佢有「acquire＋transaction < requestTimeoutMs」嘅跨區塊檢查（HD-011）。
  for (const name of ["quantityDecimalPlaces", "unitPriceDecimalPlaces", "documentSequenceMax", "transactionTimeoutMs",
    "maxLines", "__proto__x"]) {
    assert.throws(() => normalizePurchasingConfig({ [name]: 6 }), /unsupported setting/u, name);
  }
  for (const source of [null, [], "x", 1]) {
    assert.throws(() => normalizePurchasingConfig(source), TypeError, String(source));
  }
});
