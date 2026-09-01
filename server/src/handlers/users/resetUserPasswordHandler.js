import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserAdminService } from "../../modules/user/UserAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  NEW_PASSWORD_SCHEMA,
  REASON_SCHEMA,
  USER_ID_PARAMS_SCHEMA,
  USER_MGMT_POLICY
} from "./userSchemas.js";

const RESET_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 }
  }
});

export class ResetUserPasswordHandler extends BaseRequestHandler {
  static handlerName = "resetUserPassword";

  static api = {
    method: "POST",
    path: "/api/v1/users/:id/password/reset",
    description: "管理員重設用戶密碼，設 must_change_password 與 72 小時死線。",
    // 終態是 jwt-device-password（§3.1）；Phase 4 補上，理由與 createUserHandler
    // 相同。
    authType: "jwt-password",
    authorizationPolicies: USER_MGMT_POLICY,
    requestSchema: {
      params: USER_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["newUserPassword", "reason", "password"],
        additionalProperties: false,
        properties: {
          newUserPassword: NEW_PASSWORD_SCHEMA,
          reason: REASON_SCHEMA,
          password: { type: "string", minLength: 1, maxLength: 1024 }
        }
      }
    },
    responseSchema: { 200: RESET_RESULT_SCHEMA }
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
    const result = await this.userAdmin.resetPassword({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id),
      newPassword: req.input.body.newUserPassword,
      reason: req.input.body.reason
    });

    return this.response(result);
  }
}
