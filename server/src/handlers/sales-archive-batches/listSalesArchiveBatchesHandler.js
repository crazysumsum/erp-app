import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesArchiveInquiryService} from "../../modules/sales/SalesArchiveInquiryService.js";
import {EMPTY,SALES_ORDER_READ_POLICY,ARCHIVE_BATCH_LIST_RESPONSE} from "../archived-sales-orders/archivedSalesOrderSchemas.js";
import {salesExportListRequest} from "../sales-exports/salesExportSchemas.js";
export class ListSalesArchiveBatchesHandler extends BaseRequestHandler{
 static handlerName="listSalesArchiveBatches";static api={method:"GET",path:"/api/v1/sales-archive-batches",description:"讀取歸檔批次的安全總結與錯誤代碼",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:EMPTY,query:{},body:EMPTY},responseSchema:{200:ARCHIVE_BATCH_LIST_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new SalesArchiveInquiryService({database:services.require("mysqldatabase")});}
 async execute(req){return this.response(await this.inquiry.listBatches(salesExportListRequest(req)));}
}
