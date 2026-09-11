import itemConfig from "../../../config/item.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import { EMPTY_OBJECT_SCHEMA, IMPORT_ID_PARAMS_SCHEMA, ITEM_MGMT_POLICY } from "./itemImportSchemas.js";

/**
 * 下載結果 CSV。設計說明見 docs/items_management/design_spec.md §6.9、
 * §6.11。檔案已經按 1 年保留期限被清理就回 `410 IMPORT_FILE_EXPIRED`，但
 * Job summary 本身仍然查得到（`resolveResultDownload()` 唔會刪 job 記錄，
 * 只係檔案本身唔喺度）。
 */
export class DownloadItemImportResultHandler extends BaseRequestHandler {
  static handlerName = "downloadItemImportResult";

  static api = {
    method: "GET",
    path: "/api/v1/item-imports/:id/result",
    description: "下載匯入工作嘅結果 CSV。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    download: { enabled: true, root: itemConfig.importDirectory },
    requestSchema: {
      params: IMPORT_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  constructor(services = {}) {
    super(services);
    this.importService = new ItemImportService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const id = Number(req.input.params.id);
    const { storedName } = await this.importService.resolveResultDownload({ id });

    return this.file({
      path: storedName,
      fileName: `item-import-${id}-result.csv`,
      contentType: "text/csv; charset=utf-8"
    });
  }
}
