import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserAdminService } from "../../modules/user/UserAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  REASON_SCHEMA,
  ROLE_IDS_SCHEMA,
  USER_ID_PARAMS_SCHEMA,
  USER_MGMT_POLICY
} from "./userSchemas.js";

const ASSIGN_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "roles"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    roles: { type: "array", items: { type: "string" } }
  }
});

export class AssignUserRolesHandler extends BaseRequestHandler {
  static handlerName = "assignUserRoles";

  static api = {
    method: "POST",
    path: "/api/v1/users/:id/roles/assign",
    description: "整組覆蓋該用戶的角色（compare-and-set）。",
    // JWT + 已核准設備的簽章 + 當下的密碼，三者齊備才放行（§3.1）。
    authType: "jwt-device-password",
    authorizationPolicies: USER_MGMT_POLICY,
    requestSchema: {
      params: USER_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["roleIds", "expectedRoleIds", "reason", "password"],
        additionalProperties: false,
        properties: {
          roleIds: ROLE_IDS_SCHEMA,
          // 前端載入畫面時看到的那一組，用來做 compare-and-set（§3.1）。
          expectedRoleIds: ROLE_IDS_SCHEMA,
          reason: REASON_SCHEMA,
          password: { type: "string", minLength: 1, maxLength: 1024 }
        }
      }
    },
    responseSchema: { 200: ASSIGN_RESULT_SCHEMA }
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
    const result = await this.userAdmin.assignRoles({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id),
      roleIds: req.input.body.roleIds,
      expectedRoleIds: req.input.body.expectedRoleIds,
      reason: req.input.body.reason
    });

    return this.response(result);
  }
}
