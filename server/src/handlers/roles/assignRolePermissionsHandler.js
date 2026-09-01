import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { RoleAdminService } from "../../modules/role/RoleAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  PERMISSION_IDS_SCHEMA,
  REASON_SCHEMA,
  ROLE_ID_PARAMS_SCHEMA,
  ROLE_MGMT_POLICY
} from "./roleSchemas.js";

const ASSIGN_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "permissions"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    permissions: { type: "array", items: { type: "string" } }
  }
});

export class AssignRolePermissionsHandler extends BaseRequestHandler {
  static handlerName = "assignRolePermissions";

  static api = {
    method: "POST",
    path: "/api/v1/roles/:id/permissions/assign",
    description: "整組覆蓋該角色的權限（compare-and-set）。system-admin 拒絕修改。",
    // JWT + 已核准設備的簽章 + 當下的密碼，三者齊備才放行（§3.1）。
    authType: "jwt-device-password",
    authorizationPolicies: ROLE_MGMT_POLICY,
    requestSchema: {
      params: ROLE_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["permissionIds", "expectedPermissionIds", "reason", "password"],
        additionalProperties: false,
        properties: {
          permissionIds: PERMISSION_IDS_SCHEMA,
          // 前端載入畫面時看到的那一組，用來做 compare-and-set（§3.1）。
          expectedPermissionIds: PERMISSION_IDS_SCHEMA,
          reason: REASON_SCHEMA,
          password: { type: "string", minLength: 1, maxLength: 1024 }
        }
      }
    },
    responseSchema: { 200: ASSIGN_RESULT_SCHEMA }
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
    const result = await this.roleAdmin.assignPermissions({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id),
      permissionIds: req.input.body.permissionIds,
      expectedPermissionIds: req.input.body.expectedPermissionIds,
      reason: req.input.body.reason
    });

    return this.response(result);
  }
}
