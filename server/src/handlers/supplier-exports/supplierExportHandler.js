import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { SupplierExportService } from "../../modules/supplier/SupplierExportService.js";
import { EMPTY_SUPPLIER_SCHEMA, SUPPLIER_LIST_QUERY_SCHEMA, SUPPLIER_MGMT_POLICY } from "../suppliers/supplierSchemas.js";

// 同列表一樣嘅篩選同排序，唔要分頁。
const FILTER_PROPERTIES = Object.fromEntries(
  Object.entries(SUPPLIER_LIST_QUERY_SCHEMA.properties).filter(([name]) => name !== "page" && name !== "pageSize"));

// jwt-password：body 一定要宣告 password（設計 §6.1），框架驗完就唔會再傳落 service。
export const SUPPLIER_EXPORT_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["password"],
  additionalProperties: false,
  properties: {
    password: { type: "string", minLength: 1, maxLength: 1024 },
    filters: { type: "object", additionalProperties: false, properties: FILTER_PROPERTIES, default: {} }
  }
});

/**
 * 一般供應商匯出（T47）。設計 §6.9 寫 GET，但密碼要喺 body 讀，瀏覽器嘅 GET 送唔到 body，所以用 POST（HD-067 1A）。
 * 回應就係 CSV；匯出唔改任何資料，所以唔使 Idempotency-Key。
 */
export class ExportSuppliersHandler extends BaseRequestHandler {
  static handlerName = "exportSuppliers";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-exports",
    authType: "jwt-password",
    description: "按列表篩選匯出一般供應商資料 CSV（匯入範本 v1 欄位，永不包含銀行資料）；最多 10,000 列。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    download: { enabled: true },
    requestSchema: { params: EMPTY_SUPPLIER_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA, body: SUPPLIER_EXPORT_BODY_SCHEMA },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  constructor(services = {}) {
    super(services);
    const database = services.require("mysqldatabase");
    this.exports = new SupplierExportService({
      database, time: services.require("time"), logger: services.require("logging").logger,
      businessMaster: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() })
    });
  }

  async execute(req, res) {
    const { fileName, content } = await this.exports.exportCsv({
      actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions,
      filters: req.input.body.filters, requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    });
    // Cache-Control: private, no-store 由框架嘅 file response 寫；Pragma 俾 HTTP/1.0 cache。
    res.setHeader("Pragma", "no-cache");
    return this.file({ buffer: Buffer.from(content, "utf8"), fileName, contentType: "text/csv; charset=utf-8" });
  }
}
