import itemConfig from "../../../config/item.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { uploadFileRequired } from "../../modules/item/itemErrors.js";
import { IMPORT_TEMPLATE_VERSION } from "../../modules/item/import/itemCsvSchema.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  IMPORT_JOB_SUMMARY_SCHEMA,
  ITEM_IMPORT_UPLOAD_BODY_SCHEMA,
  ITEM_MGMT_POLICY
} from "./itemImportSchemas.js";

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

/**
 * 上傳一份 CSV，建立一個 `uploaded` 狀態嘅 Import Job。設計說明見
 * docs/items_management/design_spec.md §6.9。真正嘅 parse／validate 由
 * `itemImport.validate` 呢個背景 job（T28）非同步處理，呢個 handler 淨係
 * 負責落盤同建 job row。
 *
 * `idempotency: { enabled: true }`：同一個 Idempotency-Key 重送唔會建多一個
 * job，理由同 `createItem()` 一致（design_spec §6.9）。
 */
export class UploadItemImportHandler extends BaseRequestHandler {
  static handlerName = "uploadItemImport";

  static api = {
    method: "POST",
    path: "/api/v1/item-imports/upload",
    description: "上傳一份 CSV，建立一個匯入工作。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    idempotency: { enabled: true },
    upload: {
      enabled: true,
      directory: itemConfig.importDirectory,
      maxFiles: 1,
      // 10,000 行嘅 CSV 本身唔會逼近呢個上限（一行大約幾百 bytes），呢個係
      // 對「上傳咗一個明顯過大檔案」嘅粗防線；真正嘅列數上限
      // （config.item.importMaxRows）由 ItemImportProcessor.js 喺解析階段
      // 檢查。要連 `maxTotalFileBytes` 一齊明確設，唔可以淨係靠
      // `maxFiles × maxFileSizeBytes` 嘅預設推算——normalizeUploadConfig()
      // 係逐個 route 個別 merge，冧咗嗰個推算會攞返 config/api.js 嘅預設
      // 10MB，同呢度想要嘅 20MB 對唔上，啟動時會直接拒絕。
      maxFileSizeBytes: 20_000_000,
      maxTotalFileBytes: 20_000_000,
      maxRequestBytes: 20_100_000,
      allowedMimeTypes: ["text/csv"]
    },
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_IMPORT_UPLOAD_BODY_SCHEMA
    },
    responseSchema: { 201: IMPORT_JOB_SUMMARY_SCHEMA }
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
    if (!Array.isArray(req.files) || req.files.length !== 1) {
      throw uploadFileRequired();
    }

    const [file] = req.files;
    const job = await this.importService.createJobFromUpload({
      ...actorContext(req),
      fileStoredName: file.storedName,
      // Upload middleware 落盤之前已經計過 sha256（見
      // src/framework/upload/uploadMiddleware.js），唔使自己再讀一次檔案。
      fileSha256: file.contentHash,
      templateVersion: IMPORT_TEMPLATE_VERSION,
      mode: req.input.body.mode
    });

    return this.response(job, { statusCode: 201 });
  }
}
