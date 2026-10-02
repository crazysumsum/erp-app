import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierImportService } from "../../modules/supplier/SupplierImportService.js";
import { SUPPLIER_MGMT_POLICY } from "../suppliers/supplierSchemas.js";
import {
  SUPPLIER_IMPORT_CANCEL_BODY_SCHEMA, SUPPLIER_IMPORT_CONFIRM_BODY_SCHEMA, SUPPLIER_IMPORT_DETAIL_RESPONSE_SCHEMA, SUPPLIER_IMPORT_EMPTY_SCHEMA,
  SUPPLIER_IMPORT_GET_QUERY_SCHEMA, SUPPLIER_IMPORT_ID_PARAMS_SCHEMA, SUPPLIER_IMPORT_JOB_SCHEMA,
  SUPPLIER_IMPORT_LIST_QUERY_SCHEMA, SUPPLIER_IMPORT_LIST_RESPONSE_SCHEMA
} from "./importSchemas.js";

/**
 * Supplier import job 查詢、取消（T44）同確認（T45；設計 §6.9）。每個 job 只有上載者睇到、取消到同確認到，
 * 其他人一律 404（HD-058 1A、HD-060 1A）。檔案下載同 410 係 T46 嘅（HD-058 4A）。
 *
 * 檔名要排喺 `importTemplateUploadHandlers.js` 後面：handler 按檔名次序註冊，Express 5 冇得限制
 * `:id` 嘅格式，排前咗 `GET /:id` 會食咗 `GET /template`（變 400）。整合測試嘅 template 下載會捉到。
 */
function importService(services) {
  return new SupplierImportService({
    database: services.require("mysqldatabase"), time: services.require("time"), logger: services.require("logging").logger
  });
}

function actor(req) {
  return { actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions };
}

export class ListSupplierImportsHandler extends BaseRequestHandler {
  static handlerName = "listSupplierImports";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-imports",
    description: "列出自己上載的供應商匯入工作（新的先），可按狀態篩選。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: SUPPLIER_IMPORT_EMPTY_SCHEMA, query: SUPPLIER_IMPORT_LIST_QUERY_SCHEMA },
    responseSchema: { 200: SUPPLIER_IMPORT_LIST_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.imports = importService(services);
  }

  async execute(req) {
    return this.response(await this.imports.list({ ...actor(req), ...req.input.query }));
  }
}

export class GetSupplierImportHandler extends BaseRequestHandler {
  static handlerName = "getSupplierImport";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-imports/:id",
    description: "取得自己的供應商匯入工作摘要及逐列預檢／執行結果（按行號分頁）。預檢完成前不回任何列；"
      + "預檢最多嘗試三次，期間服務中斷較長時工作會以 SUPPLIER_IMPORT_PRECHECK_FAILED 失敗，須重新上載。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: SUPPLIER_IMPORT_ID_PARAMS_SCHEMA, query: SUPPLIER_IMPORT_GET_QUERY_SCHEMA },
    responseSchema: { 200: SUPPLIER_IMPORT_DETAIL_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.imports = importService(services);
  }

  async execute(req) {
    return this.response(await this.imports.get({ ...actor(req), id: req.input.params.id, ...req.input.query }));
  }
}

export class CancelSupplierImportHandler extends BaseRequestHandler {
  static handlerName = "cancelSupplierImport";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-imports/:id/cancel",
    description: "取消自己尚未預檢或執行的供應商匯入工作（uploaded、ready、ready_with_errors、queued）；"
      + "來源檔即時刪除，摘要及逐列結果保留。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    idempotency: { enabled: true },
    requestSchema: { params: SUPPLIER_IMPORT_ID_PARAMS_SCHEMA, query: SUPPLIER_IMPORT_EMPTY_SCHEMA, body: SUPPLIER_IMPORT_CANCEL_BODY_SCHEMA },
    responseSchema: { 200: SUPPLIER_IMPORT_JOB_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    // 同 upload 一樣每次請求先攞：冇 worker 或者未設定 root 就係 null，service 照取消，檔留俾 T48。
    this.importRoot = () => services.get?.("job.supplierImportWorker")?.preparedRoot ?? null;
    this.imports = importService(services);
  }

  async execute(req) {
    return this.response(await this.imports.cancel({
      ...actor(req), id: req.input.params.id, version: req.input.body.version, root: this.importRoot(),
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    }));
  }
}

export class ConfirmSupplierImportHandler extends BaseRequestHandler {
  static handlerName = "confirmSupplierImport";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-imports/:id/confirm",
    description: "確認自己已完成預檢的供應商匯入（需要密碼）：選擇草稿或啟用；啟用而設定要求審批時須指定另一位有審批權限的使用者。"
      + "確認後背景逐列寫入，合法列寫入、錯誤列略過；已寫入的列不會因其他列失敗而回滾。",
    authType: "jwt-password",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    idempotency: { enabled: true },
    requestSchema: { params: SUPPLIER_IMPORT_ID_PARAMS_SCHEMA, query: SUPPLIER_IMPORT_EMPTY_SCHEMA, body: SUPPLIER_IMPORT_CONFIRM_BODY_SCHEMA },
    responseSchema: { 200: SUPPLIER_IMPORT_JOB_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.imports = importService(services);
  }

  async execute(req) {
    const { version, activationMode, approverUserId = null } = req.input.body;
    return this.response(await this.imports.confirm({
      ...actor(req), id: req.input.params.id, version, activationMode, approverUserId,
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    }));
  }
}
