import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerSettingsService } from "../../modules/customer/CustomerSettingsService.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import {
  CUSTOMER_SETTINGS_SCHEMA,
  CUSTOMER_SETTINGS_UPDATE_SCHEMA,
  EMPTY_OBJECT_SCHEMA
} from "./settingsSchemas.js";

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

class CustomerSettingsHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.settings = new CustomerSettingsService({
      database: services.require("mysqldatabase"),
      time: services.require("time")
    });
  }
}

export class GetCustomerSettingsHandler extends CustomerSettingsHandler {
  static handlerName = "getCustomerSettings";
  static api = {
    method: "GET",
    path: "/api/v1/customer-settings",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.settings],
    requestSchema: { params: EMPTY_OBJECT_SCHEMA, query: EMPTY_OBJECT_SCHEMA, body: EMPTY_OBJECT_SCHEMA },
    responseSchema: { 200: CUSTOMER_SETTINGS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.settings.getSettings(actorContext(req)));
  }
}

export class UpdateCustomerSettingsHandler extends CustomerSettingsHandler {
  static handlerName = "updateCustomerSettings";
  static api = {
    method: "POST",
    path: "/api/v1/customer-settings/update",
    authType: "jwt-device-password",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.settings],
    requestSchema: { params: EMPTY_OBJECT_SCHEMA, query: EMPTY_OBJECT_SCHEMA, body: CUSTOMER_SETTINGS_UPDATE_SCHEMA },
    responseSchema: { 200: CUSTOMER_SETTINGS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.settings.updateSettings({
      ...actorContext(req),
      requireActivationApproval: req.input.body.requireActivationApproval,
      version: req.input.body.version,
      reason: req.input.body.reason,
      requestId: req.requestId ?? "",
      ip: req.ip || req.socket?.remoteAddress || ""
    }));
  }
}
