import { stringify } from "csv-stringify/sync";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesReportService } from "../../modules/sales/SalesReportService.js";
import { safeSalesCsvCell } from "../../modules/sales/salesCsv.js";
import { EMPTY, SALES_ORDER_READ_POLICY, salesActorClaims } from "../sales/salesSchemas.js";

const reportPath = "/api/v1/sales-reports/orders";
const csvColumns = [
  "orderDate", "orderNumber", "status", "customerCode", "customerName", "warehouseCode", "skuCode", "skuName",
  "salesUomCode", "quantity", "unitSellingPrice", "lineAmount", "currencyCode", "fulfilledBaseQuantity", "cancelledBaseQuantity"
];
const text = { type: "string" };
const date = { ...text, format: "date" };
const filterProperties = {
  dateFrom: date, dateTo: date, customerCode: { ...text, maxLength: 190 }, skuCode: { ...text, maxLength: 190 }
};
const rowsResponse = {
  type: "object",
  additionalProperties: false,
  required: ["items", "total"],
  properties: {
    items: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "orderId", ...csvColumns],
        properties: Object.fromEntries(["id", "orderId", ...csvColumns].map(key => [key, text]))
      }
    },
    total: { type: "integer", minimum: 0 }
  }
};

function reportApi({ path, description, pagination = {}, response, download }) {
  return {
    method: "GET",
    path,
    description,
    authorizationPolicies: [SALES_ORDER_READ_POLICY],
    ...(download && { download: { enabled: true } }),
    requestSchema: {
      params: EMPTY,
      query: {
        type: "object",
        additionalProperties: false,
        required: ["dateFrom", "dateTo"],
        properties: { ...filterProperties, ...pagination }
      }
    },
    responseSchema: { 200: response }
  };
}

class ReportHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.report = new SalesReportService({ database: services.require("mysqldatabase") });
  }

  reportRequest(req) {
    return { claims: salesActorClaims(req), query: req.input.query, signal: req.requestTimeout?.signal };
  }
}

export class ListSalesOrderReportHandler extends ReportHandler {
  static handlerName = "listSalesOrderReport";
  static api = reportApi({
    path: reportPath,
    description: "讀取已確認銷售訂單明細",
    pagination: {
      page: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      pageSize: { type: "integer", minimum: 1, maximum: 100 }
    },
    response: rowsResponse
  });

  async execute(req) {
    return this.response(await this.report.list(this.reportRequest(req)));
  }
}

export class ExportSalesOrderReportHandler extends ReportHandler {
  static handlerName = "exportSalesOrderReport";
  static api = reportApi({
    path: reportPath + "/csv",
    description: "匯出已確認銷售訂單明細 CSV",
    download: true,
    response: { type: "object", additionalProperties: true }
  });

  async execute(req) {
    const { dateFrom, dateTo } = req.input.query;
    const rows = await this.report.exportRows(this.reportRequest(req));
    const csv = stringify([csvColumns, ...rows.map(row => csvColumns.map(column => safeSalesCsvCell(row[column])))], {
      bom: true,
      record_delimiter: "\r\n"
    });
    return this.file({
      buffer: Buffer.from(csv, "utf8"),
      fileName: `sales-report-${dateFrom}-to-${dateTo}.csv`,
      contentType: "text/csv; charset=utf-8"
    });
  }
}
