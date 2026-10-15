import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {SalesImportService} from "../../modules/sales/SalesImportService.js";
import {salesError} from "../../modules/sales/salesErrors.js";
import {EMPTY,SALES_IMPORT_POLICY,SALES_IMPORT_UPLOAD_INPUT,SALES_IMPORT_UPLOAD_RESPONSE,salesActorClaims} from "./salesImportSchemas.js";
export class UploadSalesImportHandler extends BaseRequestHandler {
 static handlerName="uploadSalesImport";
 static api={method:"POST",path:"/api/v1/sales-imports/upload",description:"安全上傳CSV1.0並建立銷售匯入工作",authorizationPolicies:[SALES_IMPORT_POLICY],idempotency:{enabled:true},
  upload:{enabled:true,storageMode:"disk",directory:"storage/uploads/tmp/sales-imports",maxFileSizeBytes:52428800,maxFiles:1,maxTotalFileBytes:52428800,maxFieldCount:2,maxFieldSizeBytes:4096,maxRequestBytes:52428800+131072,allowedMimeTypes:["text/csv","application/csv"]},
  requestSchema:{params:EMPTY,query:EMPTY,body:SALES_IMPORT_UPLOAD_INPUT},responseSchema:{201:SALES_IMPORT_UPLOAD_RESPONSE}};
 constructor(services={}){super(services);this.imports=new SalesImportService({database:services.require("mysqldatabase"),time:services.require("time"),tempRoot:services.config?.api?.upload?.diskTempDirectory});}
 authorizeRequest(req){return this.imports.authorizeUpload(salesActorClaims(req));}
 async execute(req){
  if(req.files?.length!==1)throw salesError("SALES_IMPORT_FILE_INVALID");
  return this.response(await this.imports.createFromUpload({claims:salesActorClaims(req),eventId:req.input.body.eventId,file:req.files[0],abortSignal:req.requestTimeout?.signal,trace:{requestId:req.requestId??"",correlationId:req.correlationId??""}}),{statusCode:201});
 }
}
