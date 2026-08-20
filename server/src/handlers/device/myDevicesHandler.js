import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY_OBJECT_SCHEMA,
  MY_DEVICE_SCHEMA,
  toMyDevice
} from "./deviceBindingSchemas.js";

/**
 * 使用者自己的設備清單。
 *
 * 不覆寫 authorizationPolicies：沿用預設的 authenticated 就夠——它只回傳
 * req.auth.claims.sub 自己的列，不接受任何指定使用者的參數。少了那個參數，
 * 「看別人的設備」這件事在這支 API 上就不存在，不必再靠一條授權規則去擋。
 */
export class MyDevicesHandler extends BaseRequestHandler {
  static handlerName = "myDevices";

  static api = {
    method: "GET",
    path: "/api/v1/device/bindings",
    description: "列出目前使用者自己的設備綁定。",
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
          items: { type: "array", items: MY_DEVICE_SCHEMA }
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.deviceBinding = services.require("deviceBinding");
  }

  async execute(req) {
    const rows = await this.deviceBinding.listForUser(Number(req.auth.claims.sub));

    return this.response({ items: rows.map(toMyDevice) });
  }
}
