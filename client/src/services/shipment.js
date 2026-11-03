import { httpClient } from "@/framework/http/HttpClient.js";
import { ApiError } from "@/framework/http/ApiError.js";
import { ERROR_CODE_MESSAGES } from "@/framework/http/errorMessages.js";

export const service={name:"shipment"};
const statuses=["DRAFT","SHIPPING","SHIPPED","CANCELLED","REVERSING","REVERSED"],sorts=["lastBusinessUpdatedAt","createdAt","shippedAt","shipmentDate","shipmentNumber","id"];
const invalid=()=>{throw new TypeError("出貨資料格式不正確，請檢查後再試");};
const unavailable=()=>{throw new ApiError({code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE",message:"未能確認出貨回應，請保留原操作識別碼查詢結果"});};
const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const version=value=>Number.isSafeInteger(value)&&value>0&&value<=4294967295;
function object(value,keys,required=[]){if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))invalid();}
function integer(value,min=1,max=Number.MAX_SAFE_INTEGER){if(typeof value==="string"){if(!/^(0|[1-9][0-9]*)$/u.test(value))invalid();value=Number(value);}if(!Number.isSafeInteger(value)||value<min||value>max)invalid();return value;}
export function shipmentDocumentId(value){const id=typeof value==="number"&&Number.isSafeInteger(value)?String(value):value;if(typeof id!=="string"||!/^[1-9][0-9]{0,15}$/u.test(id)||BigInt(id)>BigInt(Number.MAX_SAFE_INTEGER))invalid();return id;}
function event(value){if(!uuid(value))invalid();return value;}
function text(value,max){if(typeof value!=="string"||value.length>max)invalid();return value;}
function date(value){if(typeof value!=="string"||!/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)invalid();return value;}
export function normalizeShipmentQuery(input={}){
 object(input,["q","filter","salesOrderId","customerId","warehouseId","status","shipmentDateFrom","shipmentDateTo","carrier","trackingNumber","sortBy","descending","page","pageSize","rowsPerPage"]);
 const fields={...input,q:input.filter??input.q,pageSize:input.rowsPerPage??input.pageSize},query={page:integer(fields.page??1),pageSize:integer(fields.pageSize??20,1,100),sortBy:fields.sortBy??"lastBusinessUpdatedAt",descending:fields.descending??true};
 if(!sorts.includes(query.sortBy))invalid();if(query.descending==="true")query.descending=true;else if(query.descending==="false")query.descending=false;if(typeof query.descending!=="boolean"||!Number.isSafeInteger((query.page-1)*query.pageSize))invalid();
 for(const key of ["salesOrderId","customerId","warehouseId"])if(fields[key]!==undefined&&fields[key]!==null&&fields[key]!=="")query[key]=integer(fields[key]);
 for(const key of ["q","carrier","trackingNumber"])if(fields[key]!==undefined&&fields[key]!==null){const value=text(fields[key],190).trim();if(/[\p{Cc}]/u.test(value))invalid();if(value)query[key]=value;}
 if(fields.status!==undefined&&fields.status!==null&&fields.status!==""){query.status=Array.isArray(fields.status)?[...fields.status]:[fields.status];if(!query.status.length||query.status.length>statuses.length||new Set(query.status).size!==query.status.length||query.status.some(value=>!statuses.includes(value)))invalid();}
 for(const key of ["shipmentDateFrom","shipmentDateTo"])if(fields[key]!==undefined&&fields[key]!==null&&fields[key]!=="")query[key]=date(fields[key]);
 if(query.shipmentDateFrom&&query.shipmentDateTo&&query.shipmentDateFrom>query.shipmentDateTo)invalid();return query;
}
function draft(body,update){
 object(body,["eventId","version","shippingAddressId","shippingAddressVersion","shippingContactId","shippingContactVersion","carrierName","trackingNumber","packageCount","totalWeight","weightUom","notes"],["eventId","shippingAddressId","shippingAddressVersion",...(update?["version"]:[])]);
 event(body.eventId);if(update?!version(body.version):Object.hasOwn(body,"version"))invalid();
 if(!Number.isSafeInteger(body.shippingAddressId)||body.shippingAddressId<1||!version(body.shippingAddressVersion))invalid();
 const contact=body.shippingContactId??null,contactVersion=body.shippingContactVersion??null;if(contact===null?contactVersion!==null:!Number.isSafeInteger(contact)||contact<1||!version(contactVersion))invalid();
 if(body.packageCount!==undefined&&body.packageCount!==null&&!version(body.packageCount))invalid();
 const weight=body.totalWeight===undefined?null:body.totalWeight,unit=body.weightUom===undefined?"":body.weightUom;
 if(weight===null?unit!=="":typeof weight!=="string"||!/^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/u.test(weight)||!/[1-9]/u.test(weight)||!["KG","G"].includes(unit))invalid();
 for(const [key,max]of [["carrierName",190],["trackingNumber",190],["notes",2000]])if(body[key]!==undefined)text(body[key],max);
}
function command(body,cancel=false){object(body,["eventId","version",...(cancel?["reason"]:[])],["eventId","version"]);event(body.eventId);if(!version(body.version))invalid();if(cancel&&body.reason!==undefined)text(body.reason,500);}
function header(row,id){try{if(!row||shipmentDocumentId(row.id)!==id||!statuses.includes(row.status)||!version(row.version))unavailable();}catch{unavailable();}}
function draftResult(result,{shipmentId,fulfillmentId,status,expectedVersion}){try{if(!result?.outcome||!result.shipment)unavailable();const id=shipmentDocumentId(result.outcome.id);header(result.shipment,id);if(shipmentId!==undefined&&id!==shipmentId||fulfillmentId!==undefined&&shipmentDocumentId(result.shipment.fulfillmentId)!==fulfillmentId||result.outcome.status!==status||result.outcome.version!==expectedVersion||result.shipment.version<expectedVersion)unavailable();}catch{unavailable();}return result;}
function write(path,input,validate,{signal}={}){
 object(input,["eventId","version","shippingAddressId","shippingAddressVersion","shippingContactId","shippingContactVersion","carrierName","trackingNumber","packageCount","totalWeight","weightUom","notes","reason","idempotencyKey"]);
 const {idempotencyKey,...body}=input;if(idempotencyKey!==undefined&&(typeof idempotencyKey!=="string"||!/^[\x21-\x7e]{1,190}$/u.test(idempotencyKey)))invalid();validate(body);return httpClient.post(path,{idempotent:true,idempotencyKey:idempotencyKey??body.eventId,body,...(signal===undefined?{}:{signal})});
}
export function shipmentOriginalReference(eventId,correlationId=null){
 event(eventId);if(correlationId!==null&&!uuid(correlationId))invalid();return Object.freeze({eventId,correlationId,statusUrl:`/api/v1/fulfillment-operations/by-event/${eventId}`});
}
export function shipmentOperationReference(value){
 if(!value||!uuid(value.eventId)||!uuid(value.correlationId)||value.statusUrl!==`/api/v1/fulfillment-operations/by-event/${value.eventId}`)unavailable();
 return shipmentOriginalReference(value.eventId,value.correlationId);
}
export function shipmentFailure(error){
 const status=error?.status,code=error?.code,preserveInput=true;
 if(status===401||status===403||["PERMISSION_STALE","FULFILLMENT_PERMISSION_DENIED"].includes(code))return {message:"登入或操作權限已變更，請重新登入或聯絡管理員。",action:"none",preserveInput};
 if(["SHIPPING_ADDRESS_CHANGED","SHIPPING_ADDRESS_UNAVAILABLE"].includes(code))return {message:"送貨地址或聯絡資料已變更，輸入仍保留；請重新選擇有效資料並核對。",action:"address",preserveInput};
 if(["ALLOCATION_CANDIDATE_CHANGED","ALLOCATION_INSUFFICIENT","RESERVATION_CLAIM_CONFLICT","FULFILLMENT_SOURCE_CONFLICT","FULFILLABLE_QUANTITY_CHANGED"].includes(code))return {message:"履約來源或分配資料已變更，輸入仍保留；請返回履約單核對可用操作。",action:"allocation",preserveInput};
 if(status===202||status>=500||["DATABASE_TRANSACTION_INDETERMINATE","FULFILLMENT_DEPENDENCY_UNAVAILABLE","TIMEOUT","NETWORK_ERROR","CONCURRENT_OPERATION"].includes(code))return {message:"暫時未能確認出貨結果，請保留原操作識別碼並查詢原結果，不要再次提交。",action:"recover",preserveInput};
 if(status===404)return {message:"找不到可用的出貨資料，請返回列表重新查詢。",action:"none",preserveInput};
 return {message:Object.hasOwn(ERROR_CODE_MESSAGES,code)?ERROR_CODE_MESSAGES[code]:"出貨操作未能完成，請保留輸入並重新核對。",action:error instanceof TypeError?"correct":status===409?"reload":"none",preserveInput};
}
export default {
 listShipments({signal,...query}={}){return httpClient.get("/api/v1/shipments",{params:normalizeShipmentQuery(query),signal}).then(result=>{if(!result||!Array.isArray(result.items)||result.items.length>100||!Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.page)||result.page<1||!Number.isSafeInteger(result.pageSize)||result.pageSize<1||result.pageSize>100||typeof result.hasMore!=="boolean")unavailable();return result;});},
 getShipment(id,{signal,...params}={}){id=shipmentDocumentId(id);object(params,["issueAfterId","historyBeforeSequence"]);if(params.issueAfterId!==undefined){if(typeof params.issueAfterId!=="string")invalid();integer(params.issueAfterId,0);}if(params.historyBeforeSequence!==undefined)params.historyBeforeSequence=integer(params.historyBeforeSequence,1,4294967296);return httpClient.get(`/api/v1/shipments/${id}`,{params,signal}).then(result=>{header(result?.shipment,id);return result;});},
 listShippingAddresses(customerId,fulfillmentId,{signal}={}){return httpClient.get(`/api/v1/fulfillment-lookups/customers/${shipmentDocumentId(customerId)}/shipping-addresses`,{params:{fulfillmentId:Number(shipmentDocumentId(fulfillmentId))},signal});},
 listShippingContacts(customerId,fulfillmentId,{signal}={}){return httpClient.get(`/api/v1/fulfillment-lookups/customers/${shipmentDocumentId(customerId)}/shipping-contacts`,{params:{fulfillmentId:Number(shipmentDocumentId(fulfillmentId))},signal});},
 createDraft(id,body,options){id=shipmentDocumentId(id);return write(`/api/v1/fulfillments/${id}/shipments/create`,body,value=>draft(value,false),options).then(result=>draftResult(result,{fulfillmentId:id,status:"DRAFT",expectedVersion:1}));},
 updateDraft(id,body,options){id=shipmentDocumentId(id);const expectedVersion=body?.version+1;return write(`/api/v1/shipments/${id}/update`,body,value=>draft(value,true),options).then(result=>draftResult(result,{shipmentId:id,status:"DRAFT",expectedVersion}));},
 cancelDraft(id,body,options){id=shipmentDocumentId(id);const expectedVersion=body?.version+1;return write(`/api/v1/shipments/${id}/cancel`,body,value=>command(value,true),options).then(result=>draftResult(result,{shipmentId:id,status:"CANCELLED",expectedVersion}));},
 confirm(id,body,options){id=shipmentDocumentId(id);const intendedEvent=event(body?.eventId),confirmedVersion=body?.version+2;return write(`/api/v1/shipments/${id}/confirm`,body,command,options).then(result=>{
  if(result?.outcome==="SHIPPING"){shipmentOperationReference(result);try{shipmentDocumentId(result.operationId);}catch{unavailable();}if(result.eventId!==intendedEvent||!Number.isSafeInteger(result.retryAfterSeconds)||result.retryAfterSeconds<1||result.retryAfterSeconds>60)unavailable();}
  else if(result?.outcome==="SHIPPED"){header(result.shipment,id);if(!["SHIPPED","REVERSING","REVERSED"].includes(result.shipment.status)||result.shipment.version<confirmedVersion||!Array.isArray(result.inventoryMovementIds)||!result.inventoryMovementIds.length||result.inventoryMovementIds.length>5000||!result.salesOrder)unavailable();try{shipmentDocumentId(result.salesOrder.id);const ids=result.inventoryMovementIds.map(shipmentDocumentId);if(new Set(ids).size!==ids.length)unavailable();}catch{unavailable();}}
  else unavailable();return result;
 });},
 getOperation(eventId,{signal}={}){event(eventId);return httpClient.get(`/api/v1/fulfillment-operations/by-event/${eventId}`,{signal}).then(result=>{try{if(!result||result.eventId!==eventId||!uuid(result.correlationId)||!["IN_PROGRESS","SUCCEEDED","FAILED"].includes(result.status))unavailable();shipmentDocumentId(result.operationId);if(result.status==="SUCCEEDED"){shipmentDocumentId(result.result?.id);if(!["DRAFT","CANCELLED","SHIPPED","REVERSED"].includes(result.result.status)||!version(result.result.version))unavailable();}if(result.status==="FAILED"&&(typeof result.publicErrorCode!=="string"||!result.publicErrorCode))unavailable();}catch{unavailable();}return result;});},
 getDeliveryNote(id,{signal}={}){return httpClient.get(`/api/v1/shipments/${shipmentDocumentId(id)}/delivery-note`,{signal});}
};
