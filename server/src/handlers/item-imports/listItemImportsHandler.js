import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  IMPORT_JOB_LIST_RESPONSE_SCHEMA,
  ITEM_IMPORT_LIST_QUERY_SCHEMA,
  ITEM_MGMT_POLICY
} from "./itemImportSchemas.js";

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

/** 查所有 Import Job；分頁及狀態篩選。設計說明見
 * docs/items_management/design_spec.md §6.9。 */
export class ListItemImportsHandler extends BaseRequestHandler {
  static handlerName = "listItemImports";

  static api = {
    method: "GET",
    path: "/api/v1/item-imports",
    description: "查所有匯入工作，可按狀態篩選。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: ITEM_IMPORT_LIST_QUERY_SCHEMA
    },
    responseSchema: { 200: IMPORT_JOB_LIST_RESPONSE_SCHEMA }
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
    const result = await this.importService.listJobs({
      ...actorContext(req),
      page: req.input.query.page,
      pageSize: req.input.query.pageSize,
      status: req.input.query.status
    });

    return this.response(result);
  }
}
