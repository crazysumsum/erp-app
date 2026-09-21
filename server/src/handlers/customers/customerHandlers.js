import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerService } from "../../modules/customer/CustomerService.js";
import { CustomerPartyService } from "../../modules/customer/CustomerPartyService.js";
import { CustomerCreditService } from "../../modules/customer/CustomerCreditService.js";
import { CustomerApprovalService } from "../../modules/customer/CustomerApprovalService.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import {
  CUSTOMER_COMMAND_RESPONSE, CUSTOMER_DETAIL, CUSTOMER_ID_PARAMS, CUSTOMER_LIST_QUERY,
  CUSTOMER_LIST_RESPONSE, CUSTOMER_ROOT_INPUT, CUSTOMER_UPDATE_INPUT, DUPLICATE_RESPONSE,
  EMPTY, ADDRESS_CREATE, CONTACT_CREATE, PARTY_CREATED, ADDRESS_UPDATE, CONTACT_UPDATE,
  PARTY_UPDATED, DEACTIVATE_PARTY, PARTY_DEACTIVATED, CUSTOMER_PARENT_PARAMS,
  CUSTOMER_ADDRESS_PARAMS, CUSTOMER_CONTACT_PARAMS, CUSTOMER_IDENTIFIER_PARAMS,
  IDENTIFIER_CREATE, IDENTIFIER_UPDATE, IDENTIFIER_RESPONSE,
  CREDIT_POLICY_RESPONSE, CREDIT_POLICY_SAVE, CREDIT_POLICY_CLEAR, CUSTOMER_CHILD_LIST_QUERY,
  CUSTOMER_ADDRESS_LIST_RESPONSE, CUSTOMER_CONTACT_LIST_RESPONSE, CUSTOMER_IDENTIFIER_LIST_RESPONSE,
  CUSTOMER_APPROVAL_RESPONSE, CUSTOMER_APPROVAL_SUBMIT, CUSTOMER_APPROVAL_WITHDRAW
} from "./customerSchemas.js";

const IDEMPOTENT = Object.freeze({ enabled: true });

function actorInput(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

function commandInput(req) {
  return {
    ...actorInput(req), idempotencyKey: req.get("Idempotency-Key"), requestId: req.requestId ?? "",
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

class CustomerHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.customer = new CustomerService({ database: services.require("mysqldatabase"), time: services.require("time") });
    this.party = new CustomerPartyService({ database: services.require("mysqldatabase"), time: services.require("time") });
    this.credit = new CustomerCreditService({ database: services.require("mysqldatabase"), time: services.require("time") });
    this.approvals = new CustomerApprovalService({ database: services.require("mysqldatabase"), time: services.require("time") });
  }
}

export class ListCustomersHandler extends CustomerHandler {
  static handlerName = "listCustomers";
  static api = { method: "GET", path: "/api/v1/customers", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: EMPTY, query: CUSTOMER_LIST_QUERY }, responseSchema: { 200: CUSTOMER_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.customer.list({ ...actorInput(req), ...req.input.query })); }
}

export class GetCustomerHandler extends CustomerHandler {
  static handlerName = "getCustomer";
  static api = { method: "GET", path: "/api/v1/customers/:id", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CUSTOMER_ID_PARAMS, query: EMPTY }, responseSchema: { 200: CUSTOMER_DETAIL } };
  async execute(req) { return this.response(await this.customer.get({ ...actorInput(req), id: Number(req.input.params.id) })); }
}

export class ListCustomerAddressesHandler extends CustomerHandler {
  static handlerName = "listCustomerAddresses";
  static api = { method: "GET", path: "/api/v1/customers/:id/addresses", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CUSTOMER_ID_PARAMS, query: CUSTOMER_CHILD_LIST_QUERY }, responseSchema: { 200: CUSTOMER_ADDRESS_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.customer.listAddresses({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.query })); }
}

export class ListCustomerContactsHandler extends CustomerHandler {
  static handlerName = "listCustomerContacts";
  static api = { method: "GET", path: "/api/v1/customers/:id/contacts", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CUSTOMER_ID_PARAMS, query: CUSTOMER_CHILD_LIST_QUERY }, responseSchema: { 200: CUSTOMER_CONTACT_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.customer.listContacts({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.query })); }
}

export class ListCustomerIdentifiersHandler extends CustomerHandler {
  static handlerName = "listCustomerIdentifiers";
  static api = { method: "GET", path: "/api/v1/customers/:id/identifiers", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CUSTOMER_ID_PARAMS, query: CUSTOMER_CHILD_LIST_QUERY }, responseSchema: { 200: CUSTOMER_IDENTIFIER_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.customer.listIdentifiers({ ...actorInput(req), id: Number(req.input.params.id), ...req.input.query })); }
}

