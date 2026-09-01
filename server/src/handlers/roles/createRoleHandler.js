import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { RoleAdminService } from "../../modules/role/RoleAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ROLE_DESCRIPTION_SCHEMA,
  ROLE_DETAIL_SCHEMA,
  ROLE_MGMT_POLICY,
  ROLE_NAME_SCHEMA
} from "./roleSchemas.js";

export class CreateRoleHandler extends BaseRequestHandler {
  static handlerName = "createRole";

  static api = {
    method: "POST",
    path: "/api/v1/roles/create",
    description: "新增角色。建出來是空的，沒有任何權限。",
    authorizationPolicies: ROLE_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
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
    responseSchema: { 201: ROLE_DETAIL_SCHEMA }
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
    const role = await this.roleAdmin.create({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      name: req.input.body.name,
      description: req.input.body.description ?? ""
    });

    return this.response(role, { statusCode: 201 });
  }
}
