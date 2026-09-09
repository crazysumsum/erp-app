import itemConfig from "../../../config/item.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { uploadFileRequired } from "../../modules/item/itemErrors.js";
import { ItemMediaService } from "../../modules/item/ItemMediaService.js";
import { ITEM_MEDIA_UPLOAD_BODY_SCHEMA, MEDIA_SUMMARY_SCHEMA } from "../item-media/itemMediaSchemas.js";
import { EMPTY_OBJECT_SCHEMA, ITEM_ID_PARAMS_SCHEMA, ITEM_MGMT_POLICY } from "./itemSchemas.js";

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
 * 上傳一個 Item 層級共用嘅 media（`sku_id` 為 NULL）。設計說明見
 * docs/items_management/design_spec.md §6.6、§8.5。
 *
 * `upload.maxFileSizeBytes` 取 image／attachment 兩個上限中較寬鬆嗰個——實際
 * `kind` 要等 body 解析完先知道，route 層冇辦法按 kind 分開設定；圖片較嚴格
 * 嗰個上限由 `ItemMediaService.attach()` 再核一次（見 itemErrors.js 對
 * `mediaFileTooLarge()` 嘅註解）。
 */
export class ItemMediaUploadHandler extends BaseRequestHandler {
  static handlerName = "uploadItemMedia";

  static api = {
    method: "POST",
    path: "/api/v1/items/:id/media/upload",
    description: "上傳一個 Item 層級共用嘅 media 檔案。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    upload: {
      enabled: true,
      directory: itemConfig.mediaDirectory,
      maxFiles: 1,
      maxFileSizeBytes: Math.max(itemConfig.imageMaxBytes, itemConfig.attachmentMaxBytes),
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "application/pdf"]
    },
    requestSchema: {
      params: ITEM_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_MEDIA_UPLOAD_BODY_SCHEMA
    },
    responseSchema: { 201: MEDIA_SUMMARY_SCHEMA }
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
    if (!Array.isArray(req.files) || req.files.length !== 1) {
      throw uploadFileRequired();
    }

    const [file] = req.files;
    const summary = await this.itemMedia.attach({
      ...actorContext(req),
      targetType: "item",
      targetId: Number(req.input.params.id),
      kind: req.input.body.kind,
      isPrimary: req.input.body.isPrimary === "true",
      sortOrder: req.input.body.sortOrder !== undefined ? Number(req.input.body.sortOrder) : 0,
      version: Number(req.input.body.version),
      file,
      ...requestMeta(req)
    });

    return this.response(summary, { statusCode: 201 });
  }
}
