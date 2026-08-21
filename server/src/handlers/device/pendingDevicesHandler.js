import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  DEVICE_MGMT_POLICY,
  EMPTY_OBJECT_SCHEMA,
  PENDING_BINDING_SCHEMA,
  toPendingBinding
} from "./deviceBindingSchemas.js";

/**
 * 待審批的設備綁定申請。
 *
 * 回傳 label、IP 與 User-Agent，因為審批者要靠它們做判斷——一組 thumbprint 加
 * 一串公鑰對人類毫無意義，沒有這些欄位，審批只會退化成無腦按核准，而那時這道
 * 關卡就只是流程上的裝飾。
 */
export class PendingDevicesHandler extends BaseRequestHandler {
  static handlerName = "pendingDevices";

  static api = {
    method: "GET",
    path: "/api/v1/device/bindings/pending",
    description: "列出所有等待審批的設備綁定申請。",
    authorizationPolicies: DEVICE_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: {
      200: {
        type: "object",
        required: ["items"],
        additionalProperties: false,
        properties: {
          items: { type: "array", items: PENDING_BINDING_SCHEMA }
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.deviceBinding = services.require("deviceBinding");
  }

  async execute() {
    const rows = await this.deviceBinding.listPending();

    return this.response({ items: rows.map(toPendingBinding) });
  }
}
