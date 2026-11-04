import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesInquiryService} from "../../modules/sales/SalesInquiryService.js";
import {EMPTY,SALES_ORDER_READ_POLICY,SALES_AUDIT_LIST_QUERY,SALES_AUDIT_LIST_RESPONSE,salesActorClaims} from "../sales/salesSchemas.js";
export class ListSalesAuditLogsHandler extends BaseRequestHandler {
 static handlerName="listSalesAuditLogs";
 static api={method:"GET",path:"/api/v1/sales-audit-logs",description:"Read Sales Audit events",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:EMPTY,query:SALES_AUDIT_LIST_QUERY,body:EMPTY},responseSchema:{200:SALES_AUDIT_LIST_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new SalesInquiryService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response(await this.inquiry.listAudit({claims:salesActorClaims(req),input:req.input.query}));}
}
