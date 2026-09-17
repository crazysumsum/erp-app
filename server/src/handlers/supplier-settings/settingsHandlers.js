import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierSettingsService } from "../../modules/supplier/SupplierSettingsService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  SUPPLIER_SETTINGS_POLICY,
  SUPPLIER_SETTINGS_SCHEMA,
  SUPPLIER_SETTINGS_UPDATE_SCHEMA
} from "./settingsSchemas.js";

/**
 * Supplier Settings 嘅讀寫。寫入要 `jwt-device-password`：設計 §6.7 將設定寫入
 * 同 Bank／封鎖放喺同一個認證強度，因為佢改變所有之後嘅啟用行為。
 */

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

class SupplierSettingsHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.settings = new SupplierSettingsService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }
}

export class GetSupplierSettingsHandler extends SupplierSettingsHandler {
  static handlerName = "getSupplierSettings";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-settings",
    description: "讀取供應商模組設定與其版本。",
    authorizationPolicies: SUPPLIER_SETTINGS_POLICY,
    requestSchema: { params: EMPTY_OBJECT_SCHEMA, query: EMPTY_OBJECT_SCHEMA, body: EMPTY_OBJECT_SCHEMA },
    responseSchema: { 200: SUPPLIER_SETTINGS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.settings.getSettings(actorContext(req)));
  }
}

export class UpdateSupplierSettingsHandler extends SupplierSettingsHandler {
  static handlerName = "updateSupplierSettings";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-settings/update",
    description: "修改供應商模組設定；只影響之後提交的啟用操作。",
    authType: "jwt-device-password",
    authorizationPolicies: SUPPLIER_SETTINGS_POLICY,
    requestSchema: { params: EMPTY_OBJECT_SCHEMA, query: EMPTY_OBJECT_SCHEMA, body: SUPPLIER_SETTINGS_UPDATE_SCHEMA },
    responseSchema: { 200: SUPPLIER_SETTINGS_SCHEMA }
  };

  async execute(req) {
    // 逐項傳，唔 spread body：password 由 auth strategy 處理，唔應該去到 service。
    return this.response(await this.settings.updateSettings({
      ...actorContext(req),
      requireActivationApproval: req.input.body.requireActivationApproval,
      version: req.input.body.version,
      reason: req.input.body.reason,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || ""
    }));
  }
}
