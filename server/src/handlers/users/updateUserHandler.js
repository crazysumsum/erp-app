import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserAdminService } from "../../modules/user/UserAdminService.js";
import {
  DISPLAY_NAME_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  USER_DETAIL_SCHEMA,
  USER_ID_PARAMS_SCHEMA,
  USER_MGMT_POLICY
} from "./userSchemas.js";

export class UpdateUserHandler extends BaseRequestHandler {
  static handlerName = "updateUser";

  static api = {
    method: "POST",
    path: "/api/v1/users/:id/update",
    // username 建立之後不可修改：requestSchema 只有 displayName 一個欄位，
    // additionalProperties: false 會讓帶了 username 的請求在驗證那一步被
    // 退回 400，不是被安靜地忽略（見 §3.1）。
    description: "修改用戶顯示名稱。username 建立之後不可變更。",
    authorizationPolicies: USER_MGMT_POLICY,
    requestSchema: {
      params: USER_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["displayName"],
        additionalProperties: false,
        properties: {
          displayName: DISPLAY_NAME_SCHEMA
        }
      }
    },
    responseSchema: { 200: USER_DETAIL_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.userAdmin = new UserAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time"),
      tokenRevocation: services.require("tokenRevocation")
    });
  }

  async execute(req) {
    const actor = {
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions
    };

    await this.userAdmin.update({
      ...actor,
      id: Number(req.input.params.id),
      displayName: req.input.body.displayName
    });

    const full = await this.userAdmin.getById({ ...actor, id: Number(req.input.params.id) });

    return this.response(full);
  }
}
