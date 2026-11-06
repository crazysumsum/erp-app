import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASING_SETTINGS_POLICY, PURCHASING_SETTINGS_RESPONSE, PURCHASING_SETTINGS_UPDATE_RESPONSE, purchaseOrderCommand, purchasingSettingsService
} from "../purchasing/purchasingSchemas.js";

class SettingsHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.settings = purchasingSettingsService(services, this.logger);
  }
}

export class GetPurchasingSettingsHandler extends SettingsHandler {
  static handlerName = "getPurchasingSettings";
  static api = { method: "GET", path: "/api/v1/purchasing-settings", description: "Read Purchasing settings", authorizationPolicies: [PURCHASING_SETTINGS_POLICY],
    requestSchema: { query: EMPTY }, responseSchema: { 200: PURCHASING_SETTINGS_RESPONSE } };
  async execute(req) { return this.response(await this.settings.get({ claims: req.auth.claims })); }
}

/** 改變之後所有 PO 嘅控制政策，要已註冊裝置簽署兼再輸入密碼（§5.4、§6.2）。 */
export class UpdatePurchasingSettingsHandler extends SettingsHandler {
  static handlerName = "updatePurchasingSettings";
  static api = { method: "POST", path: "/api/v1/purchasing-settings/update", description: "Update Purchasing settings", authType: "jwt-device-password",
    authorizationPolicies: [PURCHASING_SETTINGS_POLICY], idempotency: { enabled: true }, requestSchema: { query: EMPTY, body: {} }, responseSchema: { 200: PURCHASING_SETTINGS_UPDATE_RESPONSE } };
  async execute(req) { return this.response(await this.settings.update(purchaseOrderCommand(req, "settings"))); }
}
