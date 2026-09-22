import assert from "node:assert/strict";
import test from "node:test";

import * as handlers from "../src/handlers/customers/customerHandlers.js";
import * as approvalHandlers from "../src/handlers/customer-approvals/approvalHandlers.js";
import { ListCustomerApproversHandler } from "../src/handlers/customer-approvers/listCustomerApproversHandler.js";
import { GetCustomerOperationHandler } from "../src/handlers/customer-operations/getCustomerOperationHandler.js";

test("TC-012 Customer root APIs use strict schemas, route permissions and framework idempotency", () => {
  const values = [...Object.values(handlers), ...Object.values(approvalHandlers), ListCustomerApproversHandler, GetCustomerOperationHandler].filter((value) => typeof value === "function" && value.api);
  assert.equal(values.length, 39);
  for (const Handler of values) {
    for (const schema of Object.values(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, Handler.handlerName);
    }
  }
  for (const Handler of values.filter((Handler) => Handler.api.method === "POST")) {
    assert.deepEqual(Handler.api.idempotency, { enabled: true }, Handler.handlerName);
  }
  for (const Handler of values.filter((Handler) => Handler.api.method === "POST" && !["approveCustomerApproval", "rejectCustomerApproval", "reassignCustomerApproval", "blockCustomer", "unblockCustomer"].includes(Handler.handlerName))) {
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.mgmt"]);
  }
  assert.equal(handlers.ListCustomersHandler.api.authorizationPolicies[0].options.permissions[0], "customer.view");
  assert.equal(handlers.UpdateCustomerHandler.api.requestSchema.body.properties.customerCode, undefined);
  assert.equal(handlers.GetCustomerHandler.api.requestSchema.params.properties.id.type, "integer");
  assert.equal(handlers.GetCustomerHandler.api.requestSchema.params.properties.id.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(handlers.GetCustomerCompletenessHandler.api.path, "/api/v1/customers/:id/completeness");
  for (const [name, path] of [
    ["ListCustomerAddressesHandler", "/api/v1/customers/:id/addresses"],
    ["ListCustomerContactsHandler", "/api/v1/customers/:id/contacts"],
    ["ListCustomerIdentifiersHandler", "/api/v1/customers/:id/identifiers"]
  ]) {
    assert.equal(handlers[name].api.path, path);
    assert.equal(handlers[name].api.requestSchema.query.properties.pageSize.default, 20);
    assert.deepEqual(handlers[name].api.authorizationPolicies[0].options.permissions, ["customer.view"]);
  }
  assert.doesNotMatch(JSON.stringify(handlers.ListCustomersHandler.api.requestSchema.query.properties.missing), /bank|attachment/);
  assert.equal(handlers.CreateCustomerHandler.api.requestSchema.body.properties.website.pattern, "^(?:$|https?://)");
  assert.equal(handlers.CreateCustomerHandler.api.requestSchema.body.properties.generalEmail.anyOf[1].format, "email");
  assert.equal(handlers.CreateCustomerAddressHandler.api.responseSchema[201].properties.version.minimum, 1);
  assert.equal(handlers.UpdateCustomerAddressHandler.api.requestSchema.body.properties.reason.minLength, 5);
  for (const name of ["UpdateCustomerAddressHandler", "DeactivateCustomerAddressHandler", "UpdateCustomerContactHandler", "DeactivateCustomerContactHandler"]) {
    assert.equal(typeof handlers[name], "function", `${name} must be exported`);
    assert.deepEqual(handlers[name].api.idempotency, { enabled: true });
  }
  assert.equal(handlers.CreateCustomerIdentifierHandler.api.requestSchema.body.properties.identifierValue.maxLength, 190);
  assert.equal(handlers.UpdateCustomerIdentifierHandler.api.requestSchema.body.properties.reason.minLength, 5);
  assert.equal(handlers.SaveCustomerCreditPolicyHandler.api.requestSchema.body.properties.creditLimit.pattern, "^(?:0|[1-9][0-9]{0,14})\\.[0-9]{4}$");
  assert.ok(!handlers.SaveCustomerCreditPolicyHandler.api.requestSchema.body.required.includes("creditNotes"));
  assert.deepEqual(handlers.GetCustomerCreditPolicyHandler.api.authorizationPolicies[0].options.permissions, ["customer.view"]);
  assert.equal(handlers.ClearCustomerCreditPolicyHandler.api.authType, "jwt-password");
  assert.ok(handlers.ClearCustomerCreditPolicyHandler.api.requestSchema.body.required.includes("password"));
  assert.equal(handlers.ChangeCustomerCodeHandler.api.authType, "jwt-device-password");
  assert.equal(handlers.DeleteCustomerHandler.api.authType, "jwt-device-password");
  for (const name of ["SuspendCustomerHandler", "ReactivateCustomerHandler", "ArchiveCustomerHandler", "RestoreCustomerHandler"]) {
    assert.equal(handlers[name].api.authType, "jwt-password", name);
    assert.ok(handlers[name].api.requestSchema.body.required.includes("password"), name);
  }
  for (const name of ["ApproveCustomerApprovalHandler", "RejectCustomerApprovalHandler", "ReassignCustomerApprovalHandler"]) {
    assert.equal(approvalHandlers[name].api.authType, "jwt-password", name);
    assert.deepEqual(approvalHandlers[name].api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.approval"]);
  }
  for (const name of ["BlockCustomerHandler", "UnblockCustomerHandler"]) {
    assert.equal(handlers[name].api.authType, "jwt-device-password", name);
    assert.deepEqual(handlers[name].api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.approval"]);
  }
  assert.equal(handlers.ActivateCustomerHandler.api.path, "/api/v1/customers/:id/activate");
  assert.equal(handlers.CreateCustomerHandler.api.requestSchema.body.properties.activate.type, "boolean");
  assert.ok(handlers.CreateCustomerHandler.api.requestSchema.body.properties.approverUserId);
  for (const Handler of values) assert.doesNotMatch(JSON.stringify(Handler.api.responseSchema), /"trim"/, Handler.handlerName);
});
