import itemConfig from "../../../config/item.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemMediaService } from "../../modules/item/ItemMediaService.js";
import { EMPTY_OBJECT_SCHEMA } from "../items/itemSchemas.js";
import { ITEM_VIEW_POLICY, MEDIA_ID_PARAMS_SCHEMA } from "./itemMediaSchemas.js";

/**
 * 下載／預覽 media 檔案。設計說明見 docs/items_management/design_spec.md
 * §6.6、§8.5。
 *
 * `this.file({ path, root })` 只接受相對於 `download.root` 的路徑，root
 * 由 route 設定死（`itemConfig.mediaDirectory`），handler 不能自己組別的
 * 目錄——`stored_name` 不含路徑分隔符已經在 `resolveDownload()` 核過。
 *
 * `sendFileResponse()`（見 src/framework/http/fileResponse.js）一律回
 * `Content-Disposition: attachment`，這裡沒有另外做「圖片 inline」分支：
 * `<img>` 標籤載入子資源時瀏覽器本來就不理會 Content-Disposition（那個
 * header 只影響使用者直接導覽／另存的情況），圖片一樣會正常內嵌顯示，不需要
 * 框架另外支援 inline 分支。PDF 維持 attachment 正是 design_spec 要求的
 * 行為，不需要額外處理。`X-Content-Type-Options: nosniff` 由全域 helmet()
 * 中介層套用（見 src/framework/application/createApplication.js），這裡
 * 不需要重複設定。
 */
export class DownloadItemMediaHandler extends BaseRequestHandler {
  static handlerName = "downloadItemMedia";

  static api = {
    method: "GET",
    path: "/api/v1/item-media/:id/download",
    description: "下載或預覽一個 Item／SKU media 檔案。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    download: { enabled: true, root: itemConfig.mediaDirectory },
    requestSchema: {
      params: MEDIA_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
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
    const media = await this.itemMedia.resolveDownload({ id });

    return this.file({
      path: media.storedName,
      fileName: media.originalName,
      contentType: media.mimeType
    });
  }
}
