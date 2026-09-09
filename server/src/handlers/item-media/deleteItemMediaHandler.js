import { unlink } from "node:fs/promises";
import path from "node:path";
import itemConfig from "../../../config/item.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemMediaService } from "../../modules/item/ItemMediaService.js";
import { EMPTY_OBJECT_SCHEMA } from "../items/itemSchemas.js";
import {
  ITEM_MEDIA_DELETE_BODY_SCHEMA,
  ITEM_MEDIA_DELETE_RESULT_SCHEMA,
  ITEM_MGMT_POLICY,
  MEDIA_ID_PARAMS_SCHEMA
} from "./itemMediaSchemas.js";

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

function requestMeta(req) {
  return {
    requestId: req.requestId,
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

/**
 * 永久刪除一個 media：先在交易內刪 metadata 及寫 audit，commit 後才刪實體
 * 檔案。設計說明見 docs/items_management/design_spec.md §6.6、§7.3、§8.5。
 *
 * 兩者不能用同一個交易（檔案系統沒有交易可以跟 DB 一起 commit／rollback）。
 * unlink 失敗不影響已經 commit 的刪除結果——業務上這筆 media 已經刪除，只是
 * 磁碟上多留了一個此刻沒有任何 DB 記錄指向的檔案，記一筆結構化 error 後交由
 * `ItemMediaCleanupJob` 之後按 orphan 規則清走。
 */
export class DeleteItemMediaHandler extends BaseRequestHandler {
  static handlerName = "deleteItemMedia";

  static api = {
    method: "POST",
    path: "/api/v1/item-media/:id/delete",
    description: "永久刪除一個 Item／SKU media；不可復原。",
    authType: "jwt-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: MEDIA_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_MEDIA_DELETE_BODY_SCHEMA
    },
    responseSchema: { 200: ITEM_MEDIA_DELETE_RESULT_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemMedia = new ItemMediaService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time"),
      imageMaxBytes: services.config.item.imageMaxBytes,
      attachmentMaxBytes: services.config.item.attachmentMaxBytes
    });
  }

  async execute(req) {
    const id = Number(req.input.params.id);
    const { storedName } = await this.itemMedia.delete({
      ...actorContext(req),
      id,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    try {
      await unlink(path.join(itemConfig.mediaDirectory, storedName));
    } catch (error) {
      if (error.code !== "ENOENT") {
        void this.logger?.error("item.media_delete_failed", "Deleted media's file could not be removed", {
          requestId: req.requestId || null,
          mediaId: id,
          storedName,
          error: { name: error.name, code: error.code ?? null, message: error.message }
        });
      }
    }

    return this.response({ id });
  }
}
