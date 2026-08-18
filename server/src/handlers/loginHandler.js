import { ApplicationError } from "../framework/errors/ApplicationError.js";
import { BaseRequestHandler } from "../framework/api/BaseRequestHandler.js";

// 使用者物件的形狀，登入與 /me 共用。前端的 session store 直接吃這個。
export const USER_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "username", "displayName", "roles", "permissions"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    username: { type: "string" },
    displayName: { type: "string" },
    roles: { type: "array", items: { type: "string" } },
    permissions: { type: "array", items: { type: "string" } }
  }
});

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export class LoginHandler extends BaseRequestHandler {
  static handlerName = "login";

  static api = {
    method: "POST",
    path: "/api/v1/auth/login",
    description: "以帳號密碼登入，成功時簽發 JWT。",
    authType: "public",
    authorizationPolicies: [
      {
        name: "allowAll",
        options: {}
      }
    ],
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["username", "password"],
        additionalProperties: false,
        properties: {
          username: { type: "string", minLength: 1, maxLength: 190 },
          // 上限不是密碼強度的限制，是成本的限制：沒有上限的話，一個貼滿整個
          // body limit 的「密碼」也會走完一次完整的雜湊。
          password: { type: "string", minLength: 1, maxLength: 1024 }
        }
      }
    },
    responseSchema: {
      200: {
        type: "object",
        required: ["token", "tokenType", "expiresIn", "user"],
        additionalProperties: false,
        properties: {
          token: { type: "string" },
          tokenType: { type: "string" },
          expiresIn: { type: "string" },
          user: USER_SCHEMA
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.userService = services.require("user");
    this.jwt = services.require("jwt");
    this.tokenRevocation = services.require("tokenRevocation");
  }

  async execute(req) {
    const { username, password } = req.input.body;
    const result = await this.userService.authenticate(username, password);

    if (!result.ok) {
      // 失敗原因只進日誌。回應對每一種原因都一樣，否則回應本身就會告訴攻擊者
      // 哪些帳號存在、哪些已被鎖定。
      this.writeLog(
        "warn",
        "auth.login.failed",
        "Login attempt was rejected",
        {
          requestId: req.requestId || null,
          username: String(username),
          reason: result.reason
        }
      );

      throw new ApplicationError(`Login rejected: ${result.reason}`, {
        code: "LOGIN_FAILED",
        statusCode: 401,
        publicCode: "Unauthorized Access",
        publicMessage: "Invalid username or password"
      });
    }

    const { user } = result;
    const subject = String(user.id);

    // 版本號要從資料庫讀當下的值，不能用撤銷快照——快照可以落後，用它簽出來的
    // token 會在下一次刷新時被自己的實例判成已撤銷。見 currentVersion() 的註解。
    const version = await this.tokenRevocation.currentVersion(subject);

    // roles 與 permissions 進 claims，授權策略 hasRole／hasPermission 直接讀它們，
    // 請求路徑上因此不需要再查資料庫。代價是改權限要等 token 過期或被撤銷。
    const token = this.jwt.issue(
      { roles: user.roles, permissions: user.permissions },
      { subject, version }
    );

    this.writeLog("info", "auth.login.succeeded", "Login succeeded", {
      requestId: req.requestId || null,
      userId: user.id,
      username: user.username
    });

    return this.response({
      token,
      tokenType: this.jwt.authScheme,
      expiresIn: this.jwt.expiresIn,
      user
    });
  }
}
