import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserAdminService } from "../../modules/user/UserAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  REASON_SCHEMA,
  USER_ID_PARAMS_SCHEMA,
  USER_MGMT_POLICY,
  USER_SUMMARY_SCHEMA,
  toUserSummaryResponse
} from "./userSchemas.js";

export class DisableUserHandler extends BaseRequestHandler {
  static handlerName = "disableUser";

  static api = {
    method: "POST",
    path: "/api/v1/users/:id/disable",
    description: "停用用戶，並立即撤銷其所有 token（§3.6）。",
    authType: "jwt-password",
    authorizationPolicies: USER_MGMT_POLICY,
    requestSchema: {
      params: USER_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["reason", "password"],
        additionalProperties: false,
        properties: {
          reason: REASON_SCHEMA,
          password: { type: "string", minLength: 1, maxLength: 1024 }
        }
      }
    },
    responseSchema: { 200: USER_SUMMARY_SCHEMA }
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
    const user = await this.userAdmin.disable({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id),
      reason: req.input.body.reason,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || ""
    });

    return this.response(toUserSummaryResponse(user));
  }
}
