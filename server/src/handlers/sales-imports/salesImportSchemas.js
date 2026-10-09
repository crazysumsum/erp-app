import {RequestValidator} from "../../framework/validation/requestValidator.js";
import {salesError} from "../../modules/sales/salesErrors.js";
import {EMPTY,SALES_CONFIRMATION_INPUT,salesActorClaims} from "../sales/salesSchemas.js";
export {EMPTY,salesActorClaims};
export const SALES_IMPORT_POLICY={name:"hasPermission",options:{permissions:["sales.view","sales.import"]}};
export const SALES_IMPORT_UPLOAD_INPUT={type:"object",additionalProperties:false,required:["eventId"],properties:{eventId:SALES_CONFIRMATION_INPUT.properties.eventId}};
export const SALES_IMPORT_UPLOAD_RESPONSE={type:"object",additionalProperties:false,required:["importJob","warnings"],properties:{
 importJob:{type:"object",additionalProperties:false,required:["id","batchNumber","status","version"],properties:{id:{type:"integer",minimum:1},batchNumber:{type:"string",pattern:"^SI-\\d{6}-\\d{6}$"},status:{type:"string"},version:{type:"integer",minimum:1}}},
 warnings:{type:"array",maxItems:1,items:{type:"object",additionalProperties:false,required:["code"],properties:{code:{const:"SAME_FILE_PREVIOUSLY_UPLOADED"}}}}}};

const ID={type:"integer",minimum:1,maximum:Number.MAX_SAFE_INTEGER},TEXT={type:"string"},TIME={type:"integer",minimum:0},nullable=schema=>({anyOf:[schema,{type:"null"}]}),object=properties=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
export const SALES_IMPORT_ID_PARAMS=object({id:ID}),SALES_IMPORT_ERROR_PARAMS=object({id:ID,orderId:ID});
export const SALES_IMPORT_READ_POLICY={name:"hasPermission",options:{permissions:["sales.view"]}};
export const SALES_IMPORT_JOB_RESPONSE=object({id:ID,batchNumber:TEXT,templateVersion:TEXT,fileName:TEXT,status:{enum:["UPLOADED","VALIDATING","READY","QUEUED","PROCESSING","COMPLETED","PARTIAL_SUCCESS","FAILED","CANCELLED"]},version:ID,createdBy:nullable(ID),confirmedBy:nullable(ID),createdAt:TIME,updatedAt:TIME,completedAt:nullable(TIME),filesPurgedAt:nullable(TIME),
 totalRowCount:TIME,sourceOrderCount:TIME,validCount:TIME,invalidCount:TIME,duplicateCount:TIME,successCount:TIME,failedCount:TIME,warningCount:TIME,allowedActions:{type:"array",maxItems:2,items:{enum:["confirm","cancel"]}}});
const paged=item=>object({items:{type:"array",maxItems:100,items:item},total:TIME,page:ID,pageSize:{...ID,maximum:100}});
export const SALES_IMPORT_LIST_RESPONSE=paged(SALES_IMPORT_JOB_RESPONSE);
export const SALES_IMPORT_ORDERS_RESPONSE=paged(object({id:ID,sourceOrderKey:TEXT,channelCode:TEXT,externalOrderId:TEXT,firstRowNo:ID,lastRowNo:ID,lineCount:{...ID,maximum:100},status:TEXT,salesOrderId:nullable(ID),salesOrderNumber:TEXT,isArchived:{type:"boolean"},resultCode:TEXT,createdAt:TIME,completedAt:nullable(TIME)}));
export const SALES_IMPORT_ERRORS_RESPONSE=paged(object({id:ID,rowNo:ID,field:{type:"string",maxLength:190},code:{type:"string",maxLength:80},message:{type:"string",maxLength:500},createdAt:TIME}));

const pages={page:ID,pageSize:{...ID,maximum:100}},ordering=sortBy=>({...pages,sortBy:{enum:sortBy},descending:{type:"boolean"}});
export const SALES_IMPORT_QUERIES={jobs:{type:"object",additionalProperties:false,properties:{...ordering(["createdAt","updatedAt","batchNumber","status"]),status:SALES_IMPORT_JOB_RESPONSE.properties.status,actorId:ID,fileName:{type:"string",maxLength:255},createdFrom:TIME,createdTo:TIME}},
 orders:{type:"object",additionalProperties:false,properties:{...ordering(["id","firstRowNo","status","createdAt"]),status:{enum:["RECEIVED","VALIDATING","VALID","INVALID","DUPLICATE","QUEUED","PROCESSING","SUCCEEDED","FAILED"]},errorCode:{type:"string",maxLength:80},sourceOrderKey:{type:"string",maxLength:190},externalOrderId:{type:"string",maxLength:190},channelCode:{type:"string",maxLength:50}}},errors:{type:"object",additionalProperties:false,properties:pages}};
const queryValidator=new RequestValidator({config:{enabled:true,allErrors:true,coerceTypes:true,useDefaults:false,removeAdditional:false,maxErrors:20,includeErrorDetailsInResponse:false}}),queries=Object.fromEntries(Object.entries(SALES_IMPORT_QUERIES).map(([kind,query])=>[kind,queryValidator.compile({query},"Sales Import "+kind)]));
export function salesImportQueryRequest(req,kind){const request={query:structuredClone(req.input.query)};try{queries[kind](request);}catch(error){if(error.code==="REQUEST_VALIDATION_FAILED")throw salesError("SALES_INPUT_INVALID");throw error;}return {claims:salesActorClaims(req),input:request.input.query};}