export class CheckCustomerDuplicatesHandler extends CustomerHandler {
  static handlerName = "checkCustomerDuplicates";
  static api = { method: "POST", path: "/api/v1/customers/duplicates/check", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: EMPTY, query: EMPTY, body: CUSTOMER_ROOT_INPUT }, responseSchema: { 200: DUPLICATE_RESPONSE } };
  async execute(req) { return this.response(await this.customer.checkDuplicates({ ...actorInput(req), ...req.input.body })); }
}

export class CreateCustomerHandler extends CustomerHandler {
  static handlerName = "createCustomer";
  static api = { method: "POST", path: "/api/v1/customers/create", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: EMPTY, query: EMPTY, body: CUSTOMER_ROOT_INPUT }, responseSchema: { 201: CUSTOMER_COMMAND_RESPONSE } };
  async execute(req) { return this.response(await this.customer.create({ ...commandInput(req), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateCustomerHandler extends CustomerHandler {
  static handlerName = "updateCustomer";
  static api = { method: "POST", path: "/api/v1/customers/:id/update", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ID_PARAMS, query: EMPTY, body: CUSTOMER_UPDATE_INPUT }, responseSchema: { 200: CUSTOMER_COMMAND_RESPONSE } };
  async execute(req) { return this.response(await this.customer.update({ ...commandInput(req), id: Number(req.input.params.id), ...req.input.body })); }
}

export class SubmitCustomerApprovalHandler extends CustomerHandler {
  static handlerName = "submitCustomerApproval";
  static api = { method: "POST", path: "/api/v1/customers/:id/approval/submit", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ID_PARAMS, query: EMPTY, body: CUSTOMER_APPROVAL_SUBMIT }, responseSchema: { 200: CUSTOMER_APPROVAL_RESPONSE } };
  async execute(req) { return this.response(await this.approvals.submit({ ...commandInput(req), customerId: Number(req.input.params.id), ...req.input.body })); }
}

export class WithdrawCustomerApprovalHandler extends CustomerHandler {
  static handlerName = "withdrawCustomerApproval";
  static api = { method: "POST", path: "/api/v1/customers/:id/approval/withdraw", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ID_PARAMS, query: EMPTY, body: CUSTOMER_APPROVAL_WITHDRAW }, responseSchema: { 200: CUSTOMER_APPROVAL_RESPONSE } };
  async execute(req) { return this.response(await this.approvals.withdraw({ ...commandInput(req), customerId: Number(req.input.params.id), ...req.input.body })); }
}

export class CreateCustomerAddressHandler extends CustomerHandler {
  static handlerName = "createCustomerAddress";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/addresses/create", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_PARENT_PARAMS, query: EMPTY, body: ADDRESS_CREATE }, responseSchema: { 201: PARTY_CREATED } };
  async execute(req) { return this.response(await this.party.create({ ...commandInput(req), type: "address", customerId: Number(req.input.params.customerId), ...req.input.body }), { statusCode: 201 }); }
}

export class CreateCustomerContactHandler extends CustomerHandler {
  static handlerName = "createCustomerContact";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/contacts/create", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_PARENT_PARAMS, query: EMPTY, body: CONTACT_CREATE }, responseSchema: { 201: PARTY_CREATED } };
  async execute(req) { return this.response(await this.party.create({ ...commandInput(req), type: "contact", customerId: Number(req.input.params.customerId), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateCustomerAddressHandler extends CustomerHandler {
  static handlerName = "updateCustomerAddress";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/addresses/:addressId/update", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ADDRESS_PARAMS, query: EMPTY, body: ADDRESS_UPDATE }, responseSchema: { 200: PARTY_UPDATED } };
  async execute(req) { return this.response(await this.party.update({ ...commandInput(req), type: "address", customerId: Number(req.input.params.customerId), partyId: Number(req.input.params.addressId), ...req.input.body })); }
}

export class DeactivateCustomerAddressHandler extends CustomerHandler {
  static handlerName = "deactivateCustomerAddress";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/addresses/:addressId/deactivate", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ADDRESS_PARAMS, query: EMPTY, body: DEACTIVATE_PARTY }, responseSchema: { 200: PARTY_DEACTIVATED } };
  async execute(req) { return this.response(await this.party.deactivate({ ...commandInput(req), type: "address", customerId: Number(req.input.params.customerId), partyId: Number(req.input.params.addressId), ...req.input.body })); }
}

export class UpdateCustomerContactHandler extends CustomerHandler {
  static handlerName = "updateCustomerContact";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/contacts/:contactId/update", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_CONTACT_PARAMS, query: EMPTY, body: CONTACT_UPDATE }, responseSchema: { 200: PARTY_UPDATED } };
  async execute(req) { return this.response(await this.party.update({ ...commandInput(req), type: "contact", customerId: Number(req.input.params.customerId), partyId: Number(req.input.params.contactId), ...req.input.body })); }
}

export class DeactivateCustomerContactHandler extends CustomerHandler {
  static handlerName = "deactivateCustomerContact";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/contacts/:contactId/deactivate", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_CONTACT_PARAMS, query: EMPTY, body: DEACTIVATE_PARTY }, responseSchema: { 200: PARTY_DEACTIVATED } };
  async execute(req) { return this.response(await this.party.deactivate({ ...commandInput(req), type: "contact", customerId: Number(req.input.params.customerId), partyId: Number(req.input.params.contactId), ...req.input.body })); }
}

export class CreateCustomerIdentifierHandler extends CustomerHandler {
  static handlerName = "createCustomerIdentifier";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/identifiers/create", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_PARENT_PARAMS, query: EMPTY, body: IDENTIFIER_CREATE }, responseSchema: { 201: IDENTIFIER_RESPONSE } };
  async execute(req) { return this.response(await this.party.createIdentifier({ ...commandInput(req), customerId: Number(req.input.params.customerId), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateCustomerIdentifierHandler extends CustomerHandler {
  static handlerName = "updateCustomerIdentifier";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/identifiers/:identifierId/update", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_IDENTIFIER_PARAMS, query: EMPTY, body: IDENTIFIER_UPDATE }, responseSchema: { 200: IDENTIFIER_RESPONSE } };
  async execute(req) { return this.response(await this.party.updateIdentifier({ ...commandInput(req), customerId: Number(req.input.params.customerId), identifierId: Number(req.input.params.identifierId), ...req.input.body })); }
}

export class DeactivateCustomerIdentifierHandler extends CustomerHandler {
  static handlerName = "deactivateCustomerIdentifier";
  static api = { method: "POST", path: "/api/v1/customers/:customerId/identifiers/:identifierId/deactivate", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_IDENTIFIER_PARAMS, query: EMPTY, body: DEACTIVATE_PARTY }, responseSchema: { 200: IDENTIFIER_RESPONSE } };
  async execute(req) { return this.response(await this.party.deactivateIdentifier({ ...commandInput(req), customerId: Number(req.input.params.customerId), identifierId: Number(req.input.params.identifierId), ...req.input.body })); }
}

export class GetCustomerCreditPolicyHandler extends CustomerHandler {
  static handlerName = "getCustomerCreditPolicy";
  static api = { method: "GET", path: "/api/v1/customers/:id/credit-policy", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CUSTOMER_ID_PARAMS, query: EMPTY }, responseSchema: { 200: CREDIT_POLICY_RESPONSE } };
  async execute(req) { return this.response(await this.credit.get({ ...actorInput(req), customerId: Number(req.input.params.id) })); }
}

export class SaveCustomerCreditPolicyHandler extends CustomerHandler {
  static handlerName = "saveCustomerCreditPolicy";
  static api = { method: "POST", path: "/api/v1/customers/:id/credit-policy/save", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ID_PARAMS, query: EMPTY, body: CREDIT_POLICY_SAVE }, responseSchema: { 200: CREDIT_POLICY_RESPONSE } };
  async execute(req) { return this.response(await this.credit.save({ ...commandInput(req), customerId: Number(req.input.params.id), ...req.input.body })); }
}

export class ClearCustomerCreditPolicyHandler extends CustomerHandler {
  static handlerName = "clearCustomerCreditPolicy";
  static api = { method: "POST", path: "/api/v1/customers/:id/credit-policy/clear", authType: "jwt-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ID_PARAMS, query: EMPTY, body: CREDIT_POLICY_CLEAR }, responseSchema: { 200: CREDIT_POLICY_RESPONSE } };
  async execute(req) { return this.response(await this.credit.clear({ ...commandInput(req), customerId: Number(req.input.params.id), version: req.input.body.version, reason: req.input.body.reason })); }
}

for (const Handler of [ListCustomersHandler, GetCustomerHandler, ListCustomerAddressesHandler, ListCustomerContactsHandler, ListCustomerIdentifiersHandler, CheckCustomerDuplicatesHandler, CreateCustomerHandler, UpdateCustomerHandler, CreateCustomerAddressHandler, CreateCustomerContactHandler, UpdateCustomerAddressHandler, DeactivateCustomerAddressHandler, UpdateCustomerContactHandler, DeactivateCustomerContactHandler, CreateCustomerIdentifierHandler, UpdateCustomerIdentifierHandler, DeactivateCustomerIdentifierHandler, GetCustomerCreditPolicyHandler, SaveCustomerCreditPolicyHandler, ClearCustomerCreditPolicyHandler]) {
  Handler.api.description = `${Handler.handlerName} endpoint.`;
}
