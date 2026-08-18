import { BaseRequestHandler } from "../framework/api/BaseRequestHandler.js";

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export class LogoutHandler extends BaseRequestHandler {
  static handlerName = "logout";

  static api = {
    method: "POST",
    path: "/api/v1/auth/logout",
    description: "撤銷目前使用者已簽發的所有 JWT。",
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: {
      200: {
        type: "object",
        required: ["revoked"],
        additionalProperties: false,
        properties: {
          revoked: { type: "boolean" }
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.tokenRevocation = services.require("tokenRevocation");
  }

  async execute(req) {
    const subject = req.auth.claims.sub;

    // 撤銷是以使用者為單位的（版本號 +1），所以登出會讓這個人在**所有裝置**上
    // 的 token 一起失效，不只是發出這個請求的那一個。這是 fr_token_versions 這
    // 個設計的直接結果：一個使用者一列，沒有 per-token 的記錄。要做「只登出這
    // 台裝置」需要另一套 per-token 的黑名單，成本是每個請求多一次查詢。
    await this.tokenRevocation.revoke(subject, { reason: "logout" });

    this.writeLog("info", "auth.logout.succeeded", "Logout succeeded", {
      requestId: req.requestId || null,
      userId: Number(subject)
    });

    return this.response({ revoked: true });
  }
}
