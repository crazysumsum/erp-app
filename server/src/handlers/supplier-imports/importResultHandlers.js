import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierImportService } from "../../modules/supplier/SupplierImportService.js";
import { SUPPLIER_MGMT_POLICY } from "../suppliers/supplierSchemas.js";
import { SUPPLIER_IMPORT_EMPTY_SCHEMA, SUPPLIER_IMPORT_ID_PARAMS_SCHEMA } from "./importSchemas.js";

/**
 * 逐列結果下載（T46；設計 §6.9）。只限上載者，其他人 404（HD-058 1A）。檔案由 rows 即時生成，唔讀磁碟
 * （HD-063 1B），所以 HD-043 嘅檔案規則唔適用。路徑有兩段，唔會同 `GET /:id` 撞。
 */
export class DownloadSupplierImportResultHandler extends BaseRequestHandler {
  static handlerName = "downloadSupplierImportResult";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-imports/:id/result",
    description: "下載自己已執行的供應商匯入逐列結果 CSV（不含原始資料）。未執行完回 409；超過保留期限回 410，工作摘要仍可查閱。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    download: { enabled: true },
    requestSchema: { params: SUPPLIER_IMPORT_ID_PARAMS_SCHEMA, query: SUPPLIER_IMPORT_EMPTY_SCHEMA },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  constructor(services = {}) {
    super(services);
    this.imports = new SupplierImportService({
      database: services.require("mysqldatabase"), time: services.require("time"), logger: services.require("logging").logger
    });
  }

  async execute(req, res) {
    const { fileName, content } = await this.imports.resultCsv({
      actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions,
      id: req.input.params.id
    });
    // Cache-Control: private, no-store 由框架嘅 file response 寫（REV-073 I-1）；Pragma 俾 HTTP/1.0 cache。
    res.setHeader("Pragma", "no-cache");
    return this.file({ buffer: Buffer.from(content, "utf8"), fileName, contentType: "text/csv; charset=utf-8" });
  }
}
