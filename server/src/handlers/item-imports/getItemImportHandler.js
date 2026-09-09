import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { importJobNotFound } from "../../modules/item/itemErrors.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import {
  IMPORT_ID_PARAMS_SCHEMA,
  IMPORT_JOB_DETAIL_RESPONSE_SCHEMA,
  ITEM_IMPORT_GET_QUERY_SCHEMA,
  ITEM_MGMT_POLICY
} from "./itemImportSchemas.js";

/** Job 摘要及 row errors 分頁。設計說明見
 * docs/items_management/design_spec.md §6.9。 */
export class GetItemImportHandler extends BaseRequestHandler {
  static handlerName = "getItemImport";

  static api = {
    method: "GET",
    path: "/api/v1/item-imports/:id",
    description: "查一個匯入工作嘅摘要同逐列結果（分頁）。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: IMPORT_ID_PARAMS_SCHEMA,
      query: ITEM_IMPORT_GET_QUERY_SCHEMA
    },
    responseSchema: { 200: IMPORT_JOB_DETAIL_RESPONSE_SCHEMA }
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
    const job = await this.importService.getJob({ id });

    if (!job) {
      throw importJobNotFound(id);
    }

    const rows = await this.importService.listRows({
      jobId: id,
      page: req.input.query.page,
      pageSize: req.input.query.pageSize,
      status: req.input.query.rowStatus
    });

    return this.response({ job, rows });
  }
}
