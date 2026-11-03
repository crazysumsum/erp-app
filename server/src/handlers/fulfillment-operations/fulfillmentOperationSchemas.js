import { FULFILLMENT_STATUSES,SHIPMENT_STATUSES } from "../../modules/fulfillment/fulfillmentConstants.js";
import { FULFILLMENT_ERROR_STATUS } from "../../modules/fulfillment/fulfillmentErrors.js";
const object=(properties,required=Object.keys(properties))=>({type:"object",additionalProperties:false,required,properties});
const uuid={type:"string",format:"uuid",pattern:"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},id={type:"string",pattern:"^[1-9][0-9]{0,15}$",maxLength:16},version={type:"integer",minimum:1,maximum:4294967295};
export const FULFILLMENT_OPERATION_PARAMS=object({eventId:uuid});
export const FULFILLMENT_OPERATION_EMPTY=object({});
const result=object({id,status:{enum:[...new Set([...FULFILLMENT_STATUSES,...SHIPMENT_STATUSES])]},version,number:{type:"string",pattern:"^(FUL|SHP)-[0-9]{6}-[0-9]{6,13}$",maxLength:24}},["id","status","version"]);
const details=object({field:{type:"string",maxLength:100},currentVersion:version,correlationId:uuid,statusUrl:{type:"string",pattern:"^/api/v1/fulfillment-operations/by-event/[0-9a-f-]{36}$",maxLength:76}},[]);
export const FULFILLMENT_OPERATION_RESPONSE=object({operationId:id,eventId:uuid,correlationId:uuid,status:{enum:["IN_PROGRESS","SUCCEEDED","FAILED"]},result:{...result,type:["object","null"]},publicErrorCode:{type:["string","null"],enum:[null,...Object.keys(FULFILLMENT_ERROR_STATUS).filter(code=>code!=="DATABASE_TRANSACTION_INDETERMINATE")]},publicErrorDetails:{...details,type:["object","null"]}});
