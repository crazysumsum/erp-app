import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerService } from "../../modules/customer/CustomerService.js";
import { CustomerPartyService } from "../../modules/customer/CustomerPartyService.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import {
  CUSTOMER_COMMAND_RESPONSE, CUSTOMER_DETAIL, CUSTOMER_ID_PARAMS, CUSTOMER_LIST_QUERY,
  CUSTOMER_LIST_RESPONSE, CUSTOMER_ROOT_INPUT, CUSTOMER_UPDATE_INPUT, DUPLICATE_RESPONSE,
  EMPTY, ADDRESS_CREATE, CONTACT_CREATE, PARTY_CREATED, ADDRESS_UPDATE, CONTACT_UPDATE,
  PARTY_UPDATED, DEACTIVATE_PARTY, PARTY_DEACTIVATED, CUSTOMER_PARENT_PARAMS,
  CUSTOMER_ADDRESS_PARAMS, CUSTOMER_CONTACT_PARAMS
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

for (const Handler of [ListCustomersHandler, GetCustomerHandler, CheckCustomerDuplicatesHandler, CreateCustomerHandler, UpdateCustomerHandler, CreateCustomerAddressHandler, CreateCustomerContactHandler, UpdateCustomerAddressHandler, DeactivateCustomerAddressHandler, UpdateCustomerContactHandler, DeactivateCustomerContactHandler]) {
  Handler.api.description = `${Handler.handlerName} endpoint.`;
}
