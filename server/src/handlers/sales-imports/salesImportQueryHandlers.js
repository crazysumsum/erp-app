import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesImportQueryService} from "../../modules/sales/SalesImportQueryService.js";
import {EMPTY,SALES_IMPORT_READ_POLICY,SALES_IMPORT_ID_PARAMS,SALES_IMPORT_LIST_RESPONSE,SALES_IMPORT_JOB_RESPONSE,salesActorClaims,salesImportQueryRequest} from "./salesImportSchemas.js";
export class ListSalesImportsHandler extends BaseRequestHandler {
 static handlerName="listSalesImports";
 static api={method:"GET",path:"/api/v1/sales-imports",description:"查詢銷售匯入工作",authorizationPolicies:[SALES_IMPORT_READ_POLICY],requestSchema:{params:EMPTY,query:{},body:EMPTY},responseSchema:{200:SALES_IMPORT_LIST_RESPONSE}};
 constructor(services={}){super(services);this.imports=new SalesImportQueryService({database:services.require("mysqldatabase")});}
 async execute(req){return this.response(await this.imports.list(salesImportQueryRequest(req,"jobs")));}
}
export class GetSalesImportHandler extends BaseRequestHandler {
 static handlerName="getSalesImport";
 static api={method:"GET",path:"/api/v1/sales-imports/:id",description:"查詢銷售匯入摘要與進度",authorizationPolicies:[SALES_IMPORT_READ_POLICY],requestSchema:{params:SALES_IMPORT_ID_PARAMS,query:EMPTY,body:EMPTY},responseSchema:{200:SALES_IMPORT_JOB_RESPONSE}};
 constructor(services={}){super(services);this.imports=new SalesImportQueryService({database:services.require("mysqldatabase")});}
 async execute(req){return this.response(await this.imports.get({claims:salesActorClaims(req),id:Number(req.input.params.id)}));}
}
