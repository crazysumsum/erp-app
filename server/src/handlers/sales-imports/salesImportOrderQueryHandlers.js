import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesImportQueryService} from "../../modules/sales/SalesImportQueryService.js";
import {EMPTY,SALES_IMPORT_READ_POLICY,SALES_IMPORT_ID_PARAMS,SALES_IMPORT_ERROR_PARAMS,SALES_IMPORT_ORDERS_RESPONSE,SALES_IMPORT_ERRORS_RESPONSE,salesImportQueryRequest} from "./salesImportSchemas.js";
export class ListSalesImportOrdersHandler extends BaseRequestHandler {
 static handlerName="listSalesImportOrders";
 static api={method:"GET",path:"/api/v1/sales-imports/:id/orders",description:"查詢匯入來源訂單",authorizationPolicies:[SALES_IMPORT_READ_POLICY],requestSchema:{params:SALES_IMPORT_ID_PARAMS,query:{},body:EMPTY},responseSchema:{200:SALES_IMPORT_ORDERS_RESPONSE}};
 constructor(services={}){super(services);this.imports=new SalesImportQueryService({database:services.require("mysqldatabase")});}
 async execute(req){return this.response(await this.imports.orders({...salesImportQueryRequest(req,"orders"),id:Number(req.input.params.id)}));}
}
export class ListSalesImportErrorsHandler extends BaseRequestHandler {
 static handlerName="listSalesImportErrors";
 static api={method:"GET",path:"/api/v1/sales-imports/:id/orders/:orderId/errors",description:"查詢匯入來源訂單安全錯誤",authorizationPolicies:[SALES_IMPORT_READ_POLICY],requestSchema:{params:SALES_IMPORT_ERROR_PARAMS,query:{},body:EMPTY},responseSchema:{200:SALES_IMPORT_ERRORS_RESPONSE}};
 constructor(services={}){super(services);this.imports=new SalesImportQueryService({database:services.require("mysqldatabase")});}
 async execute(req){return this.response(await this.imports.errors({...salesImportQueryRequest(req,"errors"),id:Number(req.input.params.id),orderId:Number(req.input.params.orderId)}));}
}
