/**
 * TASK-045（§8.4、0119 chk_gr_confirmation）：ever-confirmed reader 嘅純規則，用假 tx，唔掂 DB。
 * Sam 2026-11-12 批准（call_cb2041d1，提案 3e97d261）：U1～U7。真 InnoDB 嘅 FOR SHARE 同索引由 purchasingLifecycle G6 驗。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { GoodsReceiptFacts } from "../../src/modules/purchasing/GoodsReceiptFacts.js";

const reader = new GoodsReceiptFacts();
const fakeTx = (rows) => ({ calls: [], async query(sql, params) { this.calls.push([sql, params]); if (rows instanceof Error) throw rows; return [rows]; } });
const confirmed = (id, extra = {}) => ({ id, status: "CONFIRMED", confirmed_at: 1, confirm_event_id: `ev-${id}`, ...extra });
const unavailable = (goodsReceiptId) => (error) => error.code === "PURCHASING_DEPENDENCY_UNAVAILABLE" && error.statusCode === 503
  && (goodsReceiptId === undefined || error.goodsReceiptId === goodsReceiptId);

test("TASK-045 U1 CONFIRMED 缺 confirmed_at 即 throw，旁邊有合法已確認行都一樣", async () => {
  await assert.rejects(reader.everConfirmed(fakeTx([confirmed(1), confirmed(2, { confirmed_at: null })]), 8), unavailable(2));
});

test("TASK-045 U2 DRAFT 帶 confirm_event_id 即 throw", async () => {
  await assert.rejects(reader.everConfirmed(fakeTx([{ id: 3, status: "DRAFT", confirmed_at: null, confirm_event_id: "e" }]), 8), unavailable(3));
});

test("TASK-045 U3 未知狀態即 throw", async () => {
  await assert.rejects(reader.everConfirmed(fakeTx([{ id: 4, status: "BOGUS", confirmed_at: null, confirm_event_id: null }]), 8), unavailable(4));
});

test("TASK-045 U4 讀取失敗變成 typed 503，原本嘅錯誤做 cause", async () => {
  const original = new Error("lock wait timeout");
  await assert.rejects(reader.everConfirmed(fakeTx(original), 8), (error) => unavailable()(error) && error.cause === original);
});

test("TASK-045 U5 空 rowset 回 false，用 PO id 做參數、FOR SHARE 讀", async () => {
  const tx = fakeTx([]);
  assert.equal(await reader.everConfirmed(tx, 8), false);
  assert.deepEqual(tx.calls.map(([sql, params]) => [/FROM goods_receipts WHERE purchase_order_id = \? FOR SHARE$/u.test(sql), params]), [[true, [8]]]);
});

test("TASK-045 U6 合法 CONFIRMED 回 true", async () => {
  assert.equal(await reader.everConfirmed(fakeTx([{ id: 5, status: "DRAFT", confirmed_at: null, confirm_event_id: null }, confirmed(6)]), 8), true);
});

test("TASK-045 U7 REVERSED／PARTIALLY_REVERSED 而且 confirmed_by 係 NULL 都回 true", async () => {
  for (const status of ["REVERSED", "PARTIALLY_REVERSED"]) {
    assert.equal(await reader.everConfirmed(fakeTx([confirmed(7, { status, confirmed_by: null })]), 8), true, status);
  }
});
