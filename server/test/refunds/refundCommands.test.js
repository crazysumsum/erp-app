import assert from "node:assert/strict";
import test from "node:test";
import { RefundService } from "../../src/modules/refunds/RefundService.js";

const eventId = "00000000-0000-4000-8000-000000000001";
const actor = { id: 5, username: "Synthetic test actor" };
const time = { fileDate: () => "2026-11-25", at: value => value };
const nowMs = 1795564800000;
const confirmedAt = 1795564700000;
const dimensions = {
  customer: { refund: "ar_refunds", credit: "ar_credit_notes", party: "customer_id", permission: "ar.refund.mgmt" },
  supplier: { refund: "ap_supplier_refunds", credit: "ap_credit_notes", party: "supplier_id", permission: "ap.refund.mgmt" }
};

function fixture(kind, overrides = {}) {
  const d = dimensions[kind];
  const refund = {
    id: 9, credit_note_id: 7, [d.party]: 11, currency_code: "HKD", refund_date: "2026-11-24",
    status: "DRAFT", amount: "12.3400", refund_number: null, version: 1, ...overrides.refund
  };
  const credit = {
    id: 7, [d.party]: 11, currency_code: "HKD", currency_decimal_places: 2, status: "CONFIRMED",
    version: 4, available_amount: "12.3400", refunded_amount: "3.0000", ...overrides.credit
  };
  const calls = [];
  const tx = {
    async query(sql, params) {
      if (sql.startsWith("SELECT credit_note_id")) { calls.push("discover"); return [[{ credit_note_id: 7 }]]; }
      if (sql.includes(`FROM ${d.credit}`) && sql.endsWith("FOR UPDATE")) { calls.push("credit"); return [[credit]]; }
      if (sql.includes(`FROM ${d.refund}`) && sql.endsWith("FOR UPDATE")) { calls.push("refund"); return [[refund]]; }
      if (sql === `INSERT INTO ${d.refund} SET ?`) { calls.push(["insert", params[0]]); return [{ insertId: 9 }]; }
      if (sql === `UPDATE ${d.refund} SET ? WHERE id = ? AND version = ?`) {
        calls.push(["refund-update", params[0]]);
        assert.deepEqual(params.slice(1), [9, Number(refund.version)]);
        return [{ affectedRows: 1 }];
      }
      assert.fail(sql);
    },
    async execute(sql, params) {
      assert.match(sql, new RegExp(`^UPDATE ${d.credit} SET available_amount`));
      assert.match(sql, /version = version \+ 1, updated_at = \?/u);
      calls.push(["funds", ...params]);
      return [{ affectedRows: 1 }];
    }
  };
  const service = new RefundService({
    kind, time,
    commands: {
      async run(command, work) {
        assert.equal(command.permission, d.permission);
        assert.equal(command.targetType, "REFUND");
        assert.equal(command.eventId, eventId);
        calls.push(command.commandType);
        return work(tx, { actor, nowMs });
      }
    },
    nextDocumentNumber: async (executor, options) => {
      assert.equal(executor, tx);
      assert.equal(options.documentType, "REFUND");
      calls.push("number");
      return kind === "customer" ? "RFD-2026-000001" : "SRF-2026-000001";
    }
  });
  return { service, calls };
}
const action = (version = 1, fields = {}) => ({ refundId: 9, claims: {}, input: { eventId, version, ...fields } });

test("refund confirmation locks the credit before the refund and takes the number after updating the exact credit balance", async () => {
  for (const kind of ["customer", "supplier"]) {
    const { service, calls } = fixture(kind);
    const { summary, audit } = await service.confirm(action());
    assert.equal(summary.status, "CONFIRMED");
    assert.equal(summary.version, 2);
    assert.equal(audit.targetType, "REFUND");
    assert.deepEqual(calls.slice(0, 6), [
      "CONFIRM_REFUND", "discover", "credit", "refund", ["funds", "0.0000", "15.3400", nowMs, 7, 4], "number"
    ]);
    assert.equal(calls[6][1].confirmed_at, nowMs);
  }
});

test("a refund draft cannot consume credit and derives party and currency from its source", async () => {
  const { service, calls } = fixture("supplier");
  await service.create({ claims: {}, input: {
    eventId, creditNoteId: 7, refundDate: "2026-11-24", amount: "12.34", paymentMethod: "BANK_TRANSFER"
  } });
  assert.deepEqual(calls.slice(0, 2), ["CREATE_REFUND", "credit"]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2][1], {
    credit_note_id: 7, supplier_id: 11, currency_code: "HKD", amount: "12.3400",
    refund_date: "2026-11-24", payment_method: "BANK_TRANSFER", reference: "", notes: "",
    created_by: 5, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
  });
});

test("credit already spent or a different party prevents all writes on confirmation", async () => {
  for (const [overrides, code] of [
    [{ credit: { available_amount: "2.0000" } }, "REFUND_EXCEEDS_CREDIT"],
    [{ refund: { customer_id: 12 } }, "REFUND_BALANCE_CONFLICT"],
    [{ refund: { version: 2 } }, "VERSION_CONFLICT"]
  ]) {
    const { service, calls } = fixture("customer", overrides);
    await assert.rejects(service.confirm(action()), { code });
    assert.deepEqual(calls, ["CONFIRM_REFUND", "discover", "credit", "refund"]);
  }
});

test("void restores only this refund to the credit and keeps the document number", async () => {
  const { service, calls } = fixture("customer", {
    refund: { status: "CONFIRMED", refund_number: "RFD-2026-000010", version: 2, confirmed_at: confirmedAt },
    credit: { available_amount: "0.0000", refunded_amount: "15.3400" }
  });
  const { summary } = await service.void(action(2, { reason: "Synthetic correction reason" }));
  assert.equal(summary.number, "RFD-2026-000010");
  assert.deepEqual(calls.slice(0, 5), [
    "VOID_REFUND", "discover", "credit", "refund", ["funds", "12.3400", "3.0000", nowMs, 7, 4]
  ]);
  assert.equal(calls[5][1].status, "VOID");
});

test("cancelling a draft still works after the source credit was voided and leaves funds untouched", async () => {
  const { service, calls } = fixture("supplier", { credit: { status: "VOID" } });
  const { summary } = await service.cancel(action());
  assert.equal(summary.status, "CANCELLED");
  assert.deepEqual(calls.slice(0, 4), ["CANCEL_REFUND", "discover", "credit", "refund"]);
  assert.equal(calls.length, 5);
});
