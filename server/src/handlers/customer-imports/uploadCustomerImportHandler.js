import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CUSTOMER_IMPORT_TEMPLATE_VERSION } from "../../modules/customer/import/customerCsvSchema.js";
import { customerImportError } from "../../modules/customer/customerErrors.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_IMPORT_EMPTY, CUSTOMER_IMPORT_JOB, CUSTOMER_IMPORT_UPLOAD_BODY } from "./customerImportSchemas.js";
import { customerImportActor, customerImportService, requireCustomerImport } from "./customerImportSupport.js";

export class UploadCustomerImportHandler extends BaseRequestHandler {
  static handlerName = "uploadCustomerImport";
  static api = {
    method: "POST", path: "/api/v1/customer-imports/upload", description: "上傳 Customer CSV 並建立非同步預檢工作。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: { enabled: true },
    upload: {
      enabled: true, memoryOnly: true, maxFiles: 1, maxFileSizeBytes: 20 * 1024 * 1024,
      maxTotalFileBytes: 20 * 1024 * 1024, maxRequestBytes: 21 * 1024 * 1024,
      maxFieldCount: 4, allowedMimeTypes: ["text/csv"]
    },
    requestSchema: { params: CUSTOMER_IMPORT_EMPTY, query: CUSTOMER_IMPORT_EMPTY, body: CUSTOMER_IMPORT_UPLOAD_BODY },
    responseSchema: { 201: CUSTOMER_IMPORT_JOB }
  };
  constructor(services = {}) { super(services); this.customerImport = customerImportService(services); }
  async execute(req) {
    const file = req.files?.[0];
    if (!file || req.files.length !== 1) throw customerImportError("CUSTOMER_IMPORT_FILE_REQUIRED", 422, "請選擇一個 CSV 檔案");
    try {
      return this.response(await requireCustomerImport(this.customerImport).createFromUpload({
        ...customerImportActor(req), idempotencyKey: req.get("idempotency-key"),
        templateVersion: CUSTOMER_IMPORT_TEMPLATE_VERSION, mode: req.input.body.mode,
        fileSha256: file.contentHash, content: file.buffer,
        requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
      }), { statusCode: 201 });
    } finally {
      file.buffer.fill(0); req.files = Object.freeze([]);
    }
  }
}
