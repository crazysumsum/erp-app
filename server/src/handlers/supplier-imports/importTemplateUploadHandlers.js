import supplierConfig from "../../../config/supplier.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { buildSupplierImportTemplate, SUPPLIER_IMPORT_TEMPLATE_VERSION } from "../../modules/supplier/import/supplierCsvSchema.js";
import { invalidSupplierInput } from "../../modules/supplier/supplierErrors.js";
import { SupplierImportService } from "../../modules/supplier/SupplierImportService.js";
import { SUPPLIER_MGMT_POLICY } from "../suppliers/supplierSchemas.js";
import { SUPPLIER_IMPORT_EMPTY_SCHEMA, SUPPLIER_IMPORT_JOB_SCHEMA, SUPPLIER_IMPORT_UPLOAD_BODY_SCHEMA } from "./importSchemas.js";

/**
 * Supplier CSV template 下載同上載（T43；設計 §6.9）。上載只建立 job，precheck 由
 * `job.supplierImportWorker` 喺背景做。未設定 import root（HD-050）上載回 503。
 */
export class DownloadSupplierImportTemplateHandler extends BaseRequestHandler {
  static handlerName = "downloadSupplierImportTemplate";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-imports/template",
    description: "下載供應商匯入 CSV 範本 v1；範本不含任何銀行欄位。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    download: { enabled: true },
    requestSchema: { params: SUPPLIER_IMPORT_EMPTY_SCHEMA, query: SUPPLIER_IMPORT_EMPTY_SCHEMA },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  async execute(_req, res) {
    res.setHeader("X-Supplier-Import-Template-Version", SUPPLIER_IMPORT_TEMPLATE_VERSION);
    return this.file({
      buffer: Buffer.from(buildSupplierImportTemplate(), "utf8"),
      fileName: `supplier-import-template-${SUPPLIER_IMPORT_TEMPLATE_VERSION}.csv`,
      contentType: "text/csv; charset=utf-8"
    });
  }
}

export class UploadSupplierImportHandler extends BaseRequestHandler {
  static handlerName = "uploadSupplierImport";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-imports/upload",
    description: "上載供應商 CSV，建立匯入工作並在背景預檢；預檢不寫入供應商資料。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    idempotency: { enabled: true },
    upload: {
      // 只留喺記憶體：唔經框架嘅暫存目錄，檔案只會由 service 寫入 import root。
      enabled: true, memoryOnly: true, maxFiles: 1,
      maxFileSizeBytes: supplierConfig.import.maxFileBytes, maxTotalFileBytes: supplierConfig.import.maxFileBytes,
      maxFieldCount: 4, allowedMimeTypes: ["text/csv"]
    },
    requestSchema: { params: SUPPLIER_IMPORT_EMPTY_SCHEMA, query: SUPPLIER_IMPORT_EMPTY_SCHEMA, body: SUPPLIER_IMPORT_UPLOAD_BODY_SCHEMA },
    responseSchema: { 201: SUPPLIER_IMPORT_JOB_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    // 每次請求先攞：worker 係 eager job service，停用 job 嘅環境（同部分測試）根本冇佢，冇就當未部署。
    this.importRoot = () => services.get?.("job.supplierImportWorker")?.preparedRoot ?? null;
    this.config = services.config.supplier.import;
    this.imports = new SupplierImportService({
      database: services.require("mysqldatabase"), time: services.require("time"), logger: services.require("logging").logger
    });
  }

  async execute(req) {
    const file = req.files?.[0];
    try {
      if (!file || req.files.length !== 1) throw invalidSupplierInput("SUPPLIER_IMPORT_FILE_REQUIRED", "請選擇一個非空白的 CSV 檔案");
      return this.response(await this.imports.createFromUpload({
        actorId: Number(req.auth.claims.sub),
        claimedRoles: req.auth.claims.roles,
        claimedPermissions: req.auth.claims.permissions,
        root: this.importRoot(),
        mode: req.input.body.mode,
        content: file.buffer,
        maxFileBytes: this.config.maxFileBytes,
        requestId: req.requestId,
        ip: req.ip || req.socket?.remoteAddress || ""
      }), { statusCode: 201 });
    } finally {
      file?.buffer?.fill(0);
    }
  }
}
