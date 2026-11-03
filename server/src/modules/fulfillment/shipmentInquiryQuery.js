import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

export const SHIPMENT_SORTS=Object.freeze({lastBusinessUpdatedAt:"last_business_updated_at",createdAt:"created_at",shippedAt:"shipped_at",shipmentDate:"shipment_date",shipmentNumber:"shipment_number",id:"id"});
export const SHIPMENT_STATUSES=Object.freeze(["DRAFT","SHIPPING","SHIPPED","CANCELLED","REVERSING","REVERSED"]);
const invalid=()=>{throw fulfillmentError("FULFILLMENT_INPUT_INVALID");};
function object(input,keys){if(!input||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.getOwnPropertySymbols(input).length||Object.keys(input).some(key=>!keys.includes(key)))invalid();}
function integer(value,min,max){if(typeof value==="string"){if(!/^(0|[1-9][0-9]*)$/u.test(value))invalid();value=Number(value);}if(!Number.isSafeInteger(value)||value<min||value>max)invalid();return value;}
function text(value,max){if(typeof value!=="string"||value.length>max||/[\p{Cc}]/u.test(value))invalid();return value.trim();}
function date(value){if(typeof value!=="string"||!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)invalid();return value;}
export function shipmentListQuery(input={}){
 object(input,["q","salesOrderId","customerId","warehouseId","status","shipmentDateFrom","shipmentDateTo","carrier","trackingNumber","sortBy","descending","page","pageSize"]);
 const query={page:integer(input.page??1,1,Number.MAX_SAFE_INTEGER),pageSize:integer(input.pageSize??20,1,100),sortBy:input.sortBy??"lastBusinessUpdatedAt",descending:input.descending??true};
 if(typeof query.sortBy!=="string"||!Object.hasOwn(SHIPMENT_SORTS,query.sortBy))invalid();
 if(query.descending==="true")query.descending=true;else if(query.descending==="false")query.descending=false;
 if(typeof query.descending!=="boolean"||!Number.isSafeInteger((query.page-1)*query.pageSize))invalid();
 for(const key of ["salesOrderId","customerId","warehouseId"])if(input[key]!==undefined)query[key]=integer(input[key],1,Number.MAX_SAFE_INTEGER);
 for(const key of ["q","carrier","trackingNumber"])if(input[key]!==undefined){const value=text(input[key],190);if(value)query[key]=value;}
 if(input.status!==undefined){query.status=Array.isArray(input.status)?[...input.status]:[input.status];if(!query.status.length||query.status.length>SHIPMENT_STATUSES.length||new Set(query.status).size!==query.status.length||query.status.some(value=>!SHIPMENT_STATUSES.includes(value)))invalid();}
 for(const key of ["shipmentDateFrom","shipmentDateTo"])if(input[key]!==undefined)query[key]=date(input[key]);
 if(query.shipmentDateFrom&&query.shipmentDateTo&&query.shipmentDateFrom>query.shipmentDateTo)invalid();
 return query;
}
export function shipmentDetailQuery(input={}){
 object(input,["issueAfterId","historyBeforeSequence"]);
 const issueAfterId=input.issueAfterId??"0";try{fulfillmentInteger(issueAfterId,{positive:false});}catch{invalid();}
 return {issueAfterId,historyBeforeSequence:integer(input.historyBeforeSequence??4294967296,1,4294967296)};
}
