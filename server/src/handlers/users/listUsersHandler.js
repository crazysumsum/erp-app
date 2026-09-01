import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserAdminService } from "../../modules/user/UserAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  USER_LIST_QUERY_SCHEMA,
  USER_LIST_RESPONSE_SCHEMA,
  USER_MGMT_POLICY,
  toUserSummaryResponse
} from "./userSchemas.js";

export class ListUsersHandler extends BaseRequestHandler {
  static handlerName = "listUsers";

  static api = {
    method: "GET",
    path: "/api/v1/users",
    description: "分頁列出用戶，可搜尋、可篩狀態。",
    authorizationPolicies: USER_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: USER_LIST_QUERY_SCHEMA
    },
    responseSchema: { 200: USER_LIST_RESPONSE_SCHEMA }
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
    const { page, pageSize, q, status, sortBy, descending } = req.input.query;
    const result = await this.userAdmin.list({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      page,
      pageSize,
      q,
      status,
      sortBy,
      descending
    });

    return this.response({
      items: result.items.map(toUserSummaryResponse),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    });
  }
}
