import {salesError} from "../../modules/sales/salesErrors.js";
import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {EMPTY,SALES_ORDER_READ_POLICY,SALES_ORDER_ID_PARAMS,SALES_EXPORT_INPUT,SALES_EXPORT_SUMMARY,SALES_EXPORT_LIST,salesActorClaims,salesExportListRequest} from "./salesExportSchemas.js";
class ExportHandler extends BaseRequestHandler {constructor(services={}){super(services);this.exports=services.require("salesJobs").exports;}}
export class CreateSalesExportHandler extends ExportHandler {
 static handlerName="createSalesExport";static api={method:"POST",path:"/api/v1/sales-exports/create",description:"建立背景銷售匯出工作",authorizationPolicies:[SALES_ORDER_READ_POLICY],idempotency:{enabled:true},requestSchema:{params:EMPTY,query:EMPTY,body:SALES_EXPORT_INPUT},responseSchema:{202:SALES_EXPORT_SUMMARY}};
 authorizeRequest(req){return this.exports.authorizeCreate(salesActorClaims(req));}
 async execute(req){const {eventId,scope,filters}=req.input.body;if(String(req.get("Idempotency-Key")??"").trim()!==eventId)throw salesError("SALES_INPUT_INVALID");return this.response(await this.exports.create({claims:salesActorClaims(req),eventId,input:{scope,filters},signal:req.requestTimeout?.signal,trace:{requestId:req.requestId??"",correlationId:req.correlationId??""}}),{statusCode:202});}
}
export class ListSalesExportsHandler extends ExportHandler {
 static handlerName="listSalesExports";static api={method:"GET",path:"/api/v1/sales-exports",description:"查詢本人的銷售匯出工作",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:EMPTY,query:{},body:EMPTY},responseSchema:{200:SALES_EXPORT_LIST}};
 async execute(req){return this.response(await this.exports.list(salesExportListRequest(req)));}
}
export class GetSalesExportHandler extends ExportHandler {
 static handlerName="getSalesExport";static api={method:"GET",path:"/api/v1/sales-exports/:id",description:"查詢本人的銷售匯出進度",authorizationPolicies:[SALES_ORDER_READ_POLICY],requestSchema:{params:SALES_ORDER_ID_PARAMS,query:EMPTY,body:EMPTY},responseSchema:{200:SALES_EXPORT_SUMMARY}};
 async execute(req){return this.response(await this.exports.get({claims:salesActorClaims(req),id:Number(req.input.params.id),signal:req.requestTimeout?.signal}));}
}
export class DownloadSalesExportHandler extends ExportHandler {
 static handlerName="downloadSalesExport";static api={method:"GET",path:"/api/v1/sales-exports/:id/download",description:"下載本人的銷售匯出CSV",authorizationPolicies:[SALES_ORDER_READ_POLICY],download:{enabled:true},requestSchema:{params:SALES_ORDER_ID_PARAMS,query:EMPTY},responseSchema:{200:EMPTY}};
 async execute(req){return this.file({...await this.exports.resolveDownload({claims:salesActorClaims(req),id:Number(req.input.params.id),signal:req.requestTimeout?.signal}),contentType:"text/csv; charset=utf-8"});}
}
