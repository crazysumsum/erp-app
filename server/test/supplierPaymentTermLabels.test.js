import assert from "node:assert/strict";
import test from "node:test";

import { paymentTermsById } from "../src/modules/supplier/paymentTermLabels.js";

function provider({ active = [], history = {} } = {}) {
  const calls = [];
  return {
    calls,
    async listPaymentTerms(input) { calls.push(["list", input]); return active; },
    async getPaymentTermHistory(id) { calls.push(["history", id]); return history[id] ?? null; }
  };
}

const term = (id, status = "ACTIVE") => ({ id, code: `T${id}`, name: `Term ${id}`, calculationType: "NET_DAYS", dueDays: 30, status, version: 1 });

test("reads the Active list once and history only for the IDs it did not find (DEF-040, REV-117 M-1)", async () => {
  const fake = provider({ active: [term(1), term(5)], history: { 2: term(2, "INACTIVE"), 3: term(3, "INACTIVE") } });
  const terms = await paymentTermsById(fake, [1, 2, null, 3, 2, undefined, 1]);
  assert.deepEqual(fake.calls, [["list", { page: 1, pageSize: 100 }], ["history", 2], ["history", 3]]);
  assert.deepEqual([...terms.keys()], [1, 2, 3], "only the wanted IDs, never the unrelated Active term 5");
  assert.deepEqual(terms.get(2), { id: 2, code: "T2", name: "Term 2", status: "INACTIVE" });
});

test("no IDs means no provider read at all", async () => {
  const fake = provider();
  assert.equal((await paymentTermsById(fake, [null, undefined])).size, 0);
  assert.deepEqual(fake.calls, []);
});
