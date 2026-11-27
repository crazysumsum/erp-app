import assert from "node:assert/strict";
import test from "node:test";

import { lockArCreditNote, updateArCreditNote } from "../../src/modules/ar/arCreditNoteBalance.js";

test("AR refunds and credit commands lock the same note and advance its version with the balance", async () => {
  const credit = { id: "3", status: "CONFIRMED", version: 2, available_amount: "25.0000", refunded_amount: "0.0000" };
  const tx = {
    async query(sql, params) {
      assert.match(sql, /FROM ar_credit_notes WHERE id = \? FOR UPDATE$/u);
      assert.deepEqual(params, [3]);
      return [[credit]];
    }
  };
  assert.equal(await lockArCreditNote(tx, 3), credit);
  const changes = { available_amount: "20.0000", refunded_amount: "5.0000" };
  tx.query = async (sql, params) => {
    assert.equal(sql, "UPDATE ar_credit_notes SET ? WHERE id = ? AND version = ?");
    assert.deepEqual(params, [{ ...changes, version: 3, updated_at: 1000 }, credit.id, 2]);
    return [{ affectedRows: 1 }];
  };
  assert.deepEqual(await updateArCreditNote(tx, credit, changes, 1000), { ...credit, ...changes, version: 3, updated_at: 1000 });
  tx.query = async () => [{ affectedRows: 0 }];
  await assert.rejects(updateArCreditNote(tx, credit, changes, 1000), { code: "CONCURRENT_OPERATION" });
});
