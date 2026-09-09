import itemConfig from "../../../config/item.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { mediaFileRequired } from "../../modules/item/itemErrors.js";
import { ItemMediaService } from "../../modules/item/ItemMediaService.js";
import { ITEM_MEDIA_UPLOAD_BODY_SCHEMA, MEDIA_SUMMARY_SCHEMA } from "../item-media/itemMediaSchemas.js";
import { EMPTY_OBJECT_SCHEMA, ITEM_MGMT_POLICY, SKU_ID_PARAMS_SCHEMA } from "./skuSchemas.js";

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
 * 上傳一個 SKU 專屬嘅 media。設計說明見 docs/items_management/design_spec.md
 * §6.6、§8.5。`item_id` 由 `ItemMediaService.attach()` 從目標 SKU 現在嘅
 * `item_id` 解析，不接受 client 自己提交——見同一份 §6.3 前言對「target 由
 * 伺服器解析、不信任 client 聲稱嘅 aggregate 關係」的一貫原則。
 */
export class SkuMediaUploadHandler extends BaseRequestHandler {
  static handlerName = "uploadSkuMedia";

  static api = {
    method: "POST",
    path: "/api/v1/skus/:id/media/upload",
    description: "上傳一個 SKU 專屬嘅 media 檔案。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    upload: {
      enabled: true,
      directory: itemConfig.mediaDirectory,
      maxFiles: 1,
      maxFileSizeBytes: Math.max(itemConfig.imageMaxBytes, itemConfig.attachmentMaxBytes),
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "application/pdf"]
    },
    requestSchema: {
      params: SKU_ID_PARAMS_SCHEMA,
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
      throw mediaFileRequired();
    }

    const [file] = req.files;
    const summary = await this.itemMedia.attach({
      ...actorContext(req),
      targetType: "sku",
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
