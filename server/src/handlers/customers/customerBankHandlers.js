import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerBankCrypto } from "../../modules/customer/CustomerBankCrypto.js";
import { CustomerBankService } from "../../modules/customer/CustomerBankService.js";
import { customerBankError } from "../../modules/customer/customerErrors.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import {
  CUSTOMER_BANK_CREATE, CUSTOMER_BANK_EMPTY, CUSTOMER_BANK_LIST_RESPONSE, CUSTOMER_BANK_PARAMS,
  CUSTOMER_BANK_PARENT_PARAMS, CUSTOMER_BANK_RESPONSE, CUSTOMER_BANK_REVEAL,
  CUSTOMER_BANK_REVEAL_RESPONSE, CUSTOMER_BANK_UPDATE, CUSTOMER_BANK_VERSIONED
} from "./customerBankSchemas.js";

const IDEMPOTENT = Object.freeze({ enabled: true });

function actor(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions, requestId: req.requestId ?? "",
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

class CustomerBankHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    const customer = services.config.customer;
    this.banks = customer.bankEncryption ? new CustomerBankService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time"),
      crypto: new CustomerBankCrypto({ encryption: customer.bankEncryption, lookup: customer.bankLookup })
    }) : null;
  }

  requireBanks() {
    if (!this.banks) throw customerBankError("CUSTOMER_BANK_UNAVAILABLE", 503, "銀行資料功能目前未啟用");
    return this.banks;
  }
}

export class ListCustomerBankAccountsHandler extends CustomerBankHandler {
  static handlerName = "listCustomerBankAccounts";
  static api = { method: "GET", path: "/api/v1/customers/:id/bank-accounts", description: "列出客戶銀行帳戶的遮蔽資料。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CUSTOMER_BANK_PARENT_PARAMS, query: CUSTOMER_BANK_EMPTY }, responseSchema: { 200: CUSTOMER_BANK_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.requireBanks().list({ ...actor(req), customerId: Number(req.input.params.id) })); }
}

export class CreateCustomerBankAccountHandler extends CustomerBankHandler {
  static handlerName = "createCustomerBankAccount";
  static api = { method: "POST", path: "/api/v1/customers/:id/bank-accounts/create", description: "新增客戶銀行帳戶。", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.bankManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_BANK_PARENT_PARAMS, query: CUSTOMER_BANK_EMPTY, body: CUSTOMER_BANK_CREATE }, responseSchema: { 201: CUSTOMER_BANK_RESPONSE } };
  async execute(req) { return this.response(await this.requireBanks().create({ ...actor(req), customerId: Number(req.input.params.id), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateCustomerBankAccountHandler extends CustomerBankHandler {
  static handlerName = "updateCustomerBankAccount";
  static api = { method: "POST", path: "/api/v1/customers/:id/bank-accounts/:bankId/update", description: "修改客戶銀行帳戶。", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.bankManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_BANK_PARAMS, query: CUSTOMER_BANK_EMPTY, body: CUSTOMER_BANK_UPDATE }, responseSchema: { 200: CUSTOMER_BANK_RESPONSE } };
  async execute(req) { return this.response(await this.requireBanks().update({ ...actor(req), customerId: Number(req.input.params.id), bankAccountId: Number(req.input.params.bankId), ...req.input.body })); }
}

export class SetDefaultCustomerBankAccountHandler extends CustomerBankHandler {
  static handlerName = "setDefaultCustomerBankAccount";
  static api = { method: "POST", path: "/api/v1/customers/:id/bank-accounts/:bankId/default", description: "設定客戶的預設銀行帳戶。", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.bankManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_BANK_PARAMS, query: CUSTOMER_BANK_EMPTY, body: CUSTOMER_BANK_VERSIONED }, responseSchema: { 200: CUSTOMER_BANK_RESPONSE } };
  async execute(req) { return this.response(await this.requireBanks().setDefault({ ...actor(req), customerId: Number(req.input.params.id), bankAccountId: Number(req.input.params.bankId), ...req.input.body })); }
}

export class DeactivateCustomerBankAccountHandler extends CustomerBankHandler {
  static handlerName = "deactivateCustomerBankAccount";
  static api = { method: "POST", path: "/api/v1/customers/:id/bank-accounts/:bankId/deactivate", description: "停用客戶銀行帳戶。", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.bankManage], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_BANK_PARAMS, query: CUSTOMER_BANK_EMPTY, body: CUSTOMER_BANK_VERSIONED }, responseSchema: { 200: CUSTOMER_BANK_RESPONSE } };
  async execute(req) { return this.response(await this.requireBanks().deactivate({ ...actor(req), customerId: Number(req.input.params.id), bankAccountId: Number(req.input.params.bankId), ...req.input.body })); }
}

export class RevealCustomerBankAccountHandler extends CustomerBankHandler {
  static handlerName = "revealCustomerBankAccount";
  static api = { method: "POST", path: "/api/v1/customers/:id/bank-accounts/:bankId/reveal", description: "重新驗證後查看完整客戶銀行帳號。", authType: "jwt-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.bankReveal], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_BANK_PARAMS, query: CUSTOMER_BANK_EMPTY, body: CUSTOMER_BANK_REVEAL }, responseSchema: { 200: CUSTOMER_BANK_REVEAL_RESPONSE } };
  async execute(req, res) {
    res.setHeader("Pragma", "no-cache");
    return this.response(await this.requireBanks().reveal({ ...actor(req), customerId: Number(req.input.params.id), bankAccountId: Number(req.input.params.bankId), ...req.input.body }));
  }
}
