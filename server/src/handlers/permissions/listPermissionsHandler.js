import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { RoleAdminService } from "../../modules/role/RoleAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  PERMISSION_LIST_RESPONSE_SCHEMA,
  ROLE_MGMT_POLICY
} from "../roles/roleSchemas.js";

/**
 * 權限目錄，唯讀。掛 role.mgmt 而不是自己一個權限：讀權限目錄唯一的用途就是
 * 「為角色配權限」那個畫面上的勾選清單，兩者永遠一起出現（§1.1）。
 */
export class ListPermissionsHandler extends BaseRequestHandler {
  static handlerName = "listPermissions";

  static api = {
    method: "GET",
    path: "/api/v1/permissions",
    description: "權限目錄，唯讀。",
    authorizationPolicies: ROLE_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: { 200: PERMISSION_LIST_RESPONSE_SCHEMA }
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
    const items = await this.roleAdmin.listPermissions({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions
    });

    return this.response({ items });
  }
}
