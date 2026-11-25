import { stringify } from "csv-stringify/sync";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { assertActorFresh } from "../../modules/authorization/directoryLookups.js";
import { InventoryInquiryService } from "../../modules/inventory/InventoryInquiryService.js";
import { inventoryError } from "../../modules/inventory/inventoryErrors.js";
import { EMPTY, MOVEMENT_LIST_QUERY, STOCK_LIST_QUERY, VIEW_POLICY } from "./inventorySchemas.js";

function reportApi(path, description, schema) {
  const { page: _page, pageSize: _pageSize, ...properties } = schema.properties;
  return {
    method: "GET", path, description, authType: "jwt", authorizationPolicies: VIEW_POLICY,
    download: { enabled: true },
    requestSchema: { params: EMPTY, query: { ...schema, properties } },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };
}

const STOCK_COLUMNS = [
  "warehouseCode", "binCode", "skuCode", "skuName", "lotNumber", "expiryDate", "stockStatus",
  "baseUomCode", "onHand", "allocated", "bucketFree"
];
const MOVEMENT_COLUMNS = [
  "movementId", "postedAtUtc", "movementType", "locationKind", "warehouseCode", "binCode",
  "skuCode", "skuName", "lotNumber", "expiryDate", "stockStatus", "direction", "baseQuantity",
  "balanceBefore", "balanceAfter", "sourceModule", "sourceDocumentType", "sourceDocumentId", "sourceLineId"
];

function safeCell(value) {
  return typeof value === "string" && /^[\s']*[=+\-@\t\r\n＝＋－＠]/u.test(value) ? `'${value}` : value;
}

class InventoryReportHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryInquiryService({ database: services.require("mysqldatabase"), time: services.require("time") });
  }

  options(req) {
    const { sub, roles, permissions } = req.auth.claims;
    return {
      signal: req.requestTimeout?.signal,
      authorize: async (tx) => {
        const actor = await assertActorFresh(tx, { actorId: Number(sub), claimedRoles: roles, claimedPermissions: permissions });
        if (!actor.username || !actor.permissions.includes("inventory.view")) throw inventoryError("PERMISSION_STALE");
      }
    };
  }

  report(rows, columns, fileName) {
    const csv = stringify(rows.map(row => row.map(safeCell)), {
      columns, header: true, bom: true, record_delimiter: "windows"
    });
    return this.file({ buffer: Buffer.from(csv, "utf8"), fileName, contentType: "text/csv; charset=utf-8" });
  }
}

export class ExportInventoryStocksHandler extends InventoryReportHandler {
  static handlerName = "exportInventoryStocks";
  static api = reportApi("/api/v1/inventory/reports/stocks", "匯出已篩選的庫存結存數量。", STOCK_LIST_QUERY);

  async execute(req) {
    const rows = await this.inventory.readStockReport(req.input.query, this.options(req));
    return this.report(rows.map(row => [
      row.warehouse.code, row.bin.code, row.sku.code, row.sku.name, row.lot?.number, row.lot?.expiryDate,
      row.stockStatus, row.baseUom.uomCode, row.onHand, row.allocated, row.bucketFree
    ]), STOCK_COLUMNS, "inventory-stocks.csv");
  }
}

export class ExportInventoryMovementsHandler extends InventoryReportHandler {
  static handlerName = "exportInventoryMovements";
  static api = reportApi("/api/v1/inventory/reports/movements", "匯出已篩選的庫存異動明細。", MOVEMENT_LIST_QUERY);

  async execute(req) {
    const rows = await this.inventory.readMovementReport(req.input.query, this.options(req));
    return this.report(rows.map(row => [
      row.movementId, new Date(row.postedAt).toISOString(), row.movementType, row.locationKind,
      row.warehouse.code, row.bin?.code, row.sku.code, row.sku.name, row.lot?.number, row.lot?.expiryDate,
      row.stockStatus, row.direction, row.quantity, row.balanceBefore, row.balanceAfter, row.source.module,
      row.source.documentType, row.source.documentId, row.source.lineId
    ]), MOVEMENT_COLUMNS, "inventory-movements.csv");
  }
}
