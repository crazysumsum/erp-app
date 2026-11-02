import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesArchiveInquiryService} from "../../modules/sales/SalesArchiveInquiryService.js";
import {EMPTY,SALES_ORDER_READ_POLICY,SALES_ORDER_ID_PARAMS,ARCHIVE_LIST_RESPONSE,ARCHIVE_READ_RESPONSE,SALES_AUDIT_LIST_RESPONSE,salesActorClaims,salesOrderListRequest,archiveAuditRequest} from "./archivedSalesOrderSchemas.js";
class ArchiveHandler extends BaseRequestHandler{constructor(services={}){super(services);this.inquiry=new SalesArchiveInquiryService({database:services.require("mysqldatabase")});}}
export class ListArchivedSalesOrdersHandler extends ArchiveHandler{
 static handlerName="listArchivedSalesOrders";static api={method:"GET",path:"/api/v1/archived-sales-orders",description:"查詢有界的歷史銷售訂單",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:EMPTY,query:{},body:EMPTY},responseSchema:{200:ARCHIVE_LIST_RESPONSE}};
 async execute(req){return this.response(await this.inquiry.list(salesOrderListRequest(req)));}
}
export class GetArchivedSalesOrderHandler extends ArchiveHandler{
 static handlerName="getArchivedSalesOrder";static api={method:"GET",path:"/api/v1/archived-sales-orders/:id",description:"讀取唯讀歷史銷售訂單快照",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:SALES_ORDER_ID_PARAMS,query:EMPTY,body:EMPTY},responseSchema:{200:ARCHIVE_READ_RESPONSE}};
 async execute(req){return this.response(await this.inquiry.get({claims:salesActorClaims(req),id:Number(req.input.params.id)}));}
}
export class ListArchivedSalesOrderAuditHandler extends ArchiveHandler{
 static handlerName="listArchivedSalesOrderAudit";static api={method:"GET",path:"/api/v1/archived-sales-orders/:id/audit",description:"讀取單一歷史銷售訂單的安全稽核記錄",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:SALES_ORDER_ID_PARAMS,query:{},body:EMPTY},responseSchema:{200:SALES_AUDIT_LIST_RESPONSE}};
 async execute(req){return this.response(await this.inquiry.listAudit(archiveAuditRequest(req)));}
}
