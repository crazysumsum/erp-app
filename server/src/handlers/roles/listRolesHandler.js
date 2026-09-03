import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { RoleAdminService } from "../../modules/role/RoleAdminService.js";
import { EMPTY_OBJECT_SCHEMA, ROLE_LIST_POLICY, ROLE_LIST_RESPONSE_SCHEMA } from "./roleSchemas.js";

export class ListRolesHandler extends BaseRequestHandler {
  static handlerName = "listRoles";

  static api = {
    method: "GET",
    path: "/api/v1/roles",
    description: "全部角色，含權限名與持有人數，不分頁。",
    authorizationPolicies: ROLE_LIST_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: { 200: ROLE_LIST_RESPONSE_SCHEMA }
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
    const items = await this.roleAdmin.list({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions
    });

    return this.response({ items });
  }
}
