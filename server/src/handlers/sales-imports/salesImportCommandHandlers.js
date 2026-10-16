import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesImportService} from "../../modules/sales/SalesImportService.js";
import {EMPTY,SALES_CONFIRMATION_INPUT} from "../sales/salesSchemas.js";
import {SALES_IMPORT_ID_PARAMS,SALES_IMPORT_POLICY,SALES_IMPORT_UPLOAD_RESPONSE,salesActorClaims} from "./salesImportSchemas.js";
const api=(action,status)=>({method:"POST",path:`/api/v1/sales-imports/:id/${action}`,description:`銷售匯入${action}`,authorizationPolicies:[SALES_IMPORT_POLICY],idempotency:{enabled:true},requestSchema:{params:SALES_IMPORT_ID_PARAMS,query:EMPTY,body:SALES_CONFIRMATION_INPUT},responseSchema:{[status]:SALES_IMPORT_UPLOAD_RESPONSE}});
class ImportCommandHandler extends BaseRequestHandler {
 constructor(services={}){super(services);this.imports=new SalesImportService({database:services.require("mysqldatabase"),time:services.require("time")});}
 authorizeRequest(req){return this.imports.authorizeUpload(salesActorClaims(req));}
 command(req){return {claims:salesActorClaims(req),id:Number(req.input.params.id),input:req.input.body,abortSignal:req.requestTimeout?.signal,trace:{requestId:req.requestId??"",correlationId:req.correlationId??"",ipAddress:req.ip??""}};}
}
export class ConfirmSalesImportHandler extends ImportCommandHandler {
 static handlerName="confirmSalesImport";static api=api("confirm",202);
 async execute(req){return this.response(await this.imports.confirm(this.command(req)),{statusCode:202});}
}
export class CancelSalesImportHandler extends ImportCommandHandler {
 static handlerName="cancelSalesImport";static api=api("cancel",200);
 async execute(req){return this.response(await this.imports.cancel(this.command(req)));}
}
