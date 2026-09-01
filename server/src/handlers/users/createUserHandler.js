import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserAdminService } from "../../modules/user/UserAdminService.js";
import {
  DISPLAY_NAME_SCHEMA,
  EMPTY_OBJECT_SCHEMA,
  NEW_PASSWORD_SCHEMA,
  ROLE_IDS_SCHEMA,
  USERNAME_SCHEMA,
  USER_DETAIL_SCHEMA,
  USER_MGMT_POLICY
} from "./userSchemas.js";

export class CreateUserHandler extends BaseRequestHandler {
  static handlerName = "createUser";

  static api = {
    method: "POST",
    path: "/api/v1/users/create",
    description: "新增用戶，帶初始密碼與角色。建立即 must_change_password = 1。",
    // JWT + 已核准設備的簽章 + 當下的密碼，三者齊備才放行（§3.1）。
    authType: "jwt-device-password",
    authorizationPolicies: USER_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["username", "newUserPassword", "password"],
        additionalProperties: false,
        properties: {
          username: USERNAME_SCHEMA,
          displayName: DISPLAY_NAME_SCHEMA,
          // jwt-password strategy 在 schema 驗證之前就讀走 password，這裡仍要
          // 宣告它：沒宣告的話 additionalProperties: false 會讓通過了 strategy
          // 的請求，反而在 schema 驗證這一步被擋下來。
          password: { type: "string", minLength: 1, maxLength: 1024 },
          newUserPassword: NEW_PASSWORD_SCHEMA,
          roleIds: ROLE_IDS_SCHEMA
        }
      }
    },
    responseSchema: { 201: USER_DETAIL_SCHEMA }
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
    const { username, displayName, newUserPassword, roleIds } = req.input.body;

    const created = await this.userAdmin.create({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      username,
      displayName: displayName ?? "",
      password: newUserPassword,
      roleIds: roleIds ?? []
    });

    const full = await this.userAdmin.getById({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: created.id
    });

    return this.response(full, { statusCode: 201 });
  }
}
