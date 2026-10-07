import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesInquiryService } from "../../modules/sales/SalesInquiryService.js";
import { EMPTY, SALES_ORDER_ID_PARAMS, SALES_ORDER_READ_POLICY, SALES_ORDER_READ_RESPONSE, salesActorClaims } from "../sales/salesSchemas.js";
export class GetSalesOrderHandler extends BaseRequestHandler{
 static handlerName="getSalesOrder";
 static api={method:"GET",path:"/api/v1/sales-orders/:id",description:"Read an Active Sales Order",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:SALES_ORDER_ID_PARAMS,query:EMPTY,body:EMPTY},responseSchema:{200:SALES_ORDER_READ_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new SalesInquiryService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response(await this.inquiry.get({claims:salesActorClaims(req),id:Number(req.input.params.id)}));}
}
