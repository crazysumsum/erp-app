import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesImportService} from "../../modules/sales/SalesImportService.js";
import {EMPTY,SALES_IMPORT_ID_PARAMS,SALES_IMPORT_READ_POLICY,salesActorClaims} from "./salesImportSchemas.js";
export class DownloadSalesImportResultHandler extends BaseRequestHandler {
 static handlerName="downloadSalesImportResult";
 static api={method:"GET",path:"/api/v1/sales-imports/:id/result",description:"下載銷售匯入結果CSV",authorizationPolicies:[SALES_IMPORT_READ_POLICY],download:{enabled:true},requestSchema:{params:SALES_IMPORT_ID_PARAMS,query:EMPTY},responseSchema:{200:EMPTY}};
 constructor(services={}){super(services);this.imports=new SalesImportService({database:services.require("mysqldatabase"),time:services.require("time")});}
 async execute(req){const result=await this.imports.resolveResultDownload({claims:salesActorClaims(req),id:Number(req.input.params.id),abortSignal:req.requestTimeout?.signal});return this.file({...result,contentType:"text/csv; charset=utf-8"});}
}
