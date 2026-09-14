import assert from "node:assert/strict";
import test from "node:test";

import { BusinessMasterProvider } from "../../../src/modules/businessMaster/BusinessMasterProvider.js";

test("TC-020 v1 consumer provider returns minimal stable projections without admin permission input", async () => {
  const currency = { code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2, status: "ACTIVE", version: 4 };
  const term = { id: 8, code: "NET30", name: "Net 30", description: "Thirty days", calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 2 };
  const listCalls = [];
  const repository = {
    async listCurrencies(_connection, input) { listCalls.push(["currency", input]); return { items: [currency], total: 1, page: 1, pageSize: 100 }; },
    async listPaymentTerms(_connection, input) { listCalls.push(["payment-term", input]); return { items: [term], total: 1, page: 1, pageSize: 100 }; },
    async getCurrency() { return currency; },
    async getPaymentTerm() { return term; }
  };
  const provider = new BusinessMasterProvider({ database: {}, repository });
  assert.equal(BusinessMasterProvider.contract, "business-master-currency-payment-term-provider/v1");
  assert.deepEqual(await provider.listActiveCurrencies({ page: 2, pageSize: 50 }), [{ code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2, status: "ACTIVE", version: 4 }]);
  assert.deepEqual(await provider.listActivePaymentTerms({ page: 3, pageSize: 20 }), [{ id: 8, code: "NET30", name: "Net 30", calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 2 }]);
  assert.deepEqual(listCalls, [
    ["currency", { status: "ACTIVE", page: 2, pageSize: 50 }],
    ["payment-term", { status: "ACTIVE", page: 3, pageSize: 20 }]
  ]);
  assert.equal((await provider.getPaymentTermHistory(8)).description, undefined);
  assert.deepEqual(provider.calculatePaymentTermSnapshot(term, "2026-01-31"), {
    term: { id: 8, code: "NET30", name: "Net 30", version: 2, calculationType: "NET_DAYS", dueDays: 30 },
    baseDate: "2026-01-31",
    dueDate: "2026-03-02",
    requiresManualDueDate: false
  });
});
