import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { USER_SCHEMA } from "./loginHandler.js";
import { UserService } from "../../modules/user/UserService.js";

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export class MeHandler extends BaseRequestHandler {
  static handlerName = "me";

  static api = {
    method: "GET",
    path: "/api/v1/user/me",
    description: "回傳目前登入使用者的資料、角色與權限。",
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: {
      200: USER_SCHEMA
    }
  };

  constructor(services = {}) {
    super(services);
    this.userService = new UserService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    // 重新讀資料庫，而不是直接回 token 裡的 claims：claims 是簽發當下的快照，
    // 帳號在那之後可能已經被停用、刪除或改了權限。前端把這支 API 的結果當成
    // session 的真實來源，所以它必須反映現在的狀態。
    const user = await this.userService.findActiveById(Number(req.auth.claims.sub));

    if (!user) {
      // token 有效但帳號已經不在或已停用。401 是對的：憑證本身已經沒有意義，
      // 客戶端應該回到登入頁，而不是以為自己只是權限不足。
      throw new ApplicationError("Authenticated user no longer exists or is disabled", {
        code: "USER_INACTIVE",
        statusCode: 401,
        publicCode: "Unauthorized Access",
        publicMessage: "Unauthorized Access"
      });
    }

    return this.response(user);
  }
}
