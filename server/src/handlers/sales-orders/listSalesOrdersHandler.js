import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesInquiryService } from "../../modules/sales/SalesInquiryService.js";
import { EMPTY, SALES_ORDER_LIST_RESPONSE, SALES_ORDER_READ_POLICY, salesOrderListRequest } from "../sales/salesSchemas.js";
export class ListSalesOrdersHandler extends BaseRequestHandler{
 static handlerName="listSalesOrders";
 static api={method:"GET",path:"/api/v1/sales-orders",description:"List Active Sales Orders",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:EMPTY,query:{},body:EMPTY},responseSchema:{200:SALES_ORDER_LIST_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new SalesInquiryService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response(await this.inquiry.list(salesOrderListRequest(req)));}
}
