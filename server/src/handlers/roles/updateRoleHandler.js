import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { RoleAdminService } from "../../modules/role/RoleAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ROLE_DESCRIPTION_SCHEMA,
  ROLE_DETAIL_SCHEMA,
  ROLE_ID_PARAMS_SCHEMA,
  ROLE_MGMT_POLICY,
  ROLE_NAME_SCHEMA
} from "./roleSchemas.js";

export class UpdateRoleHandler extends BaseRequestHandler {
  static handlerName = "updateRole";

  static api = {
    method: "POST",
    path: "/api/v1/roles/:id/update",
    description: "改角色名稱／描述。system-admin 拒絕修改（ROLE_PROTECTED）。",
    authorizationPolicies: ROLE_MGMT_POLICY,
    requestSchema: {
      params: ROLE_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: ROLE_NAME_SCHEMA,
          description: ROLE_DESCRIPTION_SCHEMA
        }
      }
    },
    responseSchema: { 200: ROLE_DETAIL_SCHEMA }
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
    const role = await this.roleAdmin.update({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id),
      name: req.input.body.name,
      description: req.input.body.description ?? ""
    });

    return this.response(role);
  }
}
