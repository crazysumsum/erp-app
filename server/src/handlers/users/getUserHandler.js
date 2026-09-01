import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserAdminService } from "../../modules/user/UserAdminService.js";
import { EMPTY_OBJECT_SCHEMA, USER_DETAIL_SCHEMA, USER_ID_PARAMS_SCHEMA, USER_MGMT_POLICY } from "./userSchemas.js";

export class GetUserHandler extends BaseRequestHandler {
  static handlerName = "getUser";

  static api = {
    method: "GET",
    path: "/api/v1/users/:id",
    description: "單一用戶詳情，含角色。",
    authorizationPolicies: USER_MGMT_POLICY,
    requestSchema: {
      params: USER_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
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
    const user = await this.userAdmin.getById({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id)
    });

    return this.response(user);
  }
}
