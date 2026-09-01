import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { RoleAdminService } from "../../modules/role/RoleAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  REASON_SCHEMA,
  ROLE_ID_PARAMS_SCHEMA,
  ROLE_MGMT_POLICY
} from "./roleSchemas.js";

const DELETE_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 }
  }
});

export class DeleteRoleHandler extends BaseRequestHandler {
  static handlerName = "deleteRole";

  static api = {
    method: "POST",
    path: "/api/v1/roles/:id/delete",
    // CASCADE 會連帶清掉持有這個角色的用戶的 user_roles 列（見
    // 0003_add_auth_tables.js），刻意不擋這件事（§3.2）。
    description: "刪除角色。持有這個角色的用戶會連帶失去它（CASCADE）。",
    authType: "jwt-password",
    authorizationPolicies: ROLE_MGMT_POLICY,
    requestSchema: {
      params: ROLE_ID_PARAMS_SCHEMA,
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
    responseSchema: { 200: DELETE_RESULT_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.roleAdmin = new RoleAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const result = await this.roleAdmin.delete({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id),
      reason: req.input.body.reason
    });

    return this.response(result);
  }
}
