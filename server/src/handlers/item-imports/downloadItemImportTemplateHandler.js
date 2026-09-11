import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { IMPORT_TEMPLATE_VERSION, buildImportTemplateHeaderRow } from "../../modules/item/import/itemCsvSchema.js";
import { EMPTY_OBJECT_SCHEMA, ITEM_MGMT_POLICY } from "./itemImportSchemas.js";

/**
 * 下載帶 version 的 UTF-8 CSV template。設計說明見
 * docs/items_management/design_spec.md §6.9。
 *
 * 檔名刻意用 `download...` 開頭（同 downloadItemImportResultHandler.js 一致）：
 * handlerRegistry.js 按檔案路徑字母順序註冊 route，Express Router 冇靜態路徑
 * 優先於 `:id` 呢種機制，所以呢個 GET /template 一定要喺 getItemImportHandler.js
 * 嘅 GET /:id 之前註冊，否則 "/template" 會被當做 id="template" 咁 match 咗，
 * 令呢個 route 永遠去唔到（400 params 驗證錯）。
 */
export class DownloadItemImportTemplateHandler extends BaseRequestHandler {
  static handlerName = "downloadItemImportTemplate";

  static api = {
    method: "GET",
    path: "/api/v1/item-imports/template",
    description: "下載帶 version 的商品匯入 CSV template。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    download: { enabled: true },
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  async execute() {
    return this.file({
      buffer: Buffer.from(buildImportTemplateHeaderRow(), "utf8"),
      fileName: `item-import-template-${IMPORT_TEMPLATE_VERSION}.csv`,
      contentType: "text/csv; charset=utf-8"
    });
  }
}
