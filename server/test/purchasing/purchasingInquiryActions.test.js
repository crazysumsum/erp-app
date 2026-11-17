/**
 * TASK-045（§8.4）：allowedActions 用 has_confirmed_receipt 投影放出 cancel 同 withdrawConfirmation；權威仍然係 lifecycle 嘅 reader。
 * Sam 2026-11-12 批准（call_cb2041d1，提案 3e97d261）：表格式一個 case，三個狀態乘 flag 兩個值。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { allowedActions } from "../../src/modules/purchasing/PurchasingInquiryService.js";

test("TASK-045 allowedActions：未有確認收貨先列 cancel，CONFIRMED 另加 withdrawConfirmation", () => {
  const manage = ["purchasing.view", "purchasing.mgmt"];
  for (const [status, hasConfirmedReceipt, expected] of [
    ["DRAFT", false, ["edit", "submit", "copy", "cancel"]],
    ["DRAFT", true, ["edit", "submit", "copy"]],
    ["PENDING_APPROVAL", false, ["copy", "cancel"]],
    ["PENDING_APPROVAL", true, ["copy"]],
    ["CONFIRMED", false, ["copy", "cancel", "withdrawConfirmation"]],
    ["CONFIRMED", true, ["copy"]]
  ]) {
    assert.deepEqual(allowedActions(status, manage, hasConfirmedReceipt), expected, `${status} hasConfirmedReceipt=${hasConfirmedReceipt}`);
  }
});
