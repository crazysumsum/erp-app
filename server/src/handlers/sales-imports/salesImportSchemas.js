import {EMPTY,SALES_CONFIRMATION_INPUT,salesActorClaims} from "../sales/salesSchemas.js";
export {EMPTY,salesActorClaims};
export const SALES_IMPORT_POLICY={name:"hasPermission",options:{permissions:["sales.view","sales.import"]}};
export const SALES_IMPORT_UPLOAD_INPUT={type:"object",additionalProperties:false,required:["eventId"],properties:{eventId:SALES_CONFIRMATION_INPUT.properties.eventId}};
export const SALES_IMPORT_UPLOAD_RESPONSE={type:"object",additionalProperties:false,required:["importJob","warnings"],properties:{
 importJob:{type:"object",additionalProperties:false,required:["id","batchNumber","status","version"],properties:{id:{type:"integer",minimum:1},batchNumber:{type:"string",pattern:"^SI-\\d{6}-\\d{6}$"},status:{type:"string"},version:{type:"integer",minimum:1}}},
 warnings:{type:"array",maxItems:1,items:{type:"object",additionalProperties:false,required:["code"],properties:{code:{const:"SAME_FILE_PREVIOUSLY_UPLOADED"}}}}}};
