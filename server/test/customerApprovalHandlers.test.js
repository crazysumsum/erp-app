import assert from "node:assert/strict";
import test from "node:test";

import { SubmitCustomerApprovalHandler, WithdrawCustomerApprovalHandler } from "../src/handlers/customers/customerHandlers.js";

test("Customer approval submit and withdraw routes use management authority, closed schemas and idempotency", () => {
  assert.equal(SubmitCustomerApprovalHandler.api.path, "/api/v1/customers/:id/approval/submit");
  assert.equal(WithdrawCustomerApprovalHandler.api.path, "/api/v1/customers/:id/approval/withdraw");
  for (const Handler of [SubmitCustomerApprovalHandler, WithdrawCustomerApprovalHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.mgmt"]);
    assert.deepEqual(Handler.api.idempotency, { enabled: true });
    for (const schema of Object.values(Handler.api.requestSchema)) assert.equal(schema.additionalProperties, false);
  }
  assert.deepEqual(SubmitCustomerApprovalHandler.api.requestSchema.body.required, ["approverUserId", "requestNote"]);
  assert.deepEqual(WithdrawCustomerApprovalHandler.api.requestSchema.body.required, ["approvalRequestId", "version"]);
});
