import { normalizeFulfillmentCreate } from "../../modules/fulfillment/fulfillmentCreateCommand.js";
import { FULFILLMENT_DETAIL_RESPONSE } from "./fulfillmentInquirySchemas.js";
const object = properties => ({ type:"object",additionalProperties:false,required:Object.keys(properties),properties });
const id = {type:"string",pattern:"^[1-9][0-9]{0,15}$",maxLength:16};
export const FULFILLMENT_CREATE_EMPTY = object({});
export function fulfillmentCreateRequest(req) { return normalizeFulfillmentCreate(req.input.body); }
export const FULFILLMENT_CREATE_RESPONSE = object({outcome:object({id,number:{type:"string",pattern:"^FUL-[0-9]{6}-[0-9]{6,13}$",maxLength:24},status:{const:"DRAFT"},version:{const:1}}),...FULFILLMENT_DETAIL_RESPONSE.properties});
