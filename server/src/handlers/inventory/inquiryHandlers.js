import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryInquiryService } from "../../modules/inventory/InventoryInquiryService.js";
import {
  EMPTY,
  EXPIRY_LIST_QUERY,
  LOT_LIST_QUERY,
  LOT_LIST_RESPONSE,
  MOVEMENT_DETAIL_RESPONSE,
  MOVEMENT_ID_PARAMS,
  MOVEMENT_LIST_QUERY,
  MOVEMENT_LIST_RESPONSE,
  OPERATION_SOURCE_QUERY,
  OPERATION_SOURCE_RESPONSE,
  STOCK_DETAIL_RESPONSE,
  STOCK_ID_PARAMS,
  STOCK_LIST_QUERY,
  STOCK_LIST_RESPONSE,
  STOCK_SUMMARY_QUERY,
  STOCK_SUMMARY_RESPONSE,
  VIEW_POLICY
} from "./inventorySchemas.js";

class InquiryHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryInquiryService({
      database: services.require("mysqldatabase"),
      time: services.require("time")
    });
  }
}

function readApi(path, description, params, query, response) {
  return {
    method: "GET",
    path,
    description,
    authorizationPolicies: VIEW_POLICY,
    requestSchema: { params, query },
    responseSchema: { 200: response }
  };
}

export class ListInventoryStocksHandler extends InquiryHandler {
  static handlerName = "listInventoryStocks";
  static api = readApi(
    "/api/v1/inventory/stocks",
    "分頁查詢即時庫存 bucket。",
    EMPTY,
    STOCK_LIST_QUERY,
    STOCK_LIST_RESPONSE
  );
  async execute(req) { return this.response(await this.inventory.listStocks(req.input.query)); }
}

// Aggregate sorts before the parameter route in automatic handler discovery, so /summary
// cannot be consumed by /:balanceId.
export class GetInventoryStockAggregateHandler extends InquiryHandler {
  static handlerName = "getInventoryStockSummary";
  static api = readApi(
    "/api/v1/inventory/stocks/summary",
    "取得指定 SKU 的即時庫存與 ATP 摘要。",
    EMPTY,
    STOCK_SUMMARY_QUERY,
    STOCK_SUMMARY_RESPONSE
  );
  async execute(req) { return this.response(await this.inventory.getStockSummary(req.input.query)); }
}

export class GetInventoryStockHandler extends InquiryHandler {
  static handlerName = "getInventoryStock";
  static api = readApi(
    "/api/v1/inventory/stocks/:balanceId",
    "取得庫存 bucket、分配摘要及最近異動。",
    STOCK_ID_PARAMS,
    EMPTY,
    STOCK_DETAIL_RESPONSE
  );
  async execute(req) { return this.response(await this.inventory.getStock(req.input.params.balanceId)); }
}

export class ListInventoryLotsHandler extends InquiryHandler {
  static handlerName = "listInventoryLots";
  static api = readApi(
    "/api/v1/inventory/lots",
    "分頁查詢批次、效期及即時狀態數量。",
    EMPTY,
    LOT_LIST_QUERY,
    LOT_LIST_RESPONSE
  );
  async execute(req) { return this.response(await this.inventory.listLots(req.input.query)); }
}

export class ListInventoryMovementsHandler extends InquiryHandler {
  static handlerName = "listInventoryMovements";
  static api = readApi(
    "/api/v1/inventory/movements",
    "按固定時間順序分頁查詢不可變庫存異動。",
    EMPTY,
    MOVEMENT_LIST_QUERY,
    MOVEMENT_LIST_RESPONSE
  );
  async execute(req) { return this.response(await this.inventory.listMovements(req.input.query)); }
}

export class GetInventoryMovementHandler extends InquiryHandler {
  static handlerName = "getInventoryMovement";
  static api = readApi(
    "/api/v1/inventory/movements/:id",
    "取得異動、同組 legs、來源及沖銷關聯。",
    MOVEMENT_ID_PARAMS,
    EMPTY,
    MOVEMENT_DETAIL_RESPONSE
  );
  async execute(req) { return this.response(await this.inventory.getMovement(req.input.params.id)); }
}

export class GetInventoryOperationBySourceHandler extends InquiryHandler {
  static handlerName = "getInventoryOperationBySource";
  static api = readApi(
    "/api/v1/inventory/operations/by-source",
    "以完整來源 tuple 精確查詢已完成庫存操作。",
    EMPTY,
    OPERATION_SOURCE_QUERY,
    OPERATION_SOURCE_RESPONSE
  );
  async execute(req) {
    const query = req.input.query;
    return this.response(await this.inventory.findOperationBySource({
      source: {
        module: query.sourceModule,
        documentType: query.sourceDocumentType,
        documentId: query.sourceDocumentId,
        lineId: query.sourceLineId,
        eventId: query.sourceEventId
      }
    }));
  }
}

export class ListInventoryExpiryHandler extends InquiryHandler {
  static handlerName = "listInventoryExpiry";
  static api = readApi(
    "/api/v1/inventory/expiry",
    "分頁查詢已過期或指定日數內到期的批次。",
    EMPTY,
    EXPIRY_LIST_QUERY,
    LOT_LIST_RESPONSE
  );
  async execute(req) { return this.response(await this.inventory.listExpiry(req.input.query)); }
}
