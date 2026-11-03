import { SHIPMENT_INQUIRY_RESPONSE } from "./shipmentInquirySchemas.js";
import { FULFILLMENT_DETAIL_RESPONSE } from "../fulfillments/fulfillmentInquirySchemas.js";
const object=properties=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const id={type:"string",pattern:"^[1-9][0-9]{0,15}$",maxLength:16},uuid={type:"string",format:"uuid"};
export const SHIPMENT_CONFIRM_BODY=object({eventId:uuid,version:{type:"integer",minimum:1,maximum:4294967295}});
export const SHIPMENT_CONFIRM_RESPONSE=object({outcome:{const:"SHIPPED"},shipment:SHIPMENT_INQUIRY_RESPONSE.properties.shipment,inventoryMovementIds:{type:"array",minItems:1,maxItems:5000,uniqueItems:true,items:id},salesOrder:FULFILLMENT_DETAIL_RESPONSE.properties.salesOrder});
export const SHIPMENT_CONFIRM_PENDING=object({outcome:{const:"SHIPPING"},operationId:id,eventId:uuid,correlationId:uuid,statusUrl:{type:"string",pattern:"^/api/v1/fulfillment-operations/by-event/[0-9a-f-]{36}$",maxLength:76},retryAfterSeconds:{const:2}});
